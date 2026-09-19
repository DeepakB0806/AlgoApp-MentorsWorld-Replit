import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const baseUrl = process.env.AUTH_LOGOUT_TEST_BASE_URL
  ?? process.env.LAYOUT_TEST_BASE_URL
  ?? "http://127.0.0.1:18772";
const storageStatePath = process.env.AUTH_LOGOUT_TEST_STORAGE_STATE;
const returnTo = process.env.AUTH_LOGOUT_TEST_RETURN_TO ?? "/";
const executablePath = process.env.PLAYWRIGHT_BROWSER_EXECUTABLE_PATH ?? "/repl/tools/bin/chromium";

async function getFreePort() {
  const server = createServer();
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const { port } = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForDevTools(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {
      // Chromium is still starting.
    }
    await wait(100);
  }
  throw new Error("Chromium did not expose its DevTools endpoint");
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 0;
    this.pending = new Map();
    this.events = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.events.get(message.method) ?? []) listener(message.params);
    });
    await new Promise((resolvePromise, reject) => {
      this.socket.addEventListener("open", resolvePromise, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  on(method, listener) {
    const listeners = this.events.get(method) ?? [];
    listeners.push(listener);
    this.events.set(method, listeners);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async close() {
    this.socket?.close();
  }
}

async function launchBrowser(storageState) {
  const port = await getFreePort();
  const browser = spawn(executablePath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/mentors-world-auth-logout-${process.pid}`,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  browser.stderr.on("data", () => {});

  try {
    const version = await waitForDevTools(port);
    const browserCdp = new CdpClient(version.webSocketDebuggerUrl);
    await browserCdp.connect();
    const { targetId } = await browserCdp.send("Target.createTarget", { url: "about:blank" });
    const target = await (async () => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const found = targets.find((candidate) => candidate.id === targetId);
        if (found?.webSocketDebuggerUrl) return found;
        await wait(100);
      }
      throw new Error("Chromium did not expose the logout test page");
    })();
    const page = new CdpClient(target.webSocketDebuggerUrl);
    await page.connect();
    await page.send("Network.enable");
    await page.send("Page.enable");
    await page.send("Network.setCookies", { cookies: storageState.cookies ?? [] });
    return { browser, browserCdp, page };
  } catch (error) {
    browser.kill("SIGTERM");
    throw error;
  }
}

async function evaluate(page, expression) {
  const result = await page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "Browser evaluation failed");
  }
  return result.result.value;
}

async function navigate(page, url) {
  await page.send("Page.navigate", { url });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = await evaluate(page, "document.readyState");
    if (state === "complete") return;
    await wait(200);
  }
}

const browserTest = storageStatePath && existsSync(resolve(storageStatePath))
  ? test
  : test.skip;

browserTest("local customer/team logout returns home without OIDC navigation", async () => {
  const storageState = JSON.parse(await readFile(resolve(storageStatePath), "utf8"));
  const { browser, browserCdp, page } = await launchBrowser(storageState);
  const requests = [];
  page.on("Network.requestWillBeSent", ({ request }) => requests.push(request.url));

  try {
    await navigate(page, new URL("/user-home", baseUrl).href);
    const initial = await evaluate(page, `(() => ({
      pathname: location.pathname,
      hasLogout: Boolean(document.querySelector('[data-testid="button-logout"]')),
      loginVisible: Boolean(document.querySelector('[data-testid="button-login"]')),
    }))()`);

    assert.equal(initial.pathname, "/user-home");
    assert.equal(initial.hasLogout, true, "Authenticated session did not render the Sign Out button");
    assert.equal(initial.loginVisible, false, "Test session was redirected to login");

    await evaluate(page, `(() => {
      document.querySelector('[data-testid="button-logout"]').click();
      return true;
    })()`);

    const expectedPath = new URL(returnTo, baseUrl).pathname;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await evaluate(page, "location.pathname") === expectedPath) break;
      await wait(250);
    }

    assert.equal(await evaluate(page, "location.pathname"), expectedPath);
    assert.equal(
      requests.some((url) => url.includes("/api/logout") || url.includes("replit.com/oidc/session/end")),
      false,
      "Local logout navigated through the Replit OIDC provider",
    );

    const userResponse = await evaluate(page, `fetch("/api/auth/user", { credentials: "include" }).then((response) => response.status)`);
    assert.equal(userResponse, 401, "Local session remained authenticated after logout");
  } finally {
    await page.close();
    await browserCdp.close();
    browser.kill("SIGTERM");
  }
}, {
  skip: !storageStatePath || !existsSync(resolve(storageStatePath))
    ? "Set AUTH_LOGOUT_TEST_STORAGE_STATE to a disposable local customer/team storage state"
    : false,
});
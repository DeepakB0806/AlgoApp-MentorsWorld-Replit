import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { getProtectedRouteInventory } from "./route-inventory.mjs";

const baseUrl = process.env.LAYOUT_TEST_BASE_URL ?? "http://127.0.0.1:18772";
const storageStatePath = process.env.LAYOUT_TEST_STORAGE_STATE;
const executablePath = process.env.PLAYWRIGHT_BROWSER_EXECUTABLE_PATH ?? "/repl/tools/bin/chromium";
const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

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
    "--user-data-dir=/tmp/mentors-world-layout-browser",
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
      throw new Error("Chromium did not expose the layout test page");
    })();
    const page = new CdpClient(target.webSocketDebuggerUrl);
    await page.connect();
    await page.send("Network.enable");
    await page.send("Page.enable");
    if (storageState) {
      await page.send("Network.setCookies", {
        cookies: storageState.cookies ?? [],
      });
    }
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

async function navigate(page, url, viewport) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.send("Page.navigate", { url });
  await wait(750);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await evaluate(page, "document.readyState");
    if (state === "complete") return;
    await wait(250);
  }
}

const browserTest = storageStatePath && existsSync(resolve(storageStatePath))
  ? test
  : test.skip;

browserTest("authenticated routes reach the footer at supported viewport sizes", async () => {
  const storageState = JSON.parse(await readFile(resolve(storageStatePath), "utf8"));
  const routes = await getProtectedRouteInventory();
  const { browser, browserCdp, page } = await launchBrowser(storageState);

  try {
    for (const route of routes) {
      for (const viewport of viewports) {
        await navigate(page, new URL(route.path, baseUrl).href, viewport);
        const result = await evaluate(page, `(() => {
          const shell = document.querySelector('[data-testid="authenticated-page-shell"], [data-testid="broker-api-scroll-container"]');
          const footer = shell?.querySelector("footer");
          const loginVisible = location.pathname === "/login" || Boolean(document.querySelector('[data-testid="button-login"]'));
          if (shell) shell.scrollTop = shell.scrollHeight;
          const footerRect = footer?.getBoundingClientRect();
          return {
            pathname: location.pathname,
            loginVisible,
            hasShell: Boolean(shell),
            hasFooter: Boolean(footer),
            footerReachable: Boolean(footerRect && footerRect.top >= -4 && footerRect.bottom <= window.innerHeight + 4),
            pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1,
            innerScrollContracts: [...document.querySelectorAll(".overflow-x-auto, .overflow-y-auto, [data-radix-scroll-area-viewport]")].every((element) => {
              const styles = getComputedStyle(element);
              return styles.overflowX !== "visible" || styles.overflowY !== "visible";
            }),
          };
        })()`);

        assert.equal(result.loginVisible, false, `${route.path} redirected to login at ${viewport.name}; provide a valid super-admin storage state`);
        assert.equal(result.pathname, route.path, `${route.path} navigated to ${result.pathname} at ${viewport.name}`);
        assert.equal(result.hasShell, true, `${route.path} is missing AuthenticatedPageShell at ${viewport.name}`);
        assert.equal(result.hasFooter, true, `${route.path} is missing its footer at ${viewport.name}`);
        assert.equal(result.footerReachable, true, `${route.path} footer is not reachable at ${viewport.name}`);
        assert.equal(result.pageOverflow, false, `${route.path} has unexpected horizontal overflow at ${viewport.name}`);
        assert.equal(result.innerScrollContracts, true, `${route.path} has an unconstrained inner scroll region at ${viewport.name}`);
      }
    }
  } finally {
    await page.close();
    await browserCdp.close();
    browser.kill("SIGTERM");
  }
}, {
  skip: !storageStatePath || !existsSync(resolve(storageStatePath))
    ? "Set LAYOUT_TEST_STORAGE_STATE to a Playwright-compatible super-admin storage state to run authenticated browser checks"
    : false,
});
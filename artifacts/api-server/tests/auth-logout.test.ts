import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  clearLocalAuthSession,
  getEndSessionParameters,
  getPostLogoutRedirectUri,
  getRequestOrigin,
  getSafeReturnTo,
  sendLogoutDestination,
} from "../src/replit_integrations/auth/logout";

function createRequest({
  protocol = "https",
  host = "localhost:5000",
  forwardedHost,
  forwardedProtocol,
}: {
  protocol?: string;
  host?: string;
  forwardedHost?: string;
  forwardedProtocol?: string;
} = {}) {
  return {
    protocol,
    headers: {
      host,
      "x-forwarded-host": forwardedHost,
      "x-forwarded-proto": forwardedProtocol,
    },
    get(name: string) {
      return name.toLowerCase() === "host" ? host : undefined;
    },
  } as any;
}

test("production logout returns to the canonical custom-domain home URL", () => {
  const request = createRequest({
    host: "internal-proxy",
    forwardedHost: "algoapp.mentorsworld.org",
    forwardedProtocol: "https",
  });

  assert.equal(getRequestOrigin(request), "https://algoapp.mentorsworld.org");
  assert.equal(
    getPostLogoutRedirectUri(request, "/"),
    "https://algoapp.mentorsworld.org/",
  );
});

test("preview logout preserves a safe artifact base path", () => {
  const request = createRequest({
    host: "workspace.example.replit.dev",
    forwardedProtocol: "https",
  });

  assert.equal(
    getPostLogoutRedirectUri(request, "/mentors-world/"),
    "https://workspace.example.replit.dev/mentors-world/",
  );
});

test("logout rejects external and protocol-relative return targets", () => {
  assert.equal(getSafeReturnTo("https://attacker.example"), "/");
  assert.equal(getSafeReturnTo("//attacker.example"), "/");
  assert.equal(getSafeReturnTo(["/unexpected-array"]), "/");
  assert.equal(getSafeReturnTo("/safe/path"), "/safe/path");
});

test("logout destination returns JSON for app-owned browser navigation", () => {
  const calls: unknown[] = [];
  const response = {
    status(code: number) {
      calls.push(["status", code]);
      return this;
    },
    json(payload: unknown) {
      calls.push(["json", payload]);
      return payload;
    },
    redirect(code: number, destination: string) {
      calls.push(["redirect", code, destination]);
      return destination;
    },
  };

  sendLogoutDestination(
    { get: () => "text/html, application/json" },
    response,
    "/",
  );

  assert.deepEqual(calls, [
    ["status", 200],
    ["json", { redirectTo: "/" }],
  ]);
});

test("logout destination keeps direct browser requests as redirects", () => {
  const calls: unknown[] = [];
  const response = {
    status() {
      return this;
    },
    json(payload: unknown) {
      calls.push(["json", payload]);
      return payload;
    },
    redirect(code: number, destination: string) {
      calls.push(["redirect", code, destination]);
      return destination;
    },
  };

  sendLogoutDestination({ get: () => "text/html" }, response, "/");

  assert.deepEqual(calls, [["redirect", 302, "/"]]);
});

test("end-session parameters include the exact return URL and ID token hint", () => {
  const parameters = getEndSessionParameters(
    createRequest({
      host: "algoapp.mentorsworld.org",
      forwardedProtocol: "https",
    }),
    "/",
    "repl-client-id",
    "signed-id-token",
  );

  assert.deepEqual(parameters, {
    client_id: "repl-client-id",
    post_logout_redirect_uri: "https://algoapp.mentorsworld.org/",
    id_token_hint: "signed-id-token",
  });
});

test("local logout destroys the session and clears both auth cookies", async () => {
  const calls: string[] = [];
  const request = {
    logout(callback: (error?: unknown) => void) {
      calls.push("logout");
      callback();
    },
    session: {
      destroy(callback: (error?: unknown) => void) {
        calls.push("destroy");
        callback();
      },
    },
  };
  const response = {
    clearCookie(name: string) {
      calls.push(`clear:${name}`);
    },
  };

  const result = await clearLocalAuthSession(request, response);

  assert.deepEqual(result, {
    logoutError: undefined,
    sessionError: undefined,
  });
  assert.deepEqual(calls, [
    "logout",
    "destroy",
    "clear:connect.sid",
    "clear:team_session",
  ]);
});

test("local cookies are cleared even when Passport and session cleanup report errors", async () => {
  const logoutError = new Error("logout failed");
  const sessionError = new Error("destroy failed");
  const cleared: string[] = [];
  const result = await clearLocalAuthSession({
    logout(callback: (error?: unknown) => void) {
      callback(logoutError);
    },
    session: {
      destroy(callback: (error?: unknown) => void) {
        callback(sessionError);
      },
    },
  }, {
    clearCookie(name: string) {
      cleared.push(name);
    },
  });

  assert.equal(result.logoutError, logoutError);
  assert.equal(result.sessionError, sessionError);
  assert.deepEqual(cleared, ["connect.sid", "team_session"]);
});

test("web logout sends the artifact base path to the server", async () => {
  const source = await readFile(
    new URL("../../mentors-world/src/hooks/use-auth.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const returnTo = import\.meta\.env\.BASE_URL \|\| "\/";/);
  assert.match(source, /new URL\("\/api\/auth\/logout", window\.location\.origin\)/);
  assert.match(source, /Accept: "application\/json"/);
  assert.match(source, /window\.location\.assign\(destination\)/);
  assert.match(source, /window\.location\.assign\(returnTo\)/);
  assert.doesNotMatch(source, /apiRequest/);
});

test("logout routes local sessions before provider logout", async () => {
  const source = await readFile(
    new URL("../src/replit_integrations/auth/routes.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /app\.get\("\/api\/auth\/logout"/);
  assert.match(source, /if \(req\.teamUser\)/);
  assert.match(source, /sendLogoutDestination\(req, res, returnTo\)/);
  assert.match(source, /return handleOidcLogout\(req, res, returnTo\)/);
  assert.doesNotMatch(source, /\/api\/logout\?\$\{query\}/);
});

test("logout cleanup failures stop before OIDC redirect", async () => {
  const source = await readFile(
    new URL("../src/replit_integrations/auth/replitAuth.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /cleanup\.logoutError \|\| cleanup\.sessionError/);
  assert.match(source, /return res\.status\(500\)\.json\(\{ message: "Unable to complete logout cleanup" \}\)/);
  assert.match(source, /app\.get\("\/api\/logout", async \(req, res\) => \{\s*return handleOidcLogout\(req, res\);/s);
});
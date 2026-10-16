import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { isPublicIntegrationRequest, requireApplicationApiAccess } from "../src/routes/api-auth";

function responseRecorder() {
  const result: { statusCode?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      result.statusCode = code;
      return response;
    },
    json(body: unknown) {
      result.body = body;
      return response;
    },
  };
  return { response: response as unknown as Response, result };
}

function runAccessCheck(
  method: string,
  originalUrl: string,
  identity: Record<string, unknown> = {},
) {
  const { response, result } = responseRecorder();
  let nextCalled = false;
  const request = {
    method,
    originalUrl,
    ...identity,
    isAuthenticated: () => Boolean((identity.user as { claims?: { sub?: string } } | undefined)?.claims?.sub),
  } as unknown as Request;

  requireApplicationApiAccess(request, response, (() => {
    nextCalled = true;
  }) as NextFunction);

  return { ...result, nextCalled };
}

test("anonymous application API requests are rejected", () => {
  const result = runAccessCheck("GET", "/api/strategy-plans");
  assert.equal(result.statusCode, 401);
  assert.equal(result.nextCalled, false);
});

test("authenticated customers may read but cannot write application APIs", () => {
  const identity = { teamUser: { id: "customer-1", role: "customer" } };
  const read = runAccessCheck("GET", "/api/strategy-plans", identity);
  assert.equal(read.nextCalled, true);

  const write = runAccessCheck("POST", "/api/strategy-plans", identity);
  assert.equal(write.statusCode, 403);
  assert.equal(write.nextCalled, false);
});

test("team and Replit-authenticated users may write application APIs", () => {
  const team = runAccessCheck("POST", "/api/strategy-plans", {
    teamUser: { id: "team-1", role: "team_member" },
  });
  assert.equal(team.nextCalled, true);

  const replit = runAccessCheck("POST", "/api/strategy-plans", {
    user: { claims: { sub: "replit-user-1" }, expires_at: Math.floor(Date.now() / 1000) + 60 },
  });
  assert.equal(replit.nextCalled, true);
});

test("only exact external integration routes bypass browser-session authentication", () => {
  assert.equal(isPublicIntegrationRequest("POST", "/api/webhook/abc?secret=x"), true);
  assert.equal(isPublicIntegrationRequest("POST", "/api/price-update"), true);
  assert.equal(isPublicIntegrationRequest("POST", "/api/strategy-configs/sync-receive"), true);
  assert.equal(isPublicIntegrationRequest("GET", "/api/webhook-data/webhook/abc"), true);
  assert.equal(isPublicIntegrationRequest("GET", "/api/webhook-registry"), true);

  assert.equal(isPublicIntegrationRequest("POST", "/api/webhooks"), false);
  assert.equal(isPublicIntegrationRequest("POST", "/api/webhook-registry/sync"), false);
  assert.equal(isPublicIntegrationRequest("POST", "/api/webhook/abc/logs/clear-all"), false);
});

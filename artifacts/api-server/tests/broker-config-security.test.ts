import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response, NextFunction } from "express";
import type { BrokerConfig, InsertBrokerConfig } from "@workspace/db";
import {
  preserveConfiguredCredentials,
  requireBrokerReadAccess,
  requireBrokerWriteAccess,
  toPublicBrokerConfig,
} from "../src/routes/broker-config-security";

function mockResponse() {
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

function requestWith(value: Record<string, unknown> = {}): Request {
  return value as unknown as Request;
}

test("public broker config redacts credentials while exposing safe configured flags and expiry", () => {
  const token = `header.${Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString("base64url")}.signature`;
  const config = {
    id: "broker-1",
    brokerName: "kotak_neo",
    consumerKey: "api-token",
    consumerSecret: "consumer-secret",
    mobileNumber: "+910000000000",
    ucc: "AB123",
    mpin: "123456",
    clientId: "client-id",
    accessToken: token,
    sessionId: "sid-session",
    feedUrl: "wss://feed.example",
    viewToken: "view-token",
    sidView: "sid-view",
    lastTotpUsed: "123456",
  } as BrokerConfig;

  const result = toPublicBrokerConfig(config);
  for (const field of [
    "consumerKey",
    "consumerSecret",
    "mobileNumber",
    "ucc",
    "mpin",
    "clientId",
    "accessToken",
    "sessionId",
    "feedUrl",
    "viewToken",
    "sidView",
    "lastTotpUsed",
  ] as const) {
    assert.equal(result[field], null, `${field} should not be returned`);
  }
  assert.equal(result.hasConsumerKey, true);
  assert.equal(result.hasConsumerSecret, true);
  assert.equal(result.hasMobileNumber, true);
  assert.equal(result.hasUcc, true);
  assert.equal(result.hasMpin, true);
  assert.equal(result.sessionExpiresAt, new Date(2_000_000_000 * 1000).toISOString());
});

test("empty secret fields are omitted so profile edits preserve stored credentials", () => {
  const result = preserveConfiguredCredentials({
    name: "Kotak Neo Production",
    consumerKey: "",
    consumerSecret: "  ",
    mobileNumber: "",
    ucc: "",
    mpin: "",
    environment: "prod",
  } satisfies Partial<InsertBrokerConfig>);

  assert.deepEqual(result, {
    name: "Kotak Neo Production",
    environment: "prod",
  });
});

test("broker reads reject anonymous requests but permit authenticated customer status reads", () => {
  const anonymousResponse = mockResponse();
  let anonymousNextCalled = false;
  requireBrokerReadAccess(requestWith(), anonymousResponse.response, (() => {
    anonymousNextCalled = true;
  }) as NextFunction);
  assert.equal(anonymousResponse.result.statusCode, 401);
  assert.equal(anonymousNextCalled, false);

  const customerResponse = mockResponse();
  let customerNextCalled = false;
  requireBrokerReadAccess(
    requestWith({ teamUser: { id: "customer-1", role: "customer" } }),
    customerResponse.response,
    (() => {
      customerNextCalled = true;
    }) as NextFunction,
  );
  assert.equal(customerNextCalled, true);
  assert.equal(customerResponse.result.statusCode, undefined);
});

test("broker writes reject customers and allow team members and Replit-authenticated users", () => {
  const customerResponse = mockResponse();
  let customerNextCalled = false;
  requireBrokerWriteAccess(
    requestWith({ teamUser: { id: "customer-1", role: "customer" } }),
    customerResponse.response,
    (() => {
      customerNextCalled = true;
    }) as NextFunction,
  );
  assert.equal(customerResponse.result.statusCode, 403);
  assert.equal(customerNextCalled, false);

  let teamNextCalled = false;
  requireBrokerWriteAccess(
    requestWith({ teamUser: { id: "team-1", role: "team_member" } }),
    mockResponse().response,
    (() => {
      teamNextCalled = true;
    }) as NextFunction,
  );
  assert.equal(teamNextCalled, true);

  let oidcNextCalled = false;
  requireBrokerWriteAccess(
    requestWith({ user: { claims: { sub: "oidc-user-1" } } }),
    mockResponse().response,
    (() => {
      oidcNextCalled = true;
    }) as NextFunction,
  );
  assert.equal(oidcNextCalled, true);
});

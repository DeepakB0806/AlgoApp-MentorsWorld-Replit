import assert from "node:assert/strict";
import test from "node:test";
import type { BrokerConfig } from "@workspace/db";
import {
  forceReconnect,
  getHsiStatuses,
  refreshConfig,
} from "../src/hsi-kotak-neo";

function config(apiVersion: "v2_legacy" | "v3_current", id: string, connected = true): BrokerConfig {
  return {
    id,
    brokerName: "kotak_neo",
    apiVersion,
    isConnected: connected,
    accessToken: connected ? "test-token" : null,
    sessionId: connected ? "test-session" : null,
  } as BrokerConfig;
}

test("HSI router reports both logical profiles independently", () => {
  const statuses = getHsiStatuses([
    config("v2_legacy", "legacy-config"),
    config("v3_current", "current-config"),
  ]);

  assert.deepEqual(statuses.map(status => status.apiVersion), ["v2_legacy", "v3_current"]);
  assert.deepEqual(statuses.map(status => status.apiVersionLabel), ["Legacy v2", "Current v3"]);
  assert.deepEqual(statuses.map(status => status.lifecycle), ["not_running", "not_running"]);
  assert.deepEqual(statuses.map(status => status.configuredCount), [1, 1]);
});

test("HSI router does not start a gateway from a disconnected credential reset", () => {
  refreshConfig(config("v3_current", "reset-config", false));

  const currentStatus = getHsiStatuses([config("v3_current", "reset-config", false)])
    .find(status => status.apiVersion === "v3_current");

  assert.equal(currentStatus?.lifecycle, "not_configured");
  assert.equal(currentStatus?.runningInstanceCount, 0);
});

test("HSI reconnect stays version-specific when no instances are active", () => {
  assert.equal(forceReconnect("v2_legacy").ok, false);
  assert.equal(forceReconnect("v3_current").ok, false);
});
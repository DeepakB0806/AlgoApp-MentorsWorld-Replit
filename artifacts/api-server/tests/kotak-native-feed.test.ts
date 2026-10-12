import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNativeFeedAuthFrame,
  clearSFeedHeartbeatTimers,
  decodeNativeBatch,
  getNativeFeedStatus,
  getSFeedHeartbeatStatus,
  requestNativeFeedReconnect,
} from "../src/kotak-native-feed";

test("native feed auth uses the session ID rather than the REST access token", () => {
  const frame = buildNativeFeedAuthFrame("UCC-123", "sid-value");
  assert.equal(frame.user, "UCC-123");
  assert.equal(frame.auth, "sid-value");
  assert.equal("accessToken" in frame, false);
  assert.equal(frame.format, "native_batch");
});

test("SFeed heartbeat status is independent from market tick activity", () => {
  const now = 100_000;
  assert.equal(getSFeedHeartbeatStatus(false, false, null, now), "disconnected");
  assert.equal(getSFeedHeartbeatStatus(true, false, null, now), "awaiting_auth");
  assert.equal(getSFeedHeartbeatStatus(true, true, null, now), "awaiting_heartbeat");
  assert.equal(getSFeedHeartbeatStatus(true, true, now - 20_000, now), "healthy");
  assert.equal(getSFeedHeartbeatStatus(true, true, now - 46_000, now), "stale");
  // No tick timestamp is consulted: a quiet market can still have a healthy connection.
});

test("SFeed heartbeat recovery returns to healthy after a fresh pong", () => {
  const now = 100_000;
  assert.equal(getSFeedHeartbeatStatus(true, true, now - 46_000, now), "stale");
  assert.equal(getSFeedHeartbeatStatus(true, true, now, now), "healthy");
});

test("SFeed status exposes HSI-parity connection details without leaking credentials", () => {
  const config = {
    id: "broker-config-1",
    brokerName: "kotak_neo",
    apiVersion: "v3_current",
    isConnected: true,
    feedUrl: "wss://feed.example.test/private-path",
    sessionId: "private-session",
    accessToken: "private-token",
    ucc: "private-ucc",
  };
  const status = getNativeFeedStatus([config as any]);
  const feed = status.feeds[0];

  assert.equal(status.configuredCount, 1);
  assert.equal(status.runningInstanceCount, 0);
  assert.equal(feed.lifecycle, "not_running");
  assert.equal(feed.apiVersion, "v3_current");
  assert.equal(feed.lastConnectedAt, null);
  assert.equal(feed.lastDisconnectedAt, null);
  assert.equal(feed.reconnectDelayMs, 0);
  assert.equal(feed.endpointConfigured, true);
  assert.deepEqual(feed.connectionHistory, []);
  assert.equal(feed.heartbeatStatus, "disconnected");
  assert.equal(feed.lastTickAt, null);

  const serialized = JSON.stringify(status);
  for (const secret of [config.feedUrl, config.sessionId, config.accessToken, config.ucc]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("manual SFeed reconnect refuses an unconfigured feed", () => {
  const config = {
    id: "broker-config-2",
    brokerName: "kotak_neo",
    isConnected: true,
    feedUrl: null,
    sessionId: null,
    ucc: null,
  };
  assert.equal(requestNativeFeedReconnect(config as any), false);
});

test("SFeed heartbeat timers are cleared when the socket closes", async () => {
  let fired = false;
  const timers = {
    heartbeatInterval: setInterval(() => { fired = true; }, 5),
    heartbeatTimeout: setTimeout(() => { fired = true; }, 5),
    pendingPingAt: Date.now(),
  };

  clearSFeedHeartbeatTimers(timers);
  assert.equal(timers.heartbeatInterval, undefined);
  assert.equal(timers.heartbeatTimeout, undefined);
  assert.equal(timers.pendingPingAt, null);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(fired, false);
});

function miniTouchLine(): Buffer {
  const packet = Buffer.alloc(54);
  packet.writeUInt16LE(54, 0);
  packet.writeUInt16LE(7208, 2);
  packet.writeInt8(1, 4); // nse_cm
  packet.writeUInt8(1, 5); // mini touchline
  packet.writeUInt32LE(11536, 9);
  packet.writeUInt32LE(123456, 21);
  return packet;
}

test("decodes Kotak's worked mini-touchline example with exchange divider", () => {
  const dividers = new Map([["nse_cm", 100]]);
  const symbols = new Map([["nse_cm|11536", "SAMPLE"]]);
  const result = decodeNativeBatch(miniTouchLine(), dividers, symbols);
  assert.deepEqual(result, [{ symbol: "SAMPLE", ltp: 1234.56, exchange: "nse_cm", token: "11536" }]);
});

test("skips a truncated batch packet rather than reading beyond its declared length", () => {
  const packet = miniTouchLine().subarray(0, 30);
  const result = decodeNativeBatch(packet, new Map([["nse_cm", 100]]), new Map([["nse_cm|11536", "SAMPLE"]]));
  assert.deepEqual(result, []);
});

test("decodes adjacent packets in one native batch frame", () => {
  const first = miniTouchLine();
  const second = miniTouchLine();
  second.writeUInt32LE(222, 9);
  const result = decodeNativeBatch(Buffer.concat([first, second]), new Map([["nse_cm", 100]]), new Map([
    ["nse_cm|11536", "FIRST"],
    ["nse_cm|222", "SECOND"],
  ]));
  assert.deepEqual(result.map((tick) => tick.symbol), ["FIRST", "SECOND"]);
});

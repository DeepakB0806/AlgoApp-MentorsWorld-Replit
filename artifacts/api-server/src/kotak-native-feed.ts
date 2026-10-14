import WebSocket from "ws";
import type { BrokerConfig } from "@workspace/db";
import { brokerSymbolToTokenMap } from "./smc-kotak-neo-v3";
import { updatePrice } from "./md-kotak-neo-v3";
import { processTick, updateLastWsTick } from "./tsl-kotak-neo-v3";
import type { IStorage } from "./storage";

type FeedState = {
  config: BrokerConfig;
  ws: WebSocket | null;
  subscriptions: Map<string, { exchange: string; token: string }>;
  dividers: Map<string, number>;
  lastTickAt: number | null;
  lastMessageAt: number | null;
  lastHeartbeatAt: number | null;
  heartbeatLatencyMs: number | null;
  pendingPingAt: number | null;
  authenticatedAt: number | null;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  lastError: string | null;
  reconnects: number;
  reconnecting: boolean;
  reconnectDelayMs: number;
  manualReconnectPending: boolean;
  connectionHistory: Array<{ type: "connected" | "disconnected"; timestamp: string }>;
  recentReconnects: number[];
  failures: number;
  marketStatus?: string;
  lastCasAt?: number;
  retryTimer?: NodeJS.Timeout;
  heartbeatInterval?: NodeJS.Timeout;
  heartbeatTimeout?: NodeJS.Timeout;
};

const states = new Map<string, FeedState>();
const exchangeNames = ["none", "nse_cm", "nse_fo", "cde_fo", "nse_com", "bse_cm", "bse_fo", "bse_cd", "bse_co", "mcx_fo", "ncd_co"];
const SFEED_PING_INTERVAL_MS = 20_000;
const SFEED_PONG_TIMEOUT_MS = 10_000;
const SFEED_HEARTBEAT_STALE_MS = 45_000;
const SFEED_HISTORY_LIMIT = 25;

function recordConnectionEvent(state: FeedState, type: "connected" | "disconnected", at = Date.now()) {
  state.connectionHistory.unshift({ type, timestamp: new Date(at).toISOString() });
  state.connectionHistory = state.connectionHistory.slice(0, SFEED_HISTORY_LIMIT);
}

export function getSFeedHeartbeatStatus(
  connected: boolean,
  authenticated: boolean,
  lastHeartbeatAt: number | null,
  now = Date.now(),
): "disconnected" | "awaiting_auth" | "awaiting_heartbeat" | "healthy" | "stale" {
  if (!connected) return "disconnected";
  if (!authenticated) return "awaiting_auth";
  if (lastHeartbeatAt === null) return "awaiting_heartbeat";
  return now - lastHeartbeatAt <= SFEED_HEARTBEAT_STALE_MS ? "healthy" : "stale";
}

export function clearSFeedHeartbeatTimers(
  state: Pick<FeedState, "heartbeatInterval" | "heartbeatTimeout" | "pendingPingAt">,
) {
  if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
  if (state.heartbeatTimeout) clearTimeout(state.heartbeatTimeout);
  state.heartbeatInterval = undefined;
  state.heartbeatTimeout = undefined;
  state.pendingPingAt = null;
}

function sanitizeFeedError(message: string, config: BrokerConfig): string {
  return [config.feedUrl, config.sessionId, config.accessToken, config.ucc]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .reduce((safeMessage, secret) => safeMessage.split(secret).join("[redacted]"), message);
}

export function buildNativeFeedAuthFrame(ucc: string, sessionId: string) {
  // Kotak's native market-feed auth uses the login `sid`, not the REST JWT token.
  return {
    user: ucc,
    auth: sessionId,
    format: "native_batch",
    source: "NEOTRADEAPI",
    sdk_version: 1.1,
    sdk_date: "2026-10-12",
  };
}

export function decodeNativeBatch(frame: Buffer, dividers: Map<string, number>, tokenSymbols: Map<string, string>) {
  const ticks: Array<{ symbol: string; ltp: number; exchange: string; token: string }> = [];
  let offset = 0;
  while (offset + 2 <= frame.length) {
    const size = frame.readUInt16LE(offset);
    if (size < 9 || offset + size > frame.length) break;
    const p = frame.subarray(offset, offset + size);
    const code = p.readUInt16LE(2);
    const exchange = exchangeNames[p.readInt8(4)] || "none";
    const level = p[5];
    const divider = dividers.get(exchange) || 100;
    let token: string | undefined;
    let raw: number | undefined;
    if (code === 7207 && p.length >= 87) {
      token = String(p.readUInt32LE(9));
      raw = p.readInt32LE(29);
    } else if (code === 7208 && level === 1 && p.length >= 54) {
      token = String(p.readUInt32LE(9));
      raw = p.readUInt32LE(21);
    } else if (code === 7208 && [2, 4, 8].includes(level) && p.length >= 144) {
      token = String(p.readUInt32LE(9));
      raw = p.readUInt32LE(69);
      const bids = level === 4 ? 1 : p.readUInt32LE(89);
      const asks = level === 4 ? 1 : p.readUInt32LE(93);
      const availableDepthRows = Math.floor((p.length - 144) / 16);
      // Validate the packed 16-byte depth row boundaries without reading beyond the declared packet.
      for (let row = 0; row < Math.min(bids + asks, availableDepthRows); row++) {
        const depthOffset = 144 + row * 16;
        p.readBigInt64LE(depthOffset);
        p.readInt32LE(depthOffset + 8);
        p.readInt32LE(depthOffset + 12);
      }
    }
    if (token && raw !== undefined) {
      const symbol = tokenSymbols.get(`${exchange}|${token}`) || tokenSymbols.get(token);
      const ltp = raw / divider;
      if (symbol && Number.isFinite(ltp) && ltp > 0) ticks.push({ symbol, ltp, exchange, token });
    }
    offset += size;
  }
  return ticks;
}

function symbolIndex(): Map<string, string> {
  const result = new Map<string, string>();
  brokerSymbolToTokenMap.forEach((token, symbol) => {
    result.set(token, symbol);
    result.set(`nse_fo|${token}`, symbol);
    result.set(`nse_cm|${token}`, symbol);
  });
  return result;
}

function send(state: FeedState, event: string, inputtoken: string) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ event, inputtoken }));
}

function subscribeToken(state: FeedState, exchange: string, token: string) {
  const key = `${exchange}|${token}`;
  if (state.subscriptions.has(key) || state.subscriptions.size >= 3000) return;
  state.subscriptions.set(key, { exchange, token });
  send(state, "subscribeScripsLite", key);
}

function connect(state: FeedState) {
  const feedUrl = state.config.feedUrl?.trim();
  const sessionId = state.config.sessionId;
  const ucc = state.config.ucc;
  if (!feedUrl || !sessionId || !ucc) {
    state.lastError = "Kotak login is missing feed URL, session ID, or UCC";
    return;
  }
  let ws: WebSocket;
  try {
    const url = new URL(feedUrl);
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol !== "wss:" && url.protocol !== "ws:") {
      state.lastError = "Kotak feed URL must use HTTP(S) or WS(S)";
      return;
    }
    ws = new WebSocket(url.toString());
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : "Invalid Kotak feed URL";
    return;
  }
  state.ws = ws;
  state.reconnecting = false;
  ws.on("open", () => {
    state.lastConnectedAt = Date.now();
    recordConnectionEvent(state, "connected", state.lastConnectedAt);
    state.reconnecting = false;
    state.reconnectDelayMs = 0;
    state.manualReconnectPending = false;
    state.authenticatedAt = null;
    state.lastHeartbeatAt = null;
    state.heartbeatLatencyMs = null;
    state.lastMessageAt = Date.now();
    ws.send(JSON.stringify(buildNativeFeedAuthFrame(ucc, sessionId)));
    clearSFeedHeartbeatTimers(state);
    state.heartbeatInterval = setInterval(() => {
      if (state.ws !== ws || ws.readyState !== WebSocket.OPEN) return;
      const pingAt = Date.now();
      state.pendingPingAt = pingAt;
      try {
        ws.ping();
        if (state.heartbeatTimeout) clearTimeout(state.heartbeatTimeout);
        state.heartbeatTimeout = setTimeout(() => {
          if (state.ws !== ws || state.pendingPingAt !== pingAt) return;
          state.lastError = "Kotak SFeed heartbeat timed out waiting for pong";
          state.failures++;
          ws.terminate();
        }, SFEED_PONG_TIMEOUT_MS);
      } catch (error) {
        state.lastError = sanitizeFeedError(error instanceof Error ? error.message : "Failed to send Kotak SFeed heartbeat", state.config);
        state.failures++;
        ws.terminate();
      }
    }, SFEED_PING_INTERVAL_MS);
  });
  ws.on("pong", () => {
    if (state.ws !== ws) return;
    const now = Date.now();
    state.lastHeartbeatAt = now;
    state.heartbeatLatencyMs = state.pendingPingAt === null ? null : now - state.pendingPingAt;
    state.pendingPingAt = null;
    if (state.heartbeatTimeout) clearTimeout(state.heartbeatTimeout);
    state.heartbeatTimeout = undefined;
  });
  ws.on("message", (data, isBinary) => {
    state.lastMessageAt = Date.now();
    try {
      if (isBinary) {
        const frame = Buffer.from(data as Buffer);
        for (let pos = 0; pos + 9 <= frame.length;) {
          const packetSize = frame.readUInt16LE(pos);
          if (packetSize < 9 || pos + packetSize > frame.length) break;
          const packet = frame.subarray(pos, pos + packetSize);
          const code = packet.readUInt16LE(2);
          if (code === 105 && packet.length >= 16) {
            state.marketStatus = `${packet.readUInt16LE(9)}:${packet.toString("utf8", 11, 16).replace(/\0/g, "").trim()}`;
          } else if (code === 104 && packet.length >= 48) {
            state.lastCasAt = Date.now();
          }
          pos += packetSize;
        }
        for (const tick of decodeNativeBatch(frame, state.dividers, symbolIndex())) {
          updatePrice(tick.symbol, tick.ltp);
          processTick(tick.symbol, tick.ltp);
          state.lastTickAt = Date.now();
          state.failures = 0;
          updateLastWsTick();
        }
        return;
      }
      const msg = JSON.parse(data.toString());
      if (msg.message_code === 1119 || msg.message_code === 1117) {
        if (msg.format && msg.format !== "native_batch") {
          state.lastError = `Kotak downgraded feed format to ${msg.format}; refusing incompatible payloads`;
          state.failures++;
          ws.close();
          return;
        }
        state.dividers.clear();
        for (const [exchange, item] of Object.entries(msg.exchanges || {}) as Array<[string, any]>) {
          state.dividers.set(exchange, Number(item?.divider) || 100);
        }
        if (msg.message_code === 1117) {
          state.authenticatedAt = Date.now();
          state.lastError = null;
          state.failures = 0;
          for (const sub of state.subscriptions.values()) {
            send(state, "subscribeScripsLite", `${sub.exchange}|${sub.token}`);
          }
        }
      } else if (msg.message_code === 1120) {
        state.authenticatedAt = null;
        state.lastError = `Kotak market-feed authentication failed: ${msg.message || "unknown reason"}`;
        state.failures++;
        ws.close();
      } else if (msg.message_code === 1109 && msg.status && !/ok|success/i.test(String(msg.status))) {
        state.lastError = `Kotak subscription rejected: ${msg.message || msg.status}`;
        state.failures++;
      }
    } catch {
      state.lastError = "Kotak feed sent an invalid control frame";
      state.failures++;
    }
  });
  ws.on("error", (error) => {
    state.lastError = sanitizeFeedError(error.message, state.config);
    state.failures++;
  });
  ws.on("close", () => {
    clearSFeedHeartbeatTimers(state);
    const disconnectedAt = Date.now();
    state.lastDisconnectedAt = disconnectedAt;
    recordConnectionEvent(state, "disconnected", disconnectedAt);
    state.authenticatedAt = null;
    if (state.ws === ws) state.ws = null;
    state.reconnects++;
    state.recentReconnects = state.recentReconnects.filter((at) => Date.now() - at < 300_000);
    state.recentReconnects.push(disconnectedAt);
    if (state.retryTimer) clearTimeout(state.retryTimer);
    if (state.config.isConnected) {
      state.reconnecting = true;
      state.reconnectDelayMs = state.manualReconnectPending
        ? 0
        : Math.min(30_000, 1000 * 2 ** Math.min(state.reconnects, 5));
      state.manualReconnectPending = false;
      state.retryTimer = setTimeout(() => {
        state.retryTimer = undefined;
        connect(state);
      }, state.reconnectDelayMs);
    } else {
      state.reconnecting = false;
      state.reconnectDelayMs = 0;
    }
  });
}

export async function startNativeFeed(storage: IStorage) {
  const configs = (await storage.getBrokerConfigs()).filter((c) => c.brokerName === "kotak_neo" && !c.isArchived && c.isConnected);
  for (const config of configs) {
    const plans = await storage.getStrategyPlansByConfig(config.id);
    configureNativeFeed(config, plans
      .filter((plan) => plan.deploymentStatus === "active" || plan.deploymentStatus === "deployed")
      .map((plan) => plan.ticker)
      .filter((ticker): ticker is string => !!ticker));
  }
}

export function configureNativeFeed(config: BrokerConfig, initialSymbols: string[] = []) {
  if (config.isArchived || !config.isConnected) {
    stopNativeFeed(config.id);
    return;
  }
  let state = states.get(config.id);
  if (state?.ws) {
    state.config = config;
    for (const symbol of initialSymbols) {
      const token = brokerSymbolToTokenMap.get(symbol);
      if (token) subscribeToken(state, "nse_fo", token);
    }
    state.ws.close();
    return;
  }
  state = {
    config,
    ws: null,
    subscriptions: new Map(),
    dividers: new Map(),
    lastTickAt: null,
    lastMessageAt: null,
    lastHeartbeatAt: null,
    heartbeatLatencyMs: null,
    pendingPingAt: null,
    authenticatedAt: null,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastError: null,
    reconnects: 0,
    reconnecting: false,
    reconnectDelayMs: 0,
    manualReconnectPending: false,
    connectionHistory: [],
    recentReconnects: [],
    failures: 0,
  };
  states.set(config.id, state);
  for (const symbol of initialSymbols) {
    const token = brokerSymbolToTokenMap.get(symbol);
    if (token) subscribeToken(state, "nse_fo", token);
  }
  connect(state);
}

export function stopNativeFeed(brokerConfigId: string) {
  const state = states.get(brokerConfigId);
  if (!state) return;
  state.config = { ...state.config, isConnected: false };
  if (state.retryTimer) clearTimeout(state.retryTimer);
  state.retryTimer = undefined;
  clearSFeedHeartbeatTimers(state);
  state.ws?.close();
  states.delete(brokerConfigId);
}

export function requestNativeFeedReconnect(config: BrokerConfig, initialSymbols: string[] = []) {
  if (config.isArchived || !config.isConnected || !config.feedUrl || !config.sessionId || !config.ucc) return false;
  const state = states.get(config.id);
  if (!state) {
    configureNativeFeed(config, initialSymbols);
    return true;
  }

  state.config = config;
  if (state.retryTimer) clearTimeout(state.retryTimer);
  state.retryTimer = undefined;
  state.manualReconnectPending = true;
  state.reconnecting = true;
  state.reconnectDelayMs = 0;
  for (const symbol of initialSymbols) {
    const token = brokerSymbolToTokenMap.get(symbol);
    if (token) subscribeToken(state, "nse_fo", token);
  }
  if (!state.ws || state.ws.readyState === WebSocket.CLOSED) {
    state.ws = null;
    state.reconnecting = false;
    state.manualReconnectPending = false;
    connect(state);
  } else {
    state.ws.close();
  }
  return true;
}

export function subscribeNativeSymbol(symbol: string) {
  const token = brokerSymbolToTokenMap.get(symbol);
  if (!token) return;
  for (const state of states.values()) subscribeToken(state, "nse_fo", token);
}

export function snapshotNativeSymbol(symbol: string) {
  const token = brokerSymbolToTokenMap.get(symbol);
  if (!token) return;
  for (const state of states.values()) send(state, "snapshotScripsLite", `nse_fo|${token}`);
}

export function getNativeFeedStatus(configs?: BrokerConfig[]) {
  const now = Date.now();
  const sourceConfigs = configs?.filter((config) => config.brokerName === "kotak_neo" && !config.isArchived)
    ?? [...states.values()].map((state) => state.config);
  const rows = sourceConfigs.map((config) => {
    const s = states.get(config.id);
    const ageMs = s?.lastTickAt == null ? null : now - s.lastTickAt;
    if (s) s.recentReconnects = s.recentReconnects.filter((at) => now - at < 300_000);
    const connected = s?.ws?.readyState === WebSocket.OPEN;
    const connecting = s?.ws?.readyState === WebSocket.CONNECTING;
    const authenticated = connected && s?.authenticatedAt !== null;
    const endpointConfigured = Boolean(config.feedUrl?.trim());
    const credentialsReady = Boolean(endpointConfigured && config.sessionId && config.ucc);
    const running = Boolean(config.isConnected && s);
    const lifecycle = !credentialsReady ? "not_configured" : running ? "running" : "not_running";
    const heartbeatStatus = getSFeedHeartbeatStatus(connected, authenticated, s?.lastHeartbeatAt ?? null, now);
    const reasons: string[] = [];
    if (!connected) reasons.push("WebSocket is disconnected");
    else if (!authenticated) reasons.push("Kotak feed authentication not confirmed");
    if (ageMs === null) reasons.push("No valid market tick received yet");
    else if (ageMs > 10_000) reasons.push(`Last valid tick is ${Math.round(ageMs / 1000)}s old`);
    else if (ageMs > 3_000) reasons.push(`Tick age is elevated (${Math.round(ageMs / 1000)}s)`);
    if (s?.failures) reasons.push(`${s.failures} recent transport/auth/decode failure(s)`);
    if (s?.recentReconnects.length) reasons.push(`${s.recentReconnects.length} reconnect(s) in the last 5 minutes`);
    const score = Math.min(100, (connected ? 0 : 30) + (s?.failures ?? 0) * 20 + (s?.recentReconnects.length ?? 0) * 15 + (ageMs === null ? 65 : ageMs > 10_000 ? 40 : ageMs > 3_000 ? 20 : 0));
    return {
      brokerConfigId: config.id,
      apiVersion: config.apiVersion ?? null,
      lifecycle,
      configuredCount: 1,
      runningInstanceCount: running ? 1 : 0,
      connectedInstanceCount: connected ? 1 : 0,
      authenticatedInstanceCount: authenticated ? 1 : 0,
      connectionMode: s ? "direct" : null,
      connecting,
      reconnecting: s?.reconnecting ?? false,
      reconnectDelayMs: s?.reconnectDelayMs ?? 0,
      connected,
      authenticated,
      authenticatedAt: s?.authenticatedAt ? new Date(s.authenticatedAt).toISOString() : null,
      status: score >= 60 ? "critical" : score >= 25 ? "degraded" : "healthy",
      riskScore: score,
      riskReasons: reasons,
      heartbeatStatus,
      lastHeartbeatAt: s?.lastHeartbeatAt ? new Date(s.lastHeartbeatAt).toISOString() : null,
      heartbeatLatencyMs: s?.heartbeatLatencyMs ?? null,
      lastMessageAt: s?.lastMessageAt ? new Date(s.lastMessageAt).toISOString() : null,
      lastTickAt: s?.lastTickAt ? new Date(s.lastTickAt).toISOString() : null,
      lastConnectedAt: s?.lastConnectedAt ? new Date(s.lastConnectedAt).toISOString() : null,
      lastDisconnectedAt: s?.lastDisconnectedAt ? new Date(s.lastDisconnectedAt).toISOString() : null,
      lastError: s?.lastError ? sanitizeFeedError(s.lastError, config) : (!credentialsReady ? "Feed URL or login session is not configured" : null),
      reconnects: s?.reconnects ?? 0,
      recentReconnects: s?.recentReconnects.length ?? 0,
      subscriptions: s?.subscriptions.size ?? 0,
      marketStatus: s?.marketStatus ?? null,
      lastCasAt: s?.lastCasAt ? new Date(s.lastCasAt).toISOString() : null,
      endpointConfigured,
      connectionHistory: s?.connectionHistory.slice(0, 6) ?? [],
    };
  });
  const connectedInstanceCount = rows.filter((row) => row.connected).length;
  const authenticatedInstanceCount = rows.filter((row) => row.authenticated).length;
  return {
    status: rows.some((r) => r.status === "critical") || rows.length === 0 ? "critical" : rows.some((r) => r.status === "degraded") ? "degraded" : "healthy",
    configuredCount: sourceConfigs.length,
    runningInstanceCount: rows.filter((row) => row.lifecycle === "running").length,
    connectedInstanceCount,
    authenticatedInstanceCount,
    feeds: rows,
  };
}

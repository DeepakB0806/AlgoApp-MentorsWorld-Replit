import WebSocket from "ws";
import type { IStorage } from "./storage";
import type { BrokerConfig } from "@workspace/db";
import {
  getKotakApiProfileInfo,
  KOTAK_API_VERSIONS,
  normalizeKotakApiVersion,
  type KotakApiVersion,
} from "./kotak-api-adapter";
import { runProbe, getProbeThreshold } from "./kotak-probe";
import { processTick, updateLastWsTick } from "./tsl-kotak-neo-v3";

// This module is the isolated Current v3 implementation. The v4 suffix is an
// implementation-generation name; the logical Kotak profile remains v3_current.
const LOG_PREFIX = "[HSI-v4]";
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_HISTORY = 20;

type GatewayLifecycle = "running" | "not_running" | "not_configured";
type OrderConfirmCallback = (result: { avgPrc: number; source: "trade" | "order" }) => void;
type OrderRejectCallback = (reason: string) => void;
type ConnectionEvent = { type: "connected" | "disconnected"; timestamp: string };

interface HsiState {
  ws: WebSocket | null;
  reconnectDelay: number;
  reconnectTimer: NodeJS.Timeout | null;
  heartbeatInterval: NodeJS.Timeout | null;
  statusInterval: NodeJS.Timeout | null;
  relayFailed: boolean;
  zombieCount: number;
  authOk: boolean;
  consecutiveFailures: number;
  lastConnectedAt: Date | null;
  lastHeartbeatAt: Date | null;
  lastDisconnectedAt: Date | null;
  previousOpen: boolean;
  activeConfig: BrokerConfig;
  activeStorage: IStorage;
  hsiUrl: string;
  connectionHistory: ConnectionEvent[];
}

const instances = new Map<string, HsiState>();
const orderConfirmRegistry = new Map<string, OrderConfirmCallback>();
const orderRejectRegistry = new Map<string, OrderRejectCallback>();
const exitOrderRegistry = new Map<string, string>();

export interface HsiVersionStatus {
  apiVersion: KotakApiVersion;
  apiVersionLabel: string;
  lifecycle: GatewayLifecycle;
  configuredCount: number;
  runningInstanceCount: number;
  connectedInstanceCount: number;
  authenticatedInstanceCount: number;
  connected: boolean;
  reconnecting: boolean;
  authOk: boolean;
  connectionMode: "relay" | "direct";
  reconnectAttempts: number;
  reconnectDelayMs: number;
  lastConnectedAt: string | null;
  lastHeartbeatAt: string | null;
  lastDisconnectedAt: string | null;
  hsiUrl: string;
  zombieCount: number;
}

export function registerOrderCallback(orderId: string, cb: OrderConfirmCallback): void {
  orderConfirmRegistry.set(orderId, cb);
}

export function deregisterOrderCallback(orderId: string): void {
  orderConfirmRegistry.delete(orderId);
}

export function registerOrderRejectCallback(orderId: string, cb: OrderRejectCallback): void {
  orderRejectRegistry.set(orderId, cb);
}

export function deregisterOrderRejectCallback(orderId: string): void {
  orderRejectRegistry.delete(orderId);
}

export function registerExitOrder(closeOrderId: string, tradeId: string): void {
  exitOrderRegistry.set(closeOrderId, tradeId);
}

export function deregisterExitOrder(closeOrderId: string): void {
  exitOrderRegistry.delete(closeOrderId);
}

async function handleOrderConfirm(
  orderId: string,
  avgPrc: number,
  source: "trade" | "order",
  storage: IStorage,
): Promise<void> {
  const callback = orderConfirmRegistry.get(orderId);
  if (callback) callback({ avgPrc, source });

  try {
    const trade = await storage.getTradeByOrderId(orderId);
    if (trade && trade.status === "open" && avgPrc > 0) {
      await storage.updateStrategyTrade(trade.id, { price: avgPrc });
      console.log(`${LOG_PREFIX} Entry fill confirmed: ${trade.tradingSymbol} orderId=${orderId} avgPrc=${avgPrc} [${source}]`);
    }
  } catch (error: any) {
    console.error(`${LOG_PREFIX} Entry fill DB update failed for ${orderId}:`, error?.message || error);
  }

  const tradeId = exitOrderRegistry.get(orderId);
  if (!tradeId) return;
  deregisterExitOrder(orderId);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const trade = await storage.getStrategyTrade(tradeId);
      if (!trade || (trade.status === "closed" && (trade.exitPrice ?? 0) > 0)) return;
      const entryPrice = trade.price || 0;
      const quantity = trade.quantity || 1;
      const pnl = trade.action === "BUY"
        ? (avgPrc - entryPrice) * quantity
        : (entryPrice - avgPrc) * quantity;
      const now = new Date().toISOString();
      await storage.updateStrategyTrade(tradeId, {
        status: "closed",
        exitPrice: avgPrc,
        ltp: avgPrc,
        pnl: Math.round(pnl * 100) / 100,
        exitedAt: now,
        updatedAt: now,
      });
      console.log(`${LOG_PREFIX} Exit confirmed via HSI: tradeId=${tradeId} avgPrc=${avgPrc} pnl=${pnl.toFixed(2)} [${source}]`);
      return;
    } catch (error: any) {
      if (attempt === 3) {
        console.error(`${LOG_PREFIX} Exit DB write failed after 3 retries — tradeId=${tradeId}:`, error?.message || error);
      } else {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
}

function resolveHsiUrl(config: BrokerConfig): string {
  const dc = (config.dataCenter || "").toLowerCase().trim();
  if (dc === "adc") return "wss://cis.kotaksecurities.com/realtime";
  if (dc === "e21") return "wss://e21.kotaksecurities.com/realtime";
  if (dc === "e22") return "wss://e22.kotaksecurities.com/realtime";
  if (dc === "e41") return "wss://e41.kotaksecurities.com/realtime";
  if (dc === "e43") return "wss://e43.kotaksecurities.com/realtime";
  return "wss://mis.kotaksecurities.com/realtime";
}

function buildAuthMessage(config: BrokerConfig): object {
  return {
    type: "cn",
    Authorization: config.accessToken,
    Sid: config.sessionId,
    src: "WEB",
  };
}

function pushEvent(state: HsiState, type: ConnectionEvent["type"]): void {
  state.connectionHistory.push({ type, timestamp: new Date().toISOString() });
  if (state.connectionHistory.length > MAX_HISTORY) state.connectionHistory.shift();
}

function startStatusTracking(state: HsiState): void {
  if (state.statusInterval) clearInterval(state.statusInterval);
  state.previousOpen = false;
  state.statusInterval = setInterval(() => {
    const open = state.ws?.readyState === WebSocket.OPEN;
    if (open && !state.previousOpen) pushEvent(state, "connected");
    if (!open && state.previousOpen) pushEvent(state, "disconnected");
    if (open) state.lastHeartbeatAt = new Date();
    state.previousOpen = open;
  }, 20_000);
}

function getStatusForState(state: HsiState) {
  const connected = state.ws?.readyState === WebSocket.OPEN;
  const reconnecting = !connected && state.reconnectTimer !== null;
  const reconnectAttempts = state.reconnectDelay > 1_000
    ? Math.round(Math.log2(state.reconnectDelay / 1_000))
    : 0;
  const usingRelay = !state.relayFailed && !!(process.env.RELAY_TARGET_URL && process.env.RELAY_SECRET_KEY);
  return {
    apiVersion: normalizeKotakApiVersion(state.activeConfig.apiVersion),
    brokerConfigId: state.activeConfig.id,
    connected,
    reconnecting,
    authOk: state.authOk,
    connectionMode: usingRelay ? "relay" as const : "direct" as const,
    reconnectAttempts,
    reconnectDelayMs: state.reconnectDelay,
    lastConnectedAt: state.lastConnectedAt?.toISOString() ?? null,
    lastHeartbeatAt: state.lastHeartbeatAt?.toISOString() ?? null,
    lastDisconnectedAt: state.lastDisconnectedAt?.toISOString() ?? null,
    hsiUrl: state.hsiUrl,
    zombieCount: state.zombieCount,
  };
}

function connect(config: BrokerConfig, state: HsiState): void {
  if (normalizeKotakApiVersion(config.apiVersion) !== "v3_current") return;
  if (!config.accessToken || !config.sessionId) {
    console.error(`${LOG_PREFIX} Missing accessToken/sessionId. Cannot connect Current v3 HSI.`);
    return;
  }

  const relayUrl = process.env.RELAY_TARGET_URL;
  const relaySecret = process.env.RELAY_SECRET_KEY;
  let opened = false;
  let usingRelay = false;

  try {
    if (relayUrl && relaySecret && !state.relayFailed) {
      usingRelay = true;
      const wsRelayUrl = relayUrl.replace("http://", "ws://").replace("https://", "wss://");
      state.ws = new WebSocket(`${wsRelayUrl}/realtime`, {
        headers: { "x-target-url": state.hsiUrl, "x-relay-secret": relaySecret },
      });
    } else {
      state.ws = new WebSocket(state.hsiUrl);
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} WebSocket construction error:`, error);
    scheduleReconnect(config, state);
    return;
  }

  state.ws.on("open", () => {
    opened = true;
    state.authOk = false;
    state.lastConnectedAt = new Date();
    state.reconnectDelay = 1_000;
    try {
      state.ws!.send(JSON.stringify(buildAuthMessage(config)).replace(/"/g, ""));
      console.log(`${LOG_PREFIX} Connected ${usingRelay ? "via relay" : "directly"}; auth sent for Current v3 (redacted)`);
    } catch (error) {
      console.error(`${LOG_PREFIX} Auth send error:`, error);
    }
  });

  state.ws.on("message", (raw: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (usingRelay && msg.msg === "session message format incorrect") {
        state.relayFailed = true;
        console.warn(`${LOG_PREFIX} Relay rejected the session format; switching to direct on reconnect`);
      }
      const type: string = msg.type || "";
      if (type === "failed to process request") {
        if (usingRelay) state.zombieCount++;
        if (usingRelay && state.zombieCount >= 3) state.relayFailed = true;
        try { state.ws?.terminate(); } catch {}
        state.ws = null;
        return;
      }
      if (type === "cn" && msg.ak === "ok") {
        state.zombieCount = 0;
        state.authOk = true;
        state.consecutiveFailures = 0;
        console.log(`${LOG_PREFIX} Current v3 HSI authentication confirmed`);
        return;
      }

      const data = msg.data || msg;
      if (type === "trade" || type === "position") {
        const symbol = data.trdSym || data.ts;
        const ltp = data.ltp ?? data.lp;
        if (symbol && ltp != null) {
          processTick(symbol, Number(ltp));
          updateLastWsTick();
        }
        const orderId = data.nOrdNo || "";
        const tradeLtp = Number(data.ltp ?? data.lp ?? 0);
        if (orderId && tradeLtp > 0) {
          handleOrderConfirm(orderId, tradeLtp, "trade", state.activeStorage).catch(() => {});
        }
        return;
      }

      if (type === "order") {
        const orderId: string = data.nOrdNo || "";
        const orderStatus = String(data.ordSt || "").toLowerCase();
        if (orderStatus === "complete") {
          const avgPrc = Number(data.avgPrc || 0);
          if (orderId && avgPrc > 0) {
            handleOrderConfirm(orderId, avgPrc, "order", state.activeStorage).catch(() => {});
          }
        } else if (orderStatus === "rejected" || orderStatus === "cancelled") {
          const reason = String(data.rejRsn || "").toLowerCase();
          const callback = orderRejectRegistry.get(orderId);
          if (callback) {
            orderRejectRegistry.delete(orderId);
            callback(reason);
          }
          if (reason && reason !== "--") {
            state.activeStorage.getActiveErrorRoutes().then(routes => {
              for (const route of routes) {
                if (reason.includes(route.errorPattern.toLowerCase())) {
                  console.warn(`${LOG_PREFIX} Matched error route id=${route.id} action=${route.actionType}`);
                  break;
                }
              }
            }).catch(() => {});
          }
        }
      }
    } catch {
      console.warn(`${LOG_PREFIX} Ignored non-JSON or malformed HSI message`);
    }
  });

  state.ws.on("close", (code: number, reason: Buffer) => {
    state.lastDisconnectedAt = new Date();
    if (!state.authOk) {
      state.consecutiveFailures++;
      if (state.consecutiveFailures >= getProbeThreshold()) {
        runProbe(state.activeConfig, "hsi").catch(() => {});
      }
    }
    state.ws = null;
    console.log(`${LOG_PREFIX} Disconnected code=${code} reason="${reason?.toString() || ""}"`);
    scheduleReconnect(config, state);
  });

  state.ws.on("error", (error) => {
    if (!opened && usingRelay && !state.relayFailed) {
      state.relayFailed = true;
      console.warn(`${LOG_PREFIX} Relay unreachable; direct connection will be used`);
    }
    console.error(`${LOG_PREFIX} WS error:`, error.message);
  });
}

function scheduleReconnect(config: BrokerConfig, state: HsiState): void {
  if (state.reconnectTimer) return;
  const delay = state.reconnectDelay;
  state.reconnectDelay = Math.min(state.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect(config, state);
  }, delay);
}

function startHeartbeat(state: HsiState): void {
  if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
  state.heartbeatInterval = setInterval(() => {
    if (state.ws?.readyState === WebSocket.OPEN) {
      try { state.ws.ping(); } catch {}
      try { state.ws.send('{"type":"hb"}'); } catch {}
      state.lastHeartbeatAt = new Date();
    }
  }, 20_000);
}

function createState(config: BrokerConfig, storage: IStorage): HsiState {
  return {
    ws: null,
    reconnectDelay: 1_000,
    reconnectTimer: null,
    heartbeatInterval: null,
    statusInterval: null,
    relayFailed: false,
    zombieCount: 0,
    authOk: false,
    consecutiveFailures: 0,
    lastConnectedAt: null,
    lastHeartbeatAt: null,
    lastDisconnectedAt: null,
    previousOpen: false,
    activeConfig: config,
    activeStorage: storage,
    hsiUrl: resolveHsiUrl(config),
    connectionHistory: [],
  };
}

function resetAndConnect(state: HsiState, config: BrokerConfig): void {
  if (state.ws) {
    state.ws.removeAllListeners();
    try { state.ws.terminate(); } catch {}
    state.ws = null;
  }
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  state.relayFailed = false;
  state.zombieCount = 0;
  state.authOk = false;
  state.reconnectDelay = 1_000;
  state.lastConnectedAt = null;
  state.lastHeartbeatAt = null;
  state.lastDisconnectedAt = null;
  state.activeConfig = config;
  state.hsiUrl = resolveHsiUrl(config);
  connect(config, state);
  startHeartbeat(state);
  startStatusTracking(state);
}

export function refreshConfig(config: BrokerConfig): void {
  if (normalizeKotakApiVersion(config.apiVersion) !== "v3_current") return;
  let state = instances.get(config.id);
  if (!state) {
    if (!currentStorage) return;
    state = createState(config, currentStorage);
    instances.set(config.id, state);
  }
  resetAndConnect(state, config);
}

let currentStorage: IStorage | null = null;

export async function startHsiGateway(storage: IStorage): Promise<void> {
  currentStorage = storage;
  try {
    const configs = await storage.getBrokerConfigs();
    const currentConfigs = configs.filter(config =>
      config.brokerName === "kotak_neo" &&
      config.isConnected &&
      normalizeKotakApiVersion(config.apiVersion) === "v3_current",
    );
    for (const config of currentConfigs) {
      if (instances.has(config.id)) continue;
      const state = createState(config, storage);
      instances.set(config.id, state);
      console.log(`${LOG_PREFIX} Starting Current v3 HSI for UCC=${config.ucc ?? config.id} URL=${state.hsiUrl}`);
      connect(config, state);
      startHeartbeat(state);
      startStatusTracking(state);
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} startHsiGateway error (non-fatal):`, error);
  }
}

export function forceReconnect(apiVersion?: KotakApiVersion): { ok: boolean; message: string } {
  if (apiVersion && apiVersion !== "v3_current") {
    return { ok: false, message: "Current v3 HSI has no matching Legacy v2 instance" };
  }
  const states = [...instances.values()];
  if (states.length === 0) {
    return { ok: false, message: "No active Current v3 broker config — HSI was never started" };
  }
  for (const state of states) resetAndConnect(state, state.activeConfig);
  return { ok: true, message: "HSI Current v3 reconnect triggered" };
}

export function getHsiStatus() {
  const state = instances.values().next().value as HsiState | undefined;
  return state
    ? getStatusForState(state)
    : {
        connected: false,
        reconnecting: false,
        authOk: false,
        connectionMode: "direct" as const,
        reconnectAttempts: 0,
        reconnectDelayMs: 1_000,
        lastConnectedAt: null,
        lastHeartbeatAt: null,
        lastDisconnectedAt: null,
        hsiUrl: "",
        zombieCount: 0,
      };
}

export function getHsiStatuses(configs: BrokerConfig[] = []): HsiVersionStatus[] {
  const connectedConfigs = configs.filter(config => config.brokerName === "kotak_neo" && config.isConnected);
  const states = [...instances.values()];
  return KOTAK_API_VERSIONS.map(apiVersion => {
    const versionConfigs = connectedConfigs.filter(config => normalizeKotakApiVersion(config.apiVersion) === apiVersion);
    const versionStates = states.filter(state => normalizeKotakApiVersion(state.activeConfig.apiVersion) === apiVersion);
    const primary = versionStates.find(state => state.ws?.readyState === WebSocket.OPEN) ?? versionStates[0];
    const base = primary
      ? getStatusForState(primary)
      : {
          connected: false,
          reconnecting: false,
          authOk: false,
          connectionMode: "direct" as const,
          reconnectAttempts: 0,
          reconnectDelayMs: 1_000,
          lastConnectedAt: null,
          lastHeartbeatAt: null,
          lastDisconnectedAt: null,
          hsiUrl: "",
          zombieCount: 0,
        };
    return {
      ...base,
      apiVersion,
      apiVersionLabel: getKotakApiProfileInfo(apiVersion).label,
      lifecycle: versionStates.length > 0 ? "running" : versionConfigs.length > 0 ? "not_running" : "not_configured",
      configuredCount: versionConfigs.length || versionStates.length,
      runningInstanceCount: versionStates.length,
      connectedInstanceCount: versionStates.filter(state => state.ws?.readyState === WebSocket.OPEN).length,
      authenticatedInstanceCount: versionStates.filter(state => state.authOk).length,
    };
  });
}

export function getHsiHistory(): ConnectionEvent[] {
  const state = instances.values().next().value as HsiState | undefined;
  return state ? [...state.connectionHistory].reverse() : [];
}

export function getHsiHistories(): Record<KotakApiVersion, ConnectionEvent[]> {
  const histories = Object.fromEntries(
    KOTAK_API_VERSIONS.map(apiVersion => [apiVersion, [] as ConnectionEvent[]]),
  ) as Record<KotakApiVersion, ConnectionEvent[]>;
  for (const state of instances.values()) {
    const apiVersion = normalizeKotakApiVersion(state.activeConfig.apiVersion);
    histories[apiVersion].push(...state.connectionHistory);
  }
  for (const apiVersion of KOTAK_API_VERSIONS) {
    histories[apiVersion].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
  return histories;
}
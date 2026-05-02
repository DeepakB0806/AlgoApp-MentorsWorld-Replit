import WebSocket from "ws";
import * as marketData from "./md-kotak-neo-v3";
import { brokerSymbolToTokenMap } from "./smc-kotak-neo-v3";
import type { IStorage } from "./storage";
import type { BrokerConfig } from "@shared/schema";
import { runProbe, getProbeThreshold } from "./kotak-probe";

// ⚠️ SPECIAL INSTRUCTION: NO AI OR DEVELOPER IS PERMITTED TO UNLOCK, MODIFY, OR TAMPER WITH ANY 🔒 LOCKED BLOCK WITHOUT EXPLICIT, PRIOR AUTHORIZATION FROM THE USER.
// ⚠️ CODING RULE: Any task that requires modifying a 🔒 LOCKED BLOCK MUST (a) explicitly name the locked block in the task description, and (b) obtain the user's written permission before the block is opened. No exceptions.
//
// 📋 HSM PERMANENT INVARIANTS — rules established through production incidents; never reverse without user sign-off:
//   [HSM-1] connect relay→direct auto-fallback: relayFailed=true on first connection failure. Never remove this fallback path.
//   [HSM-2] subscriptions.forEach() — NOT Array.from(subscriptions). OOM constraint.
//   [HSM-3] scheduleReconnect uses exponential backoff capped at MAX_RECONNECT_DELAY_MS; reconnectTimer tracked.
//   [HSM-4] startHsmHeartbeat: 30 s ti heartbeat, interval tracked in heartbeatInterval.

const LOG_PREFIX = "[HSM]";
const MAX_RECONNECT_DELAY_MS = 30_000;
const HSM_URL = "wss://mlhsm.kotaksecurities.com";

const subscriptions = new Map<string, true>();
let ws: WebSocket | null = null;
let reconnectDelay = 1_000;
let activeConfig: BrokerConfig | null = null;
let relayFailed = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

// ── HSM Probe auto-trigger (Build #164, outside locked blocks) ────────────────
let hsmConsecutiveFailures = 0;
let hsmAuthOkInSession = false;
function checkHsmAutoProbe(): void {
  const threshold = getProbeThreshold();
  if (hsmConsecutiveFailures >= threshold && activeConfig) {
    console.log(`[HSM] ${hsmConsecutiveFailures} consecutive reconnects without auth_ok — auto-running probe`);
    runProbe(activeConfig, "hsm").catch(() => {});
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// ── HSM Status tracking (outside locked blocks) ──────────────────────────────
let hsmLastConnectedAt: Date | null = null;
let hsmLastHeartbeatAt: Date | null = null;
let hsmStatusInterval: NodeJS.Timeout | null = null;
let _hsmPrevOpen = false;
let hsmLastDisconnectedAt: Date | null = null;

interface ConnectionEvent { type: "connected" | "disconnected"; timestamp: string; }
const MAX_HISTORY = 20;
const hsmConnectionHistory: ConnectionEvent[] = [];
function pushHsmEvent(type: "connected" | "disconnected"): void {
  hsmConnectionHistory.push({ type, timestamp: new Date().toISOString() });
  if (hsmConnectionHistory.length > MAX_HISTORY) hsmConnectionHistory.shift();
}

function startHsmStatusTracking(): void {
  if (hsmStatusInterval) clearInterval(hsmStatusInterval);
  _hsmPrevOpen = false;
  hsmStatusInterval = setInterval(() => {
    const nowOpen = ws !== null && ws.readyState === WebSocket.OPEN;
    if (nowOpen && !_hsmPrevOpen) {
      hsmLastConnectedAt = new Date();
      pushHsmEvent("connected");
    }
    if (!nowOpen && _hsmPrevOpen) {
      hsmLastDisconnectedAt = new Date();
      pushHsmEvent("disconnected");
    }
    if (nowOpen) {
      hsmLastHeartbeatAt = new Date();
    }
    _hsmPrevOpen = nowOpen;
  }, 20_000);
}

export function isHsmAuthOk(): boolean {
  return hsmAuthOkInSession;
}

export function getHsmStatus() {
  const isConnected = ws !== null && ws.readyState === WebSocket.OPEN;
  const isReconnecting = !isConnected && reconnectTimer !== null;
  const reconnectAttempts = reconnectDelay > 1_000
    ? Math.round(Math.log2(reconnectDelay / 1_000))
    : 0;
  const usingRelay = !relayFailed && !!(process.env.RELAY_TARGET_URL && process.env.RELAY_SECRET_KEY);
  return {
    connected: isConnected,
    reconnecting: isReconnecting,
    connectionMode: usingRelay ? "relay" : "direct",
    reconnectAttempts,
    reconnectDelayMs: reconnectDelay,
    lastConnectedAt: hsmLastConnectedAt?.toISOString() ?? null,
    lastHeartbeatAt: hsmLastHeartbeatAt?.toISOString() ?? null,
    lastDisconnectedAt: hsmLastDisconnectedAt?.toISOString() ?? null,
    hsmUrl: HSM_URL,
    subscriptionCount: subscriptions.size,
    authOk: hsmAuthOkInSession,
  };
}

export function getHsmHistory(): ConnectionEvent[] {
  return [...hsmConnectionHistory].reverse();
}
// ─────────────────────────────────────────────────────────────────────────────

function buildAuthMessage(config: BrokerConfig): object {
  return {
    type: "cn",
    Authorization: config.viewToken || config.accessToken,
    Sid: config.sidView || config.sessionId,
    source: "WEB",
    ...(config.dataCenter ? { dataCenter: config.dataCenter } : {}),
  };
}

function buildSubscribeMessage(exchange: string, token: string): object {
  return { type: "sub", scrips: `${exchange}|${token}` };
}

function resubscribeAll(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN || !activeConfig) return;
  subscriptions.forEach((_, symbol) => {
    const token = brokerSymbolToTokenMap.get(symbol);
    if (!token) return;
    try {
      ws!.send(JSON.stringify(buildSubscribeMessage("nfo", token)));
    } catch (err) {
      console.error(`${LOG_PREFIX} resubscribeAll send error for ${symbol}:`, err);
    }
  });
}

// 🔒 LOCKED BLOCK START — HSM connect: relay→direct auto-fallback (relayFailed=true on failure) must not be removed; subscriptions.forEach() only, not Array.from() [HSM-1, HSM-2]
// HSM-1 amended by Build #164 (2026-05-02): hsmAuthOkInSession reset on open, set on cn:ok; hsmConsecutiveFailures incremented on close-without-auth; probe auto-triggered at threshold — additive only.
function connect(config: BrokerConfig): void {
  if (!config.accessToken || !config.sessionId) {
    console.error(`${LOG_PREFIX} No accessToken/sessionId — skipping WS connection`);
    return;
  }

  const RELAY_URL = process.env.RELAY_TARGET_URL;
  const RELAY_SECRET = process.env.RELAY_SECRET_KEY;

  let opened = false;
  let usingRelay = false;

  try {
    if (RELAY_URL && RELAY_SECRET && !relayFailed) {
      usingRelay = true;
      const wsRelayUrl = RELAY_URL.replace("http://", "ws://").replace("https://", "wss://");
      console.log(`${LOG_PREFIX} Routing via Bangalore relay ${wsRelayUrl} → ${HSM_URL}`);
      ws = new WebSocket(wsRelayUrl, {
        headers: { "x-target-url": HSM_URL, "x-relay-secret": RELAY_SECRET },
      });
    } else {
      if (relayFailed) {
        console.log(`${LOG_PREFIX} Connecting directly to Kotak (relay previously failed)`);
      }
      ws = new WebSocket(HSM_URL);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} WebSocket construction error:`, err);
    scheduleReconnect(config);
    return;
  }

  ws.on("open", () => {
    opened = true;
    hsmAuthOkInSession = false; // HSM-1 Build #164: reset per-session auth flag
    console.log(`${LOG_PREFIX} Connected to Kotak HSM`);
    reconnectDelay = 1_000;
    try {
      ws!.send(JSON.stringify(buildAuthMessage(config)));
    } catch (err) {
      console.error(`${LOG_PREFIX} Auth send error:`, err);
    }
    resubscribeAll();
  });

  ws.on("message", (raw: WebSocket.RawData) => {
    try {
      const parsed = JSON.parse(raw.toString());
      // Kotak HSM returns auth response as array: [{"stat":"Ok","type":"cn",...}]
      const msgCn = Array.isArray(parsed) ? parsed[0] : parsed;
      if (msgCn && msgCn.type === "cn" && (msgCn.ak === "ok" || msgCn.stat === "Ok")) { // HSM-1 Build #164: track auth confirmation
        hsmAuthOkInSession = true;
        hsmConsecutiveFailures = 0;
      }
      const data = parsed.data || parsed;
      let symbol: string | undefined = data.trdSym || data.ts || data.sym;
      // Fallback: if payload carries only a token (tk), reverse-map it to a symbol
      if (!symbol && data.tk) {
        const tokenStr = String(data.tk);
        brokerSymbolToTokenMap.forEach((tok, sym) => {
          if (!symbol && tok === tokenStr) symbol = sym;
        });
      }
      const ltp: number | undefined = data.ltp ?? data.lp;
      if (symbol && ltp !== undefined) {
        marketData.updatePrice(symbol, Number(ltp));
      }
    } catch {
    }
  });

  ws.on("close", () => {
    if (!hsmAuthOkInSession) { hsmConsecutiveFailures++; checkHsmAutoProbe(); } // HSM-1 Build #164: probe auto-trigger
    console.log(`${LOG_PREFIX} Disconnected — reconnecting in ${reconnectDelay}ms`);
    ws = null;
    scheduleReconnect(config);
  });

  ws.on("error", (err) => {
    console.error(`${LOG_PREFIX} WS error:`, err.message);
    if (!opened && usingRelay && !relayFailed) {
      relayFailed = true;
      console.log(`${LOG_PREFIX} Relay unreachable — falling back to direct connection`);
    }
  });
}
// 🔒 LOCKED BLOCK END

// 🔒 LOCKED BLOCK START — HSM scheduleReconnect: exponential backoff capped at MAX_RECONNECT_DELAY_MS [HSM-3]
function scheduleReconnect(config: BrokerConfig): void {
  reconnectTimer = setTimeout(() => connect(config), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
}
// 🔒 LOCKED BLOCK END

// 🔒 LOCKED BLOCK START — HSM heartbeat: sends {"type":"ti","scrips":""} every 30 s while WS is OPEN [HSM-4]
function startHsmHeartbeat(): void {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "ti", scrips: "" })); } catch {}
    }
  }, 30_000);
}
// 🔒 LOCKED BLOCK END

export function refreshConfig(config: BrokerConfig): void {
  if (ws) {
    ws.removeAllListeners();
    try { ws.terminate(); } catch {}
    ws = null;
  }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  relayFailed = false;
  reconnectDelay = 1_000;
  hsmLastConnectedAt = null;
  hsmLastHeartbeatAt = null;
  hsmLastDisconnectedAt = null;
  _hsmPrevOpen = false;
  activeConfig = config;
  connect(config);
  startHsmHeartbeat();
  startHsmStatusTracking();
}

export function forceReconnect(): { ok: boolean; message: string } {
  if (!activeConfig) {
    return { ok: false, message: "No active broker config — HSM was never started" };
  }
  refreshConfig(activeConfig);
  return { ok: true, message: "HSM reconnect triggered" };
}

export function subscribe(symbol: string): void {
  subscriptions.set(symbol, true);
  const token = brokerSymbolToTokenMap.get(symbol);
  if (token && ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(buildSubscribeMessage("nfo", token)));
    } catch (err) {
      console.error(`${LOG_PREFIX} subscribe send error for ${symbol}:`, err);
    }
  }
}

export async function startWsGateway(storage: IStorage): Promise<void> {
  try {
    const configs = await storage.getBrokerConfigs();
    const config = configs.find(c => c.brokerName === "kotak_neo" && c.isConnected);
    if (!config) {
      console.log(`${LOG_PREFIX} No connected Kotak Neo config — WS Gateway not started`);
      return;
    }
    activeConfig = config;

    const openTrades = await storage.getTradesByStatuses(["open"]);
    const nrmlTrades = openTrades.filter(t => t.productType === "NRML");
    for (const trade of nrmlTrades) {
      subscriptions.set(trade.tradingSymbol, true);
    }
    if (nrmlTrades.length > 0) {
      console.log(`${LOG_PREFIX} Pre-subscribed ${nrmlTrades.length} NRML symbols`);
    }

    connect(config);
    startHsmHeartbeat();
    startHsmStatusTracking();
  } catch (err) {
    console.error(`${LOG_PREFIX} startWsGateway error (non-fatal):`, err);
  }
}

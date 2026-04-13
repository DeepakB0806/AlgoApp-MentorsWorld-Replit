import WebSocket from "ws";
import * as marketData from "./md-kotak-neo-v3";
import { brokerSymbolToTokenMap } from "./smc-kotak-neo-v3";
import type { IStorage } from "./storage";
import type { BrokerConfig } from "@shared/schema";

// ⚠️ SPECIAL INSTRUCTION: NO AI OR DEVELOPER IS PERMITTED TO UNLOCK, MODIFY, OR TAMPER WITH ANY 🔒 LOCKED BLOCK WITHOUT EXPLICIT, PRIOR AUTHORIZATION FROM THE USER.
// ⚠️ CODING RULE: Any task that requires modifying a 🔒 LOCKED BLOCK MUST (a) explicitly name the locked block in the task description, and (b) obtain the user's written permission before the block is opened. No exceptions.
//
// 📋 HSM PERMANENT INVARIANTS — rules established through production incidents; never reverse without user sign-off:
//   [HSM-1] connect relay→direct auto-fallback: relayFailed=true on first connection failure. Never remove this fallback path.
//   [HSM-2] subscriptions.forEach() — NOT Array.from(subscriptions). OOM constraint.
//   [HSM-3] scheduleReconnect uses exponential backoff capped at MAX_RECONNECT_DELAY_MS.

const LOG_PREFIX = "[HSM]";
const MAX_RECONNECT_DELAY_MS = 30_000;
const HSM_URL = "wss://mlhsm.kotaksecurities.com";

const subscriptions = new Map<string, true>();
let ws: WebSocket | null = null;
let reconnectDelay = 1_000;
let activeConfig: BrokerConfig | null = null;
let relayFailed = false;

function buildAuthMessage(config: BrokerConfig): object {
  return {
    type: "cn",
    Authorization: config.accessToken,
    Sid: config.sessionId,
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
  setTimeout(() => connect(config), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
}
// 🔒 LOCKED BLOCK END

export function refreshConfig(config: BrokerConfig): void {
  if (ws) { try { ws.terminate(); } catch {} ws = null; }
  relayFailed = false;
  reconnectDelay = 1_000;
  activeConfig = config;
  connect(config);
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
  } catch (err) {
    console.error(`${LOG_PREFIX} startWsGateway error (non-fatal):`, err);
  }
}

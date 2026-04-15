import WebSocket from "ws";
import type { IStorage } from "./storage";
import type { BrokerConfig } from "@shared/schema";

// ⚠️ SPECIAL INSTRUCTION: NO AI OR DEVELOPER IS PERMITTED TO UNLOCK, MODIFY, OR TAMPER WITH ANY 🔒 LOCKED BLOCK WITHOUT EXPLICIT, PRIOR AUTHORIZATION FROM THE USER.
// ⚠️ CODING RULE: Any task that requires modifying a 🔒 LOCKED BLOCK MUST (a) explicitly name the locked block in the task description, and (b) obtain the user's written permission before the block is opened. No exceptions.
//
// 📋 HSI PERMANENT INVARIANTS — rules established through production incidents; never reverse without user sign-off:
//   [HSI-1] connect mirrors HSM relay→direct auto-fallback with identical relayFailed logic.
//   [HSI-2] scheduleReconnect: exponential backoff; reconnectTimer tracked for cancellation.
//   [HSI-3] startHsiHeartbeat: 30 s hb heartbeat, interval tracked in heartbeatInterval.
//   [HSI-4] resolveHsiUrl: maps config.dataCenter to specific Kotak datacenter endpoints.

const LOG_PREFIX = "[HSI]";
const MAX_RECONNECT_DELAY_MS = 30_000;

let HSI_URL = "wss://mis.kotaksecurities.com/realtime";
let ws: WebSocket | null = null;
let reconnectDelay = 1_000;
let activeStorage: IStorage | null = null;
let activeConfig: BrokerConfig | null = null;
let relayFailed = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

function buildAuthMessage(config: BrokerConfig): object {
  return {
    type: "cn",
    Authorization: config.accessToken,
    Sid: config.sessionId,
    source: "WEB",
    ...(config.dataCenter ? { dataCenter: config.dataCenter } : {}),
  };
}

// 🔒 LOCKED BLOCK START — resolveHsiUrl: maps config.dataCenter to specific Kotak datacenter endpoints [HSI-4]
function resolveHsiUrl(config: BrokerConfig): string {
  const dc = (config.dataCenter || "").toLowerCase().trim();
  if (dc === "adc") return "wss://cis.kotaksecurities.com/realtime";
  if (dc === "e21") return "wss://e21.kotaksecurities.com/realtime";
  if (dc === "e22") return "wss://e22.kotaksecurities.com/realtime";
  if (dc === "e41") return "wss://e41.kotaksecurities.com/realtime";
  if (dc === "e43") return "wss://e43.kotaksecurities.com/realtime";
  return "wss://mis.kotaksecurities.com/realtime";
}
// 🔒 LOCKED BLOCK END

// 🔒 LOCKED BLOCK START — HSI connect: mirrors HSM relay→direct auto-fallback with identical relayFailed logic; never weaken [HSI-1]
function connect(config: BrokerConfig): void {
  if (!config.accessToken || !config.sessionId) {
    console.error(`${LOG_PREFIX} Missing accessToken/sessionId. Cannot connect HSI.`);
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
      console.log(`${LOG_PREFIX} Routing via Bangalore relay ${wsRelayUrl} → ${HSI_URL}`);
      ws = new WebSocket(wsRelayUrl, {
        headers: { "x-target-url": HSI_URL, "x-relay-secret": RELAY_SECRET },
      });
    } else {
      if (relayFailed) {
        console.log(`${LOG_PREFIX} Connecting directly to Kotak (relay previously failed)`);
      }
      ws = new WebSocket(HSI_URL);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} WebSocket construction error:`, err);
    scheduleReconnect(config);
    return;
  }

  ws.on("open", () => {
    opened = true;
    console.log(usingRelay ? `${LOG_PREFIX} Connected via relay. Sending Kotak auth...` : `${LOG_PREFIX} Connected directly to Kotak HSI. Sending auth...`);
    reconnectDelay = 1_000;
    try {
      ws!.send(JSON.stringify(buildAuthMessage(config)));
    } catch (err) {
      console.error(`${LOG_PREFIX} Auth send error:`, err);
    }
  });

  ws.on("message", (raw: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(raw.toString());
      const type: string = msg.type || "";
      const d = msg.data || msg;
      if (type === "trade" || type === "position") {
        console.log(`${LOG_PREFIX} ${type} event: ${d.nOrdNo || d.trdSym || ""}`);
        return;
      }
      if (type === "order") {
        const ordSt: string = (d.ordSt || "").toLowerCase();
        const nOrdNo: string = d.nOrdNo || "";
        if (ordSt === "complete") {
          console.log(`${LOG_PREFIX} Order COMPLETE: ${nOrdNo} avgPrc=${d.avgPrc || ""} qty=${d.fldQty || ""}`);
        } else if (ordSt === "rejected" || ordSt === "cancelled") {
          const rejRsn: string = (d.rejRsn || "").toLowerCase();
          console.warn(`${LOG_PREFIX} Order ${ordSt.toUpperCase()}: ${nOrdNo} reason="${rejRsn}"`);
          if (rejRsn && rejRsn !== "--" && activeStorage) {
            activeStorage.getActiveErrorRoutes().then((routes) => {
              for (const route of routes) {
                if (rejRsn.includes(route.errorPattern.toLowerCase())) {
                  console.warn(`${LOG_PREFIX} Matched errorRoute id=${route.id} pattern="${route.errorPattern}" action=${route.actionType}`);
                  break;
                }
              }
            }).catch(() => {});
          }
        }
        return;
      }
      console.log(`${LOG_PREFIX} [DEBUG] msg type="${type}" raw=${raw.toString().slice(0, 300)}`);
    } catch {
      console.log(`${LOG_PREFIX} [DEBUG] non-JSON raw=${raw.toString().slice(0, 300)}`);
    }
  });

  ws.on("close", (code: number, reason: Buffer) => {
    const reasonStr = reason ? reason.toString() : "";
    console.log(`${LOG_PREFIX} Disconnected code=${code} reason="${reasonStr}" — reconnecting in ${reconnectDelay}ms`);
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

// 🔒 LOCKED BLOCK START — HSI scheduleReconnect: same exponential backoff as HSM [HSI-2]
function scheduleReconnect(config: BrokerConfig): void {
  reconnectTimer = setTimeout(() => connect(config), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
}
// 🔒 LOCKED BLOCK END

// 🔒 LOCKED BLOCK START — HSI heartbeat: sends {"type":"hb"} every 30 s while WS is OPEN [HSI-3]
function startHsiHeartbeat(): void {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "hb" })); } catch {}
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
  activeConfig = config;
  HSI_URL = resolveHsiUrl(config);
  connect(config);
  startHsiHeartbeat();
}

export async function startHsiGateway(storage: IStorage): Promise<void> {
  try {
    const configs = await storage.getBrokerConfigs();
    const config = configs.find(c => c.brokerName === "kotak_neo" && c.isConnected);
    if (!config) {
      console.log(`${LOG_PREFIX} No connected Kotak Neo config — HSI Gateway not started`);
      return;
    }
    activeConfig = config;
    activeStorage = storage;
    HSI_URL = resolveHsiUrl(config);
    console.log(`${LOG_PREFIX} HSI URL resolved to ${HSI_URL} (dataCenter=${config.dataCenter ?? "default"})`);
    connect(config);
    startHsiHeartbeat();
  } catch (err) {
    console.error(`${LOG_PREFIX} startHsiGateway error (non-fatal):`, err);
  }
}

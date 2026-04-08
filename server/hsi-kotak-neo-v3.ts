import WebSocket from "ws";
import type { IStorage } from "./storage";
import type { BrokerConfig } from "@shared/schema";

const LOG_PREFIX = "[HSI]";
const HSI_URL = "wss://hstream.kotaksecurities.com/interactive";
const MAX_RECONNECT_DELAY_MS = 30_000;

let ws: WebSocket | null = null;
let reconnectDelay = 1_000;
let activeStorage: IStorage | null = null;
let activeConfig: BrokerConfig | null = null;
let relayFailed = false;

function buildAuthMessage(config: BrokerConfig): object {
  return { type: "cn", Authorization: config.accessToken, Sid: config.sessionId, source: "WEB" };
}

function connect(config: BrokerConfig): void {
  if (!config.accessToken || !config.sessionId) {
    console.error(`${LOG_PREFIX} No accessToken/sessionId — skipping WS connection`);
    return;
  }

  const RELAY_URL = process.env.RELAY_TARGET_URL;
  const RELAY_SECRET = process.env.RELAY_SECRET_KEY;

  let opened = false;

  try {
    if (RELAY_URL && RELAY_SECRET && !relayFailed) {
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
    console.log(`${LOG_PREFIX} Relay tunnel established. Sending Kotak auth...`);
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
    if (!opened && !relayFailed && process.env.RELAY_TARGET_URL) {
      relayFailed = true;
      console.log(`${LOG_PREFIX} Relay unreachable — falling back to direct connection`);
    }
  });
}

function scheduleReconnect(config: BrokerConfig): void {
  setTimeout(() => connect(config), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
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
    connect(config);
  } catch (err) {
    console.error(`${LOG_PREFIX} startHsiGateway error (non-fatal):`, err);
  }
}

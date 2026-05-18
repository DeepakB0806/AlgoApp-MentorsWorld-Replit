import WebSocket from "ws";
import type { IStorage } from "./storage";
import type { BrokerConfig } from "@workspace/db";
import { runProbe, getProbeThreshold } from "./kotak-probe";
import { processTick, updateLastWsTick } from "./tsl-kotak-neo-v3";

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

// ── Per-instance state (Build #253: replaces module-level singleton vars) ─────
interface HsiState {
  ws: WebSocket | null;
  reconnectDelay: number;
  reconnectTimer: NodeJS.Timeout | null;
  heartbeatInterval: NodeJS.Timeout | null;
  relayFailed: boolean;
  zombieCount: number;
  hsiAuthOkInSession: boolean;
  hsiConsecutiveFailures: number;
  hsiLastConnectedAt: Date | null;
  hsiLastHeartbeatAt: Date | null;
  hsiLastDisconnectedAt: Date | null;
  hsiStatusInterval: NodeJS.Timeout | null;
  _hsiPrevOpen: boolean;
  activeConfig: BrokerConfig;
  activeStorage: IStorage;
  hsiUrl: string;
  connectionHistory: ConnectionEvent[];
}

// Module-level instances map: brokerConfigId → HsiState (Build #253)
const hsiInstances = new Map<string, HsiState>();

// ── Shared order-confirmation registry (Build #253) ───────────────────────────
// Used by getFillPrice in te-kotak-neo-v3.ts to await HSI confirmation.
type OrderConfirmCallback = (result: { avgPrc: number; source: "trade" | "order" }) => void;
const orderConfirmRegistry = new Map<string, OrderConfirmCallback>();

export function registerOrderCallback(orderId: string, cb: OrderConfirmCallback): void {
  orderConfirmRegistry.set(orderId, cb);
}
export function deregisterOrderCallback(orderId: string): void {
  orderConfirmRegistry.delete(orderId);
}

// ── Order rejection registry (Build #268) ────────────────────────────────────
// Mirrors orderConfirmRegistry for rejection events. getFillPrice registers here
// so a Kotak RMS rejection resolves the HSI race immediately (no 10s timeout).
type OrderRejectCallback = (reason: string) => void;
const orderRejectRegistry = new Map<string, OrderRejectCallback>();

export function registerOrderRejectCallback(orderId: string, cb: OrderRejectCallback): void {
  orderRejectRegistry.set(orderId, cb);
}
export function deregisterOrderRejectCallback(orderId: string): void {
  orderRejectRegistry.delete(orderId);
}

// ── Exit order registry (Build #253) ─────────────────────────────────────────
// Maps closeOrderId → tradeId — registered by closeTrade, consumed by HSI handler.
const exitOrderRegistry = new Map<string, string>();

export function registerExitOrder(closeOrderId: string, tradeId: string): void {
  exitOrderRegistry.set(closeOrderId, tradeId);
}
export function deregisterExitOrder(closeOrderId: string): void {
  exitOrderRegistry.delete(closeOrderId);
}

// ── Proactive order confirmation handler (Build #253) ─────────────────────────
// Fires on every trade/order-complete HSI event. Updates entry fill price and
// closes exit trades in DB without waiting for REST getOrderHistory.
async function handleOrderConfirm(
  nOrdNo: string,
  avgPrc: number,
  source: "trade" | "order",
  storage: IStorage,
): Promise<void> {
  // 1. Resolve pending getFillPrice callback (unblocks the 10s race in te-kotak-neo-v3.ts)
  const cb = orderConfirmRegistry.get(nOrdNo);
  if (cb) { cb({ avgPrc, source }); }
  // deregisterOrderCallback is called by getFillPrice after the promise resolves

  // 2. Update entry trade fill price proactively
  try {
    const trade = await storage.getTradeByOrderId(nOrdNo);
    if (trade && trade.status === "open" && avgPrc > 0) {
      await storage.updateStrategyTrade(trade.id, { price: avgPrc });
      console.log(`${LOG_PREFIX} Entry fill confirmed: ${trade.tradingSymbol} orderId=${nOrdNo} avgPrc=${avgPrc} [${source}]`);
    }
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Entry fill DB update failed for ${nOrdNo}:`, err?.message);
  }

  // 3. Update exit trade if registered (fixes ghost trade bug)
  const tradeId = exitOrderRegistry.get(nOrdNo);
  if (tradeId) {
    deregisterExitOrder(nOrdNo);
    let attempt = 0;
    while (attempt < 3) {
      try {
        const exitTrade = await storage.getStrategyTrade(tradeId);
        if (!exitTrade) break;
        if (exitTrade.status === "closed" && (exitTrade.exitPrice ?? 0) > 0) break; // already closed
        const entryPrice = exitTrade.price || 0;
        const qty = exitTrade.quantity || 1;
        const pnl = exitTrade.action === "BUY"
          ? (avgPrc - entryPrice) * qty
          : (entryPrice - avgPrc) * qty;
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
        break;
      } catch (err: any) {
        attempt++;
        if (attempt < 3) {
          console.warn(`${LOG_PREFIX} Exit DB write failed (attempt ${attempt}/3) tradeId=${tradeId}: ${err?.message} — retrying in 500ms`);
          await new Promise(r => setTimeout(r, 500));
        } else {
          console.error(`${LOG_PREFIX} WARN: Exit DB write failed after 3 retries — tradeId=${tradeId} may remain open`);
        }
      }
    }
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// ── HSI Status tracking (outside locked blocks) ──────────────────────────────
interface ConnectionEvent { type: "connected" | "disconnected"; timestamp: string; }
const MAX_HISTORY = 20;

function pushHsiEvent(state: HsiState, type: "connected" | "disconnected"): void {
  state.connectionHistory.push({ type, timestamp: new Date().toISOString() });
  if (state.connectionHistory.length > MAX_HISTORY) state.connectionHistory.shift();
}

function startHsiStatusTracking(state: HsiState): void {
  if (state.hsiStatusInterval) clearInterval(state.hsiStatusInterval);
  state._hsiPrevOpen = false;
  state.hsiStatusInterval = setInterval(() => {
    const nowOpen = state.ws !== null && state.ws.readyState === WebSocket.OPEN;
    if (nowOpen && !state._hsiPrevOpen) pushHsiEvent(state, "connected");
    if (!nowOpen && state._hsiPrevOpen) pushHsiEvent(state, "disconnected");
    if (nowOpen) state.hsiLastHeartbeatAt = new Date();
    state._hsiPrevOpen = nowOpen;
  }, 20_000);
}

// getHsiStatus / getHsiHistory read from the first registered instance for backward-compat
// with existing /api/admin/hsi/status routes (Build #253: multi-instance, primary-first).
export function getHsiStatus() {
  const state = hsiInstances.values().next().value as HsiState | undefined;
  if (!state) {
    return {
      connected: false, reconnecting: false, authOk: false,
      connectionMode: "direct", reconnectAttempts: 0, reconnectDelayMs: 1_000,
      lastConnectedAt: null, lastHeartbeatAt: null, lastDisconnectedAt: null,
      hsiUrl: "", zombieCount: 0,
    };
  }
  const isConnected = state.ws !== null && state.ws.readyState === WebSocket.OPEN;
  const isReconnecting = !isConnected && state.reconnectTimer !== null;
  const reconnectAttempts = state.reconnectDelay > 1_000
    ? Math.round(Math.log2(state.reconnectDelay / 1_000))
    : 0;
  const usingRelay = !state.relayFailed && !!(process.env.RELAY_TARGET_URL && process.env.RELAY_SECRET_KEY);
  return {
    connected: isConnected,
    reconnecting: isReconnecting,
    authOk: state.hsiAuthOkInSession,
    connectionMode: usingRelay ? "relay" : "direct",
    reconnectAttempts,
    reconnectDelayMs: state.reconnectDelay,
    lastConnectedAt: state.hsiLastConnectedAt?.toISOString() ?? null,
    lastHeartbeatAt: state.hsiLastHeartbeatAt?.toISOString() ?? null,
    lastDisconnectedAt: state.hsiLastDisconnectedAt?.toISOString() ?? null,
    hsiUrl: state.hsiUrl,
    zombieCount: state.zombieCount,
  };
}

export function getHsiHistory(): ConnectionEvent[] {
  const state = hsiInstances.values().next().value as HsiState | undefined;
  if (!state) return [];
  return [...state.connectionHistory].reverse();
}
// ─────────────────────────────────────────────────────────────────────────────

function buildAuthMessage(config: BrokerConfig): object {
  return {
    type: "cn",
    Authorization: config.accessToken,
    Sid: config.sessionId,
    src: "WEB",
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
// HSI-1 amended by Build #151 (2026-04-27): zombie-state detection added to message handler — additive only, no existing logic changed.
// HSI-1 amended by Build #153 (2026-04-27): zombieCount relay-bypass counter added — additive only.
// HSI-1 amended by Build #155 (2026-04-27): removed duplicate scheduleReconnect() from zombie handler — ws.terminate() already fires ws.on("close") which calls scheduleReconnect; having both created two concurrent timers and two simultaneous WS connections.
// HSI-1 amended by Build #163 (2026-05-01): exact connection/disconnection timestamps recorded in ws.on("open") and ws.on("close") — additive only, no existing logic changed.
// HSI-1 amended by Build #164 (2026-05-02): hsiAuthOkInSession reset on open, set on cn:ok; hsiConsecutiveFailures incremented on close-without-auth; probe auto-triggered at threshold — additive only.
// HSI-1 amended by Build #253 (2026-05-12): per-UCC instance refactor — all singleton vars moved to HsiState parameter; logic unchanged. Proactive order-confirmation added to trade/order-COMPLETE handlers (additive only).
function connect(config: BrokerConfig, state: HsiState): void {
  if (!config.accessToken || !config.sessionId) {
    console.error(`${LOG_PREFIX} Missing accessToken/sessionId. Cannot connect HSI.`);
    return;
  }

  const RELAY_URL = process.env.RELAY_TARGET_URL;
  const RELAY_SECRET = process.env.RELAY_SECRET_KEY;

  let opened = false;
  let usingRelay = false;

  try {
    if (RELAY_URL && RELAY_SECRET && !state.relayFailed) {
      usingRelay = true;
      const wsRelayUrl = RELAY_URL.replace("http://", "ws://").replace("https://", "wss://");
      const wsRelayUrlWithPath = `${wsRelayUrl}/realtime`;
      console.log(`${LOG_PREFIX} Routing via Bangalore relay ${wsRelayUrlWithPath} → ${state.hsiUrl}`);
      state.ws = new WebSocket(wsRelayUrlWithPath, {
        headers: { "x-target-url": state.hsiUrl, "x-relay-secret": RELAY_SECRET },
      });
    } else {
      if (state.relayFailed) {
        console.log(`${LOG_PREFIX} Connecting directly to Kotak (relay previously failed)`);
      }
      state.ws = new WebSocket(state.hsiUrl);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} WebSocket construction error:`, err);
    scheduleReconnect(config, state);
    return;
  }

  state.ws.on("open", () => {
    opened = true;
    state.hsiAuthOkInSession = false; // HSI-1 Build #164: reset per-session auth flag
    state.hsiLastConnectedAt = new Date(); // HSI-1 Build #163: exact connect timestamp
    console.log(usingRelay ? `${LOG_PREFIX} Connected via relay. Sending Kotak auth...` : `${LOG_PREFIX} Connected directly to Kotak HSI. Sending auth...`);
    state.reconnectDelay = 1_000;
    try {
      const authPayload = JSON.stringify(buildAuthMessage(config)).replace(/"/g, '');
      console.log(`${LOG_PREFIX} Auth payload: ${authPayload}`);
      state.ws!.send(authPayload);
    } catch (err) {
      console.error(`${LOG_PREFIX} Auth send error:`, err);
    }
  });

  state.ws.on("message", (raw: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (usingRelay && msg.msg === "session message format incorrect") {
        state.relayFailed = true;
        console.log(`${LOG_PREFIX} Relay path error confirmed — relay does not forward /realtime path; switching to direct E41 connection on next reconnect`);
      }
      const type: string = msg.type || "";
      if (type === "failed to process request") {
        if (usingRelay) state.zombieCount++;
        if (usingRelay && state.zombieCount >= 3) {
          state.relayFailed = true;
          console.warn(`${LOG_PREFIX} ${state.zombieCount} consecutive zombie detections via relay — marking relay failed, switching to direct E41`);
        } else {
          console.warn(`${LOG_PREFIX} Session rejected by Kotak (failed to process request) — zombie state detected, forcing reconnect`);
        }
        try { state.ws!.terminate(); } catch {}
        state.ws = null;
        return;
      }
      if (type === "cn" && msg.ak === "ok") {
        state.zombieCount = 0;
        state.hsiAuthOkInSession = true; // HSI-1 Build #164: mark auth ok, reset failure counter
        state.hsiConsecutiveFailures = 0;
        console.log(`${LOG_PREFIX} Auth confirmed (cn ok) — relay healthy, zombie counter reset`);
        return;
      }
      const d = msg.data || msg;
      if (type === "trade" || type === "position") {
        console.log(`${LOG_PREFIX} ${type} event: ${d.nOrdNo || d.trdSym || ""}`);
        const trdLtp = d.ltp ?? d.lp;
        const trdSym = d.trdSym || d.ts;
        if (trdSym && trdLtp != null) {
          processTick(trdSym, Number(trdLtp));
          updateLastWsTick();
        }
        // HSI-1 Build #253: proactive order confirmation for trade events
        const tradeOrdNo: string = d.nOrdNo || "";
        const tradeLtp = Number(d.ltp ?? d.lp ?? 0);
        if (tradeOrdNo && tradeLtp > 0) {
          handleOrderConfirm(tradeOrdNo, tradeLtp, "trade", state.activeStorage).catch(() => {});
        }
        return;
      }
      if (type === "order") {
        const ordSt: string = (d.ordSt || "").toLowerCase();
        const nOrdNo: string = d.nOrdNo || "";
        if (ordSt === "complete") {
          console.log(`${LOG_PREFIX} Order COMPLETE: ${nOrdNo} avgPrc=${d.avgPrc || ""} qty=${d.fldQty || ""}`);
          // HSI-1 Build #253: proactive order confirmation — primary fill price source
          const avgPrc = Number(d.avgPrc || 0);
          if (nOrdNo && avgPrc > 0) {
            handleOrderConfirm(nOrdNo, avgPrc, "order", state.activeStorage).catch(() => {});
          }
        } else if (ordSt === "rejected" || ordSt === "cancelled") {
          const rejRsn: string = (d.rejRsn || "").toLowerCase();
          console.warn(`${LOG_PREFIX} Order ${ordSt.toUpperCase()}: ${nOrdNo} reason="${rejRsn}"`);
          // Build #268: resolve pending getFillPrice reject callback immediately so
          // the TE does not wait 10s before detecting the rejection.
          if (nOrdNo) {
            const rejectCb = orderRejectRegistry.get(nOrdNo);
            if (rejectCb) {
              orderRejectRegistry.delete(nOrdNo);
              rejectCb(rejRsn);
            }
          }
          if (rejRsn && rejRsn !== "--") {
            state.activeStorage.getActiveErrorRoutes().then((routes) => {
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

  state.ws.on("close", (code: number, reason: Buffer) => {
    const reasonStr = reason ? reason.toString() : "";
    state.hsiLastDisconnectedAt = new Date(); // HSI-1 Build #163: exact disconnect timestamp
    if (!state.hsiAuthOkInSession) {
      state.hsiConsecutiveFailures++;
      // HSI-1 Build #164: probe auto-trigger
      const threshold = getProbeThreshold();
      if (state.hsiConsecutiveFailures >= threshold) {
        console.log(`${LOG_PREFIX} ${state.hsiConsecutiveFailures} consecutive reconnects without auth_ok — auto-running probe`);
        runProbe(state.activeConfig, "hsi").catch(() => {});
      }
    }
    console.log(`${LOG_PREFIX} Disconnected code=${code} reason="${reasonStr}" — reconnecting in ${state.reconnectDelay}ms`);
    state.ws = null;
    scheduleReconnect(config, state);
  });

  state.ws.on("error", (err) => {
    console.error(`${LOG_PREFIX} WS error:`, err.message);
    if (!opened && usingRelay && !state.relayFailed) {
      state.relayFailed = true;
      console.log(`${LOG_PREFIX} Relay unreachable — falling back to direct connection`);
    }
  });
}
// 🔒 LOCKED BLOCK END

// 🔒 LOCKED BLOCK START — HSI scheduleReconnect: same exponential backoff as HSM [HSI-2]
// HSI-2 amended by Build #253 (2026-05-12): takes HsiState parameter instead of module-level vars — additive only.
function scheduleReconnect(config: BrokerConfig, state: HsiState): void {
  state.reconnectTimer = setTimeout(() => connect(config, state), state.reconnectDelay);
  state.reconnectDelay = Math.min(state.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
}
// 🔒 LOCKED BLOCK END

// 🔒 LOCKED BLOCK START — HSI heartbeat: dual heartbeat (protocol ping + application hb) every 20 s while WS is OPEN [HSI-3]
// HSI-3 amended by Build #157 (2026-04-28): replaced invalid {type:hb} application message with ws.ping().
// Kotak's server does not recognise quote-stripped {type:hb} and responds with "failed to process request".
// Browsers keep sessions alive via native WS protocol pings; ws.ping() replicates this. Interval reduced 30s→20s.
// HSI-3 amended by Build #160 (2026-05-01): added application-level {"type":"hb"} alongside ws.ping() (belt-and-suspenders).
// Kotak's official demo.js sends JSON.stringify({type:"hb"}) — quotes intact. The old bug was quote-stripping, not the
// message type. Both heartbeats fire every 20s: ws.ping() handles protocol-aware servers; {"type":"hb"} handles servers
// that expect the application message. This eliminates 1006 abnormal closures observed after Task #157.
// HSI-3 amended by Build #253 (2026-05-12): takes HsiState parameter instead of module-level vars — additive only.
function startHsiHeartbeat(state: HsiState): void {
  if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
  state.heartbeatInterval = setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      try { state.ws.ping(); } catch {}
      try { state.ws.send('{"type":"hb"}'); } catch {}
    }
  }, 20_000);
}
// 🔒 LOCKED BLOCK END

function createHsiState(config: BrokerConfig, storage: IStorage): HsiState {
  return {
    ws: null,
    reconnectDelay: 1_000,
    reconnectTimer: null,
    heartbeatInterval: null,
    relayFailed: false,
    zombieCount: 0,
    hsiAuthOkInSession: false,
    hsiConsecutiveFailures: 0,
    hsiLastConnectedAt: null,
    hsiLastHeartbeatAt: null,
    hsiLastDisconnectedAt: null,
    hsiStatusInterval: null,
    _hsiPrevOpen: false,
    activeConfig: config,
    activeStorage: storage,
    hsiUrl: resolveHsiUrl(config),
    connectionHistory: [],
  };
}

export function refreshConfig(config: BrokerConfig): void {
  const state = hsiInstances.get(config.id) ?? hsiInstances.values().next().value as HsiState | undefined;
  if (!state) return;
  if (state.ws) {
    state.ws.removeAllListeners();
    try { state.ws.terminate(); } catch {}
    state.ws = null;
  }
  if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
  state.relayFailed = false;
  state.zombieCount = 0;
  state.reconnectDelay = 1_000;
  state.hsiLastConnectedAt = null;
  state.hsiLastHeartbeatAt = null;
  state.hsiLastDisconnectedAt = null;
  state.activeConfig = config;
  state.hsiUrl = resolveHsiUrl(config);
  connect(config, state);
  startHsiHeartbeat(state);
  startHsiStatusTracking(state);
}

export function forceReconnect(): { ok: boolean; message: string } {
  const state = hsiInstances.values().next().value as HsiState | undefined;
  if (!state) {
    return { ok: false, message: "No active broker config — HSI was never started" };
  }
  refreshConfig(state.activeConfig);
  return { ok: true, message: "HSI reconnect triggered" };
}

export async function startHsiGateway(storage: IStorage): Promise<void> {
  try {
    const configs = await storage.getBrokerConfigs();
    const kotakConfigs = configs.filter(c => c.brokerName === "kotak_neo" && c.isConnected);
    if (kotakConfigs.length === 0) {
      console.log(`${LOG_PREFIX} No connected Kotak Neo configs — HSI Gateway not started`);
      return;
    }
    for (const config of kotakConfigs) {
      if (hsiInstances.has(config.id)) continue; // already running
      const state = createHsiState(config, storage);
      hsiInstances.set(config.id, state);
      console.log(`${LOG_PREFIX} Starting HSI instance for UCC=${config.clientId ?? config.id} URL=${state.hsiUrl}`);
      connect(config, state);
      startHsiHeartbeat(state);
      startHsiStatusTracking(state);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} startHsiGateway error (non-fatal):`, err);
  }
}

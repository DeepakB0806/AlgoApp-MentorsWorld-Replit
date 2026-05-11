import WebSocket from "ws";
import * as marketData from "./md-kotak-neo-v3";
import { brokerSymbolToTokenMap } from "./smc-kotak-neo-v3";
import type { IStorage } from "./storage";
import type { BrokerConfig } from "@workspace/db";
import { runProbe, getProbeThreshold } from "./kotak-probe";
import { processTick, updateLastWsTick } from "./tsl-kotak-neo-v3";

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
// topicId → symbol mapping established from SNAP frames; used for O(1) UPDATE decode
const topicList = new Map<number, { symbol: string }>();
// Throttle tick log noise: last-logged timestamp per symbol
const lastTickLogAt = new Map<string, number>();
let ws: WebSocket | null = null;
let reconnectDelay = 1_000;
let activeConfig: BrokerConfig | null = null;
let relayFailed = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

// ── HSM Probe auto-trigger (Build #164, outside locked blocks) ────────────────
let hsmConsecutiveFailures = 0;
let hsmAuthOkInSession = false;
let hsmFirstMessageLogged = false;
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

// Binary auth frame matching Kotak HSM's binary protocol (mirrors hslib.js prepareConnectionRequest2).
// Frame layout (all big-endian):
//   [0..1]  uint16  payload length (= total frame size − 2)
//   [2]     byte    1 (CONNECTION_TYPE)
//   [3]     byte    3 (field count)
//   [4]     byte    1 (field ID: JWT)    [5..6] uint16 jwtLen    [7..]  JWT bytes
//   [N]     byte    2 (field ID: SID)    [N+1..N+2] uint16 sidLen  [N+3..] SID bytes
//   [M]     byte    3 (field ID: source) [M+1..M+2] uint16 srcLen  [M+3..] "JS_API"
export function buildHsmAuthBinary(jwt: string, sid: string): Buffer {
  const source = "JS_API";
  const jwtLen = Buffer.byteLength(jwt, "utf8");
  const sidLen = Buffer.byteLength(sid, "utf8");
  const sourceLen = Buffer.byteLength(source, "utf8"); // always 6
  // 2 (header) + 1 (type) + 1 (count) + 3×(1 fieldId + 2 len) + data = 13 + data
  const totalLength = 13 + jwtLen + sidLen + sourceLen;
  const buf = Buffer.alloc(totalLength);
  let offset = 0;
  buf.writeUInt16BE(totalLength - 2, offset); offset += 2;  // payload length
  buf.writeUInt8(1, offset++);                               // CONNECTION_TYPE
  buf.writeUInt8(3, offset++);                               // field count = 3
  buf.writeUInt8(1, offset++);                               // field ID 1: JWT
  buf.writeUInt16BE(jwtLen, offset); offset += 2;
  buf.write(jwt, offset, jwtLen, "utf8"); offset += jwtLen;
  buf.writeUInt8(2, offset++);                               // field ID 2: SID
  buf.writeUInt16BE(sidLen, offset); offset += 2;
  buf.write(sid, offset, sidLen, "utf8"); offset += sidLen;
  buf.writeUInt8(3, offset++);                               // field ID 3: source
  buf.writeUInt16BE(sourceLen, offset); offset += 2;
  buf.write(source, offset, sourceLen, "utf8");
  return buf;
}

// ── Binary frame builders (Task #245) ────────────────────────────────────────
//
// Binary subscription frame (mirrors hslib.js prepareSubsUnSubsRequest + getScripByteArray)
// Layout:
//   [0..1]  uint16BE  payload length (= total − 2)
//   [2]     byte      SUBSCRIBE_TYPE = 4
//   [3]     byte      2  (field count: scrips + channel)
//   [4]     byte      1  (field ID: scrips)
//   [5..6]  uint16BE  scripByteArray length
//   [7..N]  bytes     scripByteArray:
//                       [0..1] uint16BE scripsCount
//                       for each "sf|nse_fo|{token}": [byte len][UTF-8 bytes]
//   [N+1]   byte      2  (field ID: channel)
//   [N+2..N+3] uint16BE  1
//   [N+4]   byte      1  (channelnum)
function buildHsmSubscribeBinary(tokens: string[]): Buffer {
  const scripStrings = tokens.map(tok => `sf|nse_fo|${tok}`);
  const scripDataLen = scripStrings.reduce((s, str) => s + 1 + Buffer.byteLength(str, "utf8"), 0);
  const scripByteArrayLen = 2 + scripDataLen; // 2 = uint16BE scripsCount
  // 2 header + 1 type + 1 fcount + 1 fid1 + 2 scripLen + scripByteArrayLen + 1 fid2 + 2 chanLen + 1 chanNum
  const totalLength = 2 + 1 + 1 + 1 + 2 + scripByteArrayLen + 1 + 2 + 1;
  const buf = Buffer.alloc(totalLength);
  let off = 0;
  buf.writeUInt16BE(totalLength - 2, off); off += 2;
  buf.writeUInt8(4, off++);                             // SUBSCRIBE_TYPE
  buf.writeUInt8(2, off++);                             // field count
  buf.writeUInt8(1, off++);                             // field ID: scrips
  buf.writeUInt16BE(scripByteArrayLen, off); off += 2;
  buf.writeUInt16BE(tokens.length, off); off += 2;      // scripsCount
  for (const s of scripStrings) {
    const sLen = Buffer.byteLength(s, "utf8");
    buf.writeUInt8(sLen, off++);
    buf.write(s, off, sLen, "utf8"); off += sLen;
  }
  buf.writeUInt8(2, off++);                             // field ID: channel
  buf.writeUInt16BE(1, off); off += 2;
  buf.writeUInt8(1, off++);                             // channelnum = 1
  return buf;
}

// Binary heartbeat frame (mirrors hslib.js prepareThrottlingIntervalRequest(0))
// [0..1] uint16BE 9 | [2] THROTTLING_TYPE=2 | [3] 1 | [4] 1 | [5..6] uint16BE 4 | [7..10] uint32BE 0
function buildHsmHeartbeatBinary(): Buffer {
  const buf = Buffer.alloc(11);
  let off = 0;
  buf.writeUInt16BE(9, off); off += 2;   // payload length = 11 − 2
  buf.writeUInt8(2, off++);              // THROTTLING_TYPE
  buf.writeUInt8(1, off++);             // field count
  buf.writeUInt8(1, off++);             // field ID
  buf.writeUInt16BE(4, off); off += 2;  // value length
  buf.writeUInt32BE(0, off);            // interval value = 0
  return buf;
}

// Binary ACK frame (mirrors hslib.js getAcknowledgementReq(msgNum))
// [0..1] uint16BE 9 | [2] ACK_TYPE=3 | [3] 1 | [4] 1 | [5..6] uint16BE 4 | [7..10] uint32BE msgNum
function buildHsmAckBinary(msgNum: number): Buffer {
  const buf = Buffer.alloc(11);
  let off = 0;
  buf.writeUInt16BE(9, off); off += 2;
  buf.writeUInt8(3, off++);              // ACK_TYPE
  buf.writeUInt8(1, off++);
  buf.writeUInt8(1, off++);
  buf.writeUInt16BE(4, off); off += 2;
  buf.writeUInt32BE(msgNum, off);
  return buf;
}

// Emit an LTP tick to all downstream consumers and throttle-log it
function emitTick(symbol: string, ltp: number): void {
  marketData.updatePrice(symbol, ltp);
  processTick(symbol, ltp);
  updateLastWsTick();
  const now = Date.now();
  if (now - (lastTickLogAt.get(symbol) ?? 0) > 10_000) {
    console.log(`${LOG_PREFIX} Tick ${symbol} ltp=${ltp.toFixed(2)}`);
    lastTickLogAt.set(symbol, now);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

function resubscribeAll(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN || !activeConfig) return;
  const tokens: string[] = [];
  subscriptions.forEach((_, symbol) => {
    const token = brokerSymbolToTokenMap.get(symbol);
    if (token) tokens.push(token);
  });
  if (tokens.length === 0) return;
  try {
    ws!.send(buildHsmSubscribeBinary(tokens));
    console.log(`${LOG_PREFIX} Resubscribed ${tokens.length} symbol(s) via binary frame`);
  } catch (err) {
    console.error(`${LOG_PREFIX} resubscribeAll send error:`, err);
  }
}

// 🔒 LOCKED BLOCK START — HSM connect: relay→direct auto-fallback (relayFailed=true on failure) must not be removed; subscriptions.forEach() only, not Array.from() [HSM-1, HSM-2]
// HSM-1 amended by Build #164 (2026-05-02): hsmAuthOkInSession reset on open, set on cn:ok; hsmConsecutiveFailures incremented on close-without-auth; probe auto-triggered at threshold — additive only.
function connect(config: BrokerConfig): void {
  if (!(config.viewToken || config.accessToken) || !(config.sidView || config.sessionId)) {
    console.error(`${LOG_PREFIX} No auth credentials (viewToken/sidView or accessToken/sessionId) — skipping WS connection`);
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
    hsmFirstMessageLogged = false;
    topicList.clear(); // Task #245: reset topic→symbol map on every reconnect
    console.log(`${LOG_PREFIX} Connected to Kotak HSM`);
    reconnectDelay = 1_000;
    try {
      const binaryAuth = buildHsmAuthBinary(
        config.viewToken || config.accessToken || "",
        config.sidView || config.sessionId || "",
      );
      console.log(`${LOG_PREFIX} Sending binary auth frame: ${binaryAuth.length} bytes`);
      ws!.send(binaryAuth);
    } catch (err) {
      console.error(`${LOG_PREFIX} Auth send error:`, err);
    }
    resubscribeAll();
  });

  ws.on("message", (raw: WebSocket.RawData) => {
    try {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      if (!hsmFirstMessageLogged) {
        hsmFirstMessageLogged = true;
        console.log(`${LOG_PREFIX} [DIAG] First raw message: ${buf.length} bytes hex=${buf.toString("hex").slice(0, 64)}`);
      }
      // Binary CONNECTION_TYPE auth response detection (HSM-1 additive):
      // Kotak HSM responds in binary. Layout per hslib.js HSWrapper.parseData:
      //   [0..1] packetsCount  [2] type=1(CONNECTION_TYPE)  [3] fCount
      //   [4] fid1  [5..6] valLen(uint16BE)  [7..7+valLen-1] status
      // BinRespStat.OK = "K" (0x4B), BinRespStat.NOT_OK = "N"
      if (buf.length >= 8 && buf[2] === 1 /* CONNECTION_TYPE */) {
        const valLen = buf.readUInt16BE(5);
        if (valLen >= 1 && 7 + valLen <= buf.length) {
          const status = buf.toString("utf8", 7, 7 + valLen);
          if (status === "K") { // HSM-1 Build #244: binary BinRespStat.OK — auth confirmed
            hsmAuthOkInSession = true;
            hsmConsecutiveFailures = 0;
            console.log(`${LOG_PREFIX} auth_ok received (binary CONNECTION_TYPE response)`);
          } else if (status === "N") {
            console.warn(`${LOG_PREFIX} auth NOT_OK received (binary) — token may be expired`);
          }
        }
      }
      // ── Task #245: Binary DATA_TYPE=6 market data decode ─────────────────
      // Mirrors hslib.js HSWrapper.parseData DATA_TYPE branch.
      // SNAP (83) establishes topicId→symbol; UPDATE (85) emits ticks via topicList.
      if (buf.length > 4 && buf[2] === 6 /* DATA_TYPE */) {
        try {
          const ackNum = buf[3];
          let pos = 4;
          // ACK required when ackNum > 0 (protocol compliance; server stops sending if missed)
          if (ackNum > 0 && pos + 4 <= buf.length) {
            const msgNum = buf.readUInt32BE(pos); pos += 4;
            try { ws!.send(buildHsmAckBinary(msgNum)); } catch {}
          }
          if (pos + 2 > buf.length) return;
          const subPacketCount = buf.readUInt16BE(pos); pos += 2;
          for (let n = 0; n < subPacketCount; n++) {
            pos += 2; // skip 2 padding bytes per hslib.js parseData loop
            if (pos >= buf.length) break;
            const responseType = buf[pos++];
            if (responseType === 83 /* SNAP */) {
              if (pos + 5 > buf.length) break;
              const topicId = buf.readUInt32BE(pos); pos += 4;
              const nameLen = buf[pos++];
              if (pos + nameLen > buf.length) break;
              const topicName = buf.toString("utf8", pos, pos + nameLen); pos += nameLen;
              // topicName = "sf|nse_fo|12345" → token at index 2
              const parts = topicName.split("|");
              const token = parts.length >= 3 ? parts[2] : undefined;
              let symbol: string | undefined;
              if (token) {
                brokerSymbolToTokenMap.forEach((tok, sym) => {
                  if (!symbol && tok === token) symbol = sym;
                });
              }
              // Numeric long values: LTP at sequential index 5 (SCRIP_INDEX.LTP), IEEE 754 float32 BE
              if (pos >= buf.length) break;
              const fcount = buf[pos++];
              const ltpStart = pos;
              pos += fcount * 4;
              let ltp: number | undefined;
              if (fcount > 5 && ltpStart + 6 * 4 <= buf.length) {
                ltp = buf.readFloatBE(ltpStart + 5 * 4);
              }
              // Skip string fields
              if (pos < buf.length) {
                const scount = buf[pos++];
                for (let i = 0; i < scount && pos + 1 < buf.length; i++) {
                  pos++; // fid
                  if (pos >= buf.length) break;
                  const dLen = buf[pos++];
                  pos += dLen;
                }
              }
              if (symbol) {
                topicList.set(topicId, { symbol });
                if (ltp !== undefined && isFinite(ltp) && ltp > 0) emitTick(symbol, ltp);
              }
            } else if (responseType === 85 /* UPDATE */) {
              if (pos + 5 > buf.length) break;
              const topicId = buf.readUInt32BE(pos); pos += 4;
              const fcount = buf[pos++];
              const ltpStart = pos;
              pos += fcount * 4;
              const entry = topicList.get(topicId);
              if (entry && fcount > 5 && ltpStart + 6 * 4 <= buf.length) {
                const ltp = buf.readFloatBE(ltpStart + 5 * 4);
                if (isFinite(ltp) && ltp > 0) emitTick(entry.symbol, ltp);
              }
            } else {
              break; // unknown response type — stop parsing this frame
            }
          }
        } catch {
          // malformed DATA_TYPE frame — ignore and fall through
        }
        return; // DATA_TYPE fully handled; skip JSON fallback
      }
      // ─────────────────────────────────────────────────────────────────────

      // JSON parse fallback — kept for any text-framed responses (HSM-1 additive)
      const parsed = JSON.parse(buf.toString());
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
        processTick(symbol, Number(ltp));
        updateLastWsTick();
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

// 🔒 LOCKED BLOCK START — HSM heartbeat: sends binary THROTTLING_TYPE=2 frame every 30 s while WS is OPEN [HSM-4]
// Task #245: replaced JSON {"type":"ti"} with binary prepareThrottlingIntervalRequest(0) frame (11 bytes)
function startHsmHeartbeat(): void {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(buildHsmHeartbeatBinary()); } catch {}
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
      ws.send(buildHsmSubscribeBinary([token]));
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

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
  lastError: string | null;
  reconnects: number;
  failures: number;
  marketStatus?: string;
  lastCasAt?: number;
  retryTimer?: NodeJS.Timeout;
};

const states = new Map<string, FeedState>();
const exchangeNames = ["none", "nse_cm", "nse_fo", "cde_fo", "nse_com", "bse_cm", "bse_fo", "bse_cd", "bse_co", "mcx_fo", "ncd_co"];

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
  if (!feedUrl || !state.config.accessToken || !state.config.ucc) {
    state.lastError = "Kotak login is missing feed URL, session token, or UCC";
    return;
  }
  const url = new URL(feedUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    state.lastError = "Kotak feed URL must use HTTP(S) or WS(S)";
    return;
  }
  const ws = new WebSocket(url.toString());
  state.ws = ws;
  ws.on("open", () => {
    ws.send(JSON.stringify({
      user: state.config.ucc,
      auth: state.config.accessToken,
      format: "native_batch",
      source: "NEOTRADEAPI",
      sdk_version: 1.1,
      sdk_date: "2026-10-12",
    }));
  });
  ws.on("message", (data, isBinary) => {
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
        for (const [exchange, item] of Object.entries(msg.exchanges || {}) as Array<[string, any]>) {
          state.dividers.set(exchange, Number(item?.divider) || 100);
        }
        if (msg.message_code === 1117) {
          state.lastError = null;
          state.failures = 0;
          for (const sub of state.subscriptions.values()) {
            send(state, "subscribeScripsLite", `${sub.exchange}|${sub.token}`);
          }
        }
      } else if (msg.message_code === 1120) {
        state.lastError = `Kotak market-feed authentication failed: ${msg.message || "unknown reason"}`;
        state.failures++;
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
    state.lastError = error.message;
    state.failures++;
  });
  ws.on("close", () => {
    state.ws = null;
    state.reconnects++;
    if (state.retryTimer) clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(() => connect(state), Math.min(30_000, 1000 * 2 ** Math.min(state.reconnects, 5)));
  });
}

export async function startNativeFeed(storage: IStorage) {
  const configs = (await storage.getBrokerConfigs()).filter((c) => c.brokerName === "kotak_neo" && c.isConnected);
  for (const config of configs) configureNativeFeed(config);
}

export function configureNativeFeed(config: BrokerConfig) {
  let state = states.get(config.id);
  if (state?.ws) {
    state.config = config;
    state.ws.close();
    return;
  }
  state = { config, ws: null, subscriptions: new Map(), dividers: new Map(), lastTickAt: null, lastError: null, reconnects: 0, failures: 0 };
  states.set(config.id, state);
  connect(state);
}

export function subscribeNativeSymbol(symbol: string) {
  const token = brokerSymbolToTokenMap.get(symbol);
  if (!token) return;
  for (const state of states.values()) subscribeToken(state, "nse_fo", token);
}

export function getNativeFeedStatus() {
  const now = Date.now();
  const rows = [...states.values()].map((s) => {
    const ageMs = s.lastTickAt === null ? null : now - s.lastTickAt;
    const score = Math.min(100, s.failures * 20 + s.reconnects * 5 + (ageMs === null ? 65 : ageMs > 10_000 ? 40 : ageMs > 3_000 ? 20 : 0));
    return { brokerConfigId: s.config.id, connected: s.ws?.readyState === WebSocket.OPEN, status: score >= 60 ? "critical" : score >= 25 ? "degraded" : "healthy", riskScore: score, lastTickAt: s.lastTickAt ? new Date(s.lastTickAt).toISOString() : null, lastError: s.lastError, reconnects: s.reconnects, subscriptions: s.subscriptions.size, marketStatus: s.marketStatus ?? null, lastCasAt: s.lastCasAt ? new Date(s.lastCasAt).toISOString() : null };
  });
  return { status: rows.some((r) => r.status === "critical") || rows.length === 0 ? "critical" : rows.some((r) => r.status === "degraded") ? "degraded" : "healthy", feeds: rows };
}

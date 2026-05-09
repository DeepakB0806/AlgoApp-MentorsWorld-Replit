import WebSocket from "ws";
import type { BrokerConfig } from "@shared/schema";
import { getHsmStatus, isHsmAuthOk } from "./hsm-kotak-neo-v3";

export interface ProbeResult {
  target: "hsm" | "hsi";
  status: "auth_ok" | "auth_failed" | "unreachable" | "timeout";
  endpoint: string;
  testedAt: string;
  durationMs: number;
}

const lastResults = new Map<"hsm" | "hsi", ProbeResult>();

const PROBE_TIMEOUT_MS = 10_000;
const PROBE_TRIGGER_THRESHOLD = parseInt(process.env.PROBE_TRIGGER_THRESHOLD || "5", 10);

export function getProbeThreshold(): number {
  return PROBE_TRIGGER_THRESHOLD;
}

function resolveHsiEndpoint(config: BrokerConfig): string {
  const dc = (config.dataCenter || "").toLowerCase().trim();
  if (dc === "adc") return "wss://cis.kotaksecurities.com/realtime";
  if (dc === "e21") return "wss://e21.kotaksecurities.com/realtime";
  if (dc === "e22") return "wss://e22.kotaksecurities.com/realtime";
  if (dc === "e41") return "wss://e41.kotaksecurities.com/realtime";
  if (dc === "e43") return "wss://e43.kotaksecurities.com/realtime";
  return "wss://mis.kotaksecurities.com/realtime";
}

const HSM_DIRECT_URL = "wss://mlhsm.kotaksecurities.com";

function buildHsmAuthMessage(config: BrokerConfig): string {
  return JSON.stringify({
    type: "cn",
    Authorization: config.viewToken ?? config.accessToken,
    Sid: config.sidView ?? config.sessionId,
    source: "WEB",
    ...(config.dataCenter ? { dataCenter: config.dataCenter } : {}),
  });
}

function buildHsiAuthMessage(config: BrokerConfig): string {
  return JSON.stringify({
    type: "cn",
    Authorization: config.accessToken,
    Sid: config.sessionId,
    src: "WEB",
  });
}

export async function runProbe(config: BrokerConfig, target: "hsm" | "hsi"): Promise<ProbeResult> {
  const RELAY_URL = process.env.RELAY_TARGET_URL;
  const RELAY_SECRET = process.env.RELAY_SECRET_KEY;

  // HSM shortcut: if the production gateway already holds the relay slot AND has confirmed
  // auth_ok, opening a second connection would get no response (Kotak ignores it).
  // Read the live gateway state instead of probing again.
  if (target === "hsm") {
    const hsmStatus = getHsmStatus();
    if (hsmStatus.connected) {
      const authOk = isHsmAuthOk();
      const status: ProbeResult["status"] = authOk ? "auth_ok" : "timeout";
      const displayEndpoint = hsmStatus.connectionMode === "relay"
        ? `${HSM_DIRECT_URL} (via relay)`
        : HSM_DIRECT_URL;
      const note = authOk
        ? "Gateway live — reading auth_ok from active production connection"
        : "Gateway connected but auth_ok not yet confirmed — token may be expired";
      console.log(`[PROBE] HSM shortcut (gateway active): ${note}`);
      const r: ProbeResult = {
        target: "hsm",
        status,
        endpoint: displayEndpoint,
        testedAt: new Date().toISOString(),
        durationMs: 0,
      };
      lastResults.set("hsm", r);
      return r;
    }
  }

  // HSM: always route through relay (direct connections are blocked from this server)
  // HSI: connect directly to Kotak (relay adds /realtime path which it can't forward)
  let wsUrl: string;
  let wsOptions: WebSocket.ClientOptions = {};
  let displayEndpoint: string;

  const relayWs = RELAY_URL ? RELAY_URL.replace("http://", "ws://").replace("https://", "wss://") : null;

  if (target === "hsm") {
    if (relayWs && RELAY_SECRET) {
      wsUrl = relayWs;
      wsOptions = { headers: { "x-target-url": HSM_DIRECT_URL, "x-relay-secret": RELAY_SECRET } };
      displayEndpoint = `${HSM_DIRECT_URL} (via relay)`;
    } else {
      wsUrl = HSM_DIRECT_URL;
      displayEndpoint = HSM_DIRECT_URL;
    }
  } else {
    // HSI: mirror production exactly — relay with /realtime path suffix
    const hsiDirectUrl = resolveHsiEndpoint(config);
    if (relayWs && RELAY_SECRET) {
      wsUrl = `${relayWs}/realtime`;
      wsOptions = { headers: { "x-target-url": hsiDirectUrl, "x-relay-secret": RELAY_SECRET } };
      displayEndpoint = `${hsiDirectUrl} (via relay)`;
    } else {
      wsUrl = hsiDirectUrl;
      displayEndpoint = hsiDirectUrl;
    }
  }

  const startMs = Date.now();
  console.log(`[PROBE] Running ${target.toUpperCase()} diagnostic against ${displayEndpoint} ...`);

  const result = await new Promise<ProbeResult>((resolve) => {
    let settled = false;

    const settle = (status: ProbeResult["status"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch {}
      const durationMs = Date.now() - startMs;
      const r: ProbeResult = { target, status, endpoint: displayEndpoint, testedAt: new Date().toISOString(), durationMs };
      resolve(r);
    };

    const timer = setTimeout(() => settle("timeout"), PROBE_TIMEOUT_MS);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl, wsOptions);
    } catch {
      settle("unreachable");
      return;
    }

    ws.on("open", () => {
      try {
        let auth: string;
        if (target === "hsm") {
          auth = buildHsmAuthMessage(config);
        } else {
          // Production HSI strips all quote characters before sending — match exactly
          auth = buildHsiAuthMessage(config).replace(/"/g, "");
        }
        ws.send(auth);
      } catch {
        settle("unreachable");
      }
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(raw.toString());
        // HSM returns an array: [{"stat":"Ok","type":"cn","msg":"successful","stCode":200}]
        // HSI returns a plain object: {"ak":"ok","type":"cn","task":"cn","msg":"connected"}
        const msg = Array.isArray(parsed) ? parsed[0] : parsed;
        if (!msg) return;
        const isOk = msg.type === "cn" && (msg.ak === "ok" || msg.stat === "Ok");
        const isFailed = msg.type === "cn" || (typeof msg.msg === "string" && msg.msg.length > 0);
        if (isOk) settle("auth_ok");
        else if (isFailed) settle("auth_failed");
      } catch {}
    });

    ws.on("error", () => settle("unreachable"));
    ws.on("close", (code) => {
      if (!settled && code !== 1000) settle("unreachable");
    });
  });

  lastResults.set(target, result);

  const verdict =
    result.status === "auth_ok"
      ? `Kotak reachable, auth OK → bug is in our ${target.toUpperCase()} code (or token expired)`
      : result.status === "auth_failed"
      ? `Kotak reachable but auth rejected → token/session may be expired`
      : result.status === "unreachable"
      ? `Kotak unreachable → Kotak server down or URL changed`
      : `No response within ${PROBE_TIMEOUT_MS / 1000}s → timeout`;

  console.log(`[PROBE] ${target.toUpperCase()}: ${verdict} (${result.durationMs}ms)`);

  return result;
}

export async function runProbeForBoth(config: BrokerConfig): Promise<{ hsm: ProbeResult; hsi: ProbeResult }> {
  const [hsm, hsi] = await Promise.all([runProbe(config, "hsm"), runProbe(config, "hsi")]);
  return { hsm, hsi };
}

export function getLastProbeResults(): { hsm: ProbeResult | null; hsi: ProbeResult | null } {
  return {
    hsm: lastResults.get("hsm") ?? null,
    hsi: lastResults.get("hsi") ?? null,
  };
}

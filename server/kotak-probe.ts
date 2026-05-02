import WebSocket from "ws";
import type { BrokerConfig } from "@shared/schema";

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

export async function runProbe(config: BrokerConfig, target: "hsm" | "hsi"): Promise<ProbeResult> {
  const endpoint = target === "hsi"
    ? resolveHsiEndpoint(config)
    : "wss://mlhsm.kotaksecurities.com";

  const startMs = Date.now();

  console.log(`[PROBE] Running ${target.toUpperCase()} diagnostic against ${endpoint} ...`);

  const result = await new Promise<ProbeResult>((resolve) => {
    let settled = false;

    const settle = (status: ProbeResult["status"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch {}
      const durationMs = Date.now() - startMs;
      const r: ProbeResult = { target, status, endpoint, testedAt: new Date().toISOString(), durationMs };
      resolve(r);
    };

    const timer = setTimeout(() => settle("timeout"), PROBE_TIMEOUT_MS);

    let ws: WebSocket;
    try {
      ws = new WebSocket(endpoint);
    } catch {
      settle("unreachable");
      return;
    }

    ws.on("open", () => {
      try {
        const auth = JSON.stringify({
          type: "cn",
          Authorization: config.accessToken,
          Sid: config.sessionId,
          source: "WEB",
        });
        ws.send(auth);
      } catch {
        settle("unreachable");
      }
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "cn" && msg.ak === "ok") {
          settle("auth_ok");
        } else if (msg.type === "cn" || (typeof msg.msg === "string" && msg.msg.length > 0)) {
          settle("auth_failed");
        }
      } catch {}
    });

    ws.on("error", () => settle("unreachable"));
    ws.on("close", () => settle("unreachable"));
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

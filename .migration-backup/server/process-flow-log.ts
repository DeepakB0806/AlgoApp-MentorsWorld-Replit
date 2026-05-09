import { storage } from "./storage";

export interface ProcessFlowEntry {
  id: string;
  timestamp: string;
  planId: string;
  planName: string;
  signalType: string;
  alert: string;
  resolvedAction: string;
  blockType: string;
  actionTaken: string;
  message: string;
  broker: string;
  ticker?: string;
  exchange?: string;
  price?: number;
  orderId?: string;
  executionTimeMs?: number;
}

const MAX_ENTRIES = 500;
let buffer: ProcessFlowEntry[] = [];
let idCounter = 0;

export function addProcessFlowLog(entry: Omit<ProcessFlowEntry, "id" | "timestamp">): void {
  idCounter++;
  const log: ProcessFlowEntry = {
    id: `pfl-${Date.now()}-${idCounter}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  buffer.unshift(log);
  if (buffer.length > MAX_ENTRIES) {
    buffer = buffer.slice(0, MAX_ENTRIES);
  }
  storage.addProcessFlowLogToDB({
    id: log.id,
    planId: log.planId,
    planName: log.planName,
    signalType: log.signalType,
    alert: log.alert,
    resolvedAction: log.resolvedAction,
    blockType: log.blockType,
    actionTaken: log.actionTaken,
    message: log.message,
    broker: log.broker,
    ticker: log.ticker,
    exchange: log.exchange,
    price: log.price,
    orderId: log.orderId,
    executionTimeMs: log.executionTimeMs,
    timestamp: log.timestamp,
  }).catch((err: unknown) => {
    console.error("[PFL] DB write failed:", err);
  });
}

export async function getProcessFlowLogs(planId?: string, limit = 100): Promise<{ entries: ProcessFlowEntry[]; totalCount: number }> {
  try {
    const rows = await storage.getProcessFlowLogsFromDB(planId, limit);
    if (rows.length > 0) {
      return { entries: rows as ProcessFlowEntry[], totalCount: rows.length };
    }
  } catch (err) {
    console.error("[PFL] DB read failed, falling back to memory:", err);
  }
  const filtered = planId ? buffer.filter(e => e.planId === planId) : buffer;
  return { entries: filtered.slice(0, limit), totalCount: filtered.length };
}

export async function getProcessFlowPlans(): Promise<{ planId: string; planName: string; count: number }[]> {
  try {
    const rows = await storage.getProcessFlowPlansFromDB();
    if (rows.length > 0) return rows;
  } catch (err) {
    console.error("[PFL] DB plans read failed, falling back to memory:", err);
  }
  const map = new Map<string, { planName: string; count: number }>();
  for (const e of buffer) {
    const existing = map.get(e.planId);
    if (existing) {
      existing.count++;
    } else {
      map.set(e.planId, { planName: e.planName, count: 1 });
    }
  }
  return Array.from(map.entries()).map(([planId, v]) => ({ planId, planName: v.planName, count: v.count }));
}

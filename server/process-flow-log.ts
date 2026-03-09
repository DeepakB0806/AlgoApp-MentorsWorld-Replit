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
}

export function getProcessFlowLogs(planId?: string, limit = 100): { entries: ProcessFlowEntry[]; totalCount: number } {
  const filtered = planId ? buffer.filter(e => e.planId === planId) : buffer;
  return { entries: filtered.slice(0, limit), totalCount: filtered.length };
}

export function getProcessFlowPlans(): { planId: string; planName: string; count: number }[] {
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

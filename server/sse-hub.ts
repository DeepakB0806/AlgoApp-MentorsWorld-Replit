import type { Response } from "express";

const clients = new Set<Response>();

export function addSseClient(res: Response): void {
  clients.add(res);
  res.on("close", () => clients.delete(res));
  res.on("error", () => clients.delete(res));
}

export function broadcast(event: string, data: unknown): void {
  if (clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}

import type { BrokerConfig } from "@workspace/db";
import type { NextFunction, Request, Response } from "express";
import { getUserFromRequest, requireTeamOrSuperAdmin } from "./helpers";

const SECRET_FIELDS = [
  "consumerKey",
  "consumerSecret",
  "mobileNumber",
  "ucc",
  "mpin",
  "clientId",
  "accessToken",
  "sessionId",
  "feedUrl",
  "viewToken",
  "sidView",
  "lastTotpUsed",
] as const;

export function requireBrokerReadAccess(req: Request, res: Response, next: NextFunction): void {
  if (!getUserFromRequest(req)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

export function requireBrokerWriteAccess(req: Request, res: Response, next: NextFunction): void {
  if (!requireTeamOrSuperAdmin(req, res)) return;
  next();
}

export type PublicBrokerConfig = Omit<BrokerConfig, (typeof SECRET_FIELDS)[number]> &
  Record<(typeof SECRET_FIELDS)[number], null> & {
    hasConsumerKey: boolean;
    hasConsumerSecret: boolean;
    hasMobileNumber: boolean;
    hasUcc: boolean;
    hasMpin: boolean;
    sessionExpiresAt: string | null;
  };

function readSessionExpiry(token: string | null): string | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
    return new Date(payload.exp * 1000).toISOString();
  } catch {
    return null;
  }
}

export function toPublicBrokerConfig(config: BrokerConfig): PublicBrokerConfig;
export function toPublicBrokerConfig(config: BrokerConfig | null | undefined): PublicBrokerConfig | null;
export function toPublicBrokerConfig(config: BrokerConfig | null | undefined): PublicBrokerConfig | null {
  if (!config) return null;
  return {
    ...config,
    hasConsumerKey: Boolean(config.consumerKey),
    hasConsumerSecret: Boolean(config.consumerSecret),
    hasMobileNumber: Boolean(config.mobileNumber),
    hasUcc: Boolean(config.ucc),
    hasMpin: Boolean(config.mpin),
    sessionExpiresAt: readSessionExpiry(config.accessToken),
    consumerKey: null,
    consumerSecret: null,
    mobileNumber: null,
    ucc: null,
    mpin: null,
    clientId: null,
    accessToken: null,
    sessionId: null,
    feedUrl: null,
    viewToken: null,
    sidView: null,
    lastTotpUsed: null,
  };
}

export function preserveConfiguredCredentials<T extends object>(updates: T): T {
  const safeUpdates = { ...updates } as T & Record<string, unknown>;
  for (const field of SECRET_FIELDS) {
    const value = safeUpdates[field];
    if (typeof value === "string" && value.trim() === "") {
      delete safeUpdates[field];
    }
  }
  return safeUpdates;
}

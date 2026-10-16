import type { RequestHandler } from "express";
import { isAuthenticated } from "../replit_integrations/auth/replitAuth";
import { requireTeamOrSuperAdmin } from "./helpers";

const PUBLIC_INTEGRATION_ROUTES: Array<{ method: string; path: RegExp }> = [
  // External broker/webhook and internal feed/update callbacks do not use browser cookies.
  { method: "POST", path: /^\/api\/webhook\/[^/]+$/ },
  { method: "POST", path: /^\/api\/price-update$/ },
  // These are called by the paired Development/Production environments.
  { method: "POST", path: /^\/api\/(?:strategy-configs|universal-fields|broker-field-mappings)\/sync-receive$/ },
  { method: "GET", path: /^\/api\/webhook-data\/webhook\/[^/]+$/ },
  { method: "GET", path: /^\/api\/webhook-registry(?:\/[^/]+)?$/ },
];

export function isPublicIntegrationRequest(method: string, originalUrl: string): boolean {
  const path = originalUrl.split("?", 1)[0];
  return PUBLIC_INTEGRATION_ROUTES.some((route) => route.method === method.toUpperCase() && route.path.test(path));
}

export const requireApplicationApiAccess: RequestHandler = (req, res, next) => {
  if (isPublicIntegrationRequest(req.method, req.originalUrl)) {
    next();
    return;
  }

  isAuthenticated(req, res, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }

    if (["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) {
      next();
      return;
    }

    if (!requireTeamOrSuperAdmin(req, res)) return;
    next();
  });
};

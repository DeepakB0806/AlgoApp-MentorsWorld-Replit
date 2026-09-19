import type { Request, Response } from "express";

type RequestOriginSource = Pick<Request, "headers" | "protocol" | "get">;
type LogoutDestinationRequest = Pick<Request, "get">;
type LogoutDestinationResponse = Pick<Response, "json" | "redirect" | "status">;

interface LogoutSessionRequest {
  logout(callback: (error?: unknown) => void): void;
  session?: {
    destroy(callback: (error?: unknown) => void): void;
  };
}

interface LogoutSessionResponse {
  clearCookie(name: string, options?: { path: string }): unknown;
}

export interface LogoutCleanupResult {
  logoutError?: unknown;
  sessionError?: unknown;
}

export type EndSessionParameters = Record<string, string> & {
  client_id: string;
  post_logout_redirect_uri: string;
  id_token_hint?: string;
};

function firstForwardedValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim() || undefined;
}

export function getRequestOrigin(req: RequestOriginSource): string {
  const forwardedProtocol = firstForwardedValue(req.headers["x-forwarded-proto"])?.toLowerCase();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : req.protocol === "http" || req.protocol === "https"
      ? req.protocol
      : "https";
  const host = firstForwardedValue(req.headers["x-forwarded-host"]) ?? req.get("host");

  if (!host) {
    throw new Error("Cannot determine logout return host");
  }

  return new URL(`${protocol}://${host}`).origin;
}

export function getSafeReturnTo(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/";
  }

  return value;
}

export function sendLogoutDestination(
  req: LogoutDestinationRequest,
  res: LogoutDestinationResponse,
  destination: string,
) {
  const accept = req.get("accept") ?? "";

  if (accept.includes("application/json")) {
    return res.status(200).json({ redirectTo: destination });
  }

  return res.redirect(302, destination);
}

export function getPostLogoutRedirectUri(
  req: RequestOriginSource,
  returnToValue: unknown,
): string {
  const origin = getRequestOrigin(req);
  return new URL(getSafeReturnTo(returnToValue), `${origin}/`).href;
}

export function getEndSessionParameters(
  req: RequestOriginSource,
  returnToValue: unknown,
  clientId: string,
  idTokenHint?: unknown,
): EndSessionParameters {
  const parameters: EndSessionParameters = {
    client_id: clientId,
    post_logout_redirect_uri: getPostLogoutRedirectUri(req, returnToValue),
  };

  if (typeof idTokenHint === "string" && idTokenHint.length > 0) {
    parameters.id_token_hint = idTokenHint;
  }

  return parameters;
}

export async function clearLocalAuthSession(
  req: LogoutSessionRequest,
  res: LogoutSessionResponse,
): Promise<LogoutCleanupResult> {
  return new Promise((resolve) => {
    const finish = (logoutError?: unknown) => {
      const clearCookiesAndResolve = (sessionError?: unknown) => {
        res.clearCookie("connect.sid", { path: "/" });
        res.clearCookie("team_session", { path: "/" });
        resolve({ logoutError, sessionError });
      };

      if (!req.session) {
        clearCookiesAndResolve();
        return;
      }

      try {
        req.session.destroy((sessionError?: unknown) => {
          clearCookiesAndResolve(sessionError);
        });
      } catch (sessionError) {
        clearCookiesAndResolve(sessionError);
      }
    };

    try {
      req.logout((logoutError?: unknown) => {
        finish(logoutError);
      });
    } catch (logoutError) {
      finish(logoutError);
    }
  });
}
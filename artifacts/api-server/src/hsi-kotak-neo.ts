import type { IStorage } from "./storage";
import type { BrokerConfig } from "@workspace/db";
import {
  getKotakApiProfileInfo,
  normalizeKotakApiVersion,
  type KotakApiVersion,
} from "./kotak-api-adapter";
import * as legacyHsi from "./hsi-kotak-neo-v3";
import * as currentHsi from "./hsi-kotak-neo-v4";

function isCurrent(config: BrokerConfig): boolean {
  return normalizeKotakApiVersion(config.apiVersion) === "v3_current";
}

export async function startHsiGateway(storage: IStorage): Promise<void> {
  // The existing v3-suffixed gateway is intentionally given only Legacy v2
  // configs. The existing module itself is not modified.
  const legacyStorage: IStorage = {
    ...storage,
    getBrokerConfigs: async () => {
      const configs = await storage.getBrokerConfigs();
      return configs.filter(config =>
        config.brokerName === "kotak_neo" &&
        config.isConnected &&
        !isCurrent(config),
      );
    },
  };
  await legacyHsi.startHsiGateway(legacyStorage);
  await currentHsi.startHsiGateway(storage);
}

export function refreshConfig(config: BrokerConfig): void {
  // Version changes clear credentials and mark the config disconnected before
  // the user performs a fresh login. Never start either gateway from that
  // reset record.
  if (!config.isConnected || !config.accessToken || !config.sessionId) return;
  if (isCurrent(config)) {
    currentHsi.refreshConfig(config);
  } else {
    legacyHsi.refreshConfig(config);
  }
}

export function forceReconnect(apiVersion?: KotakApiVersion): { ok: boolean; message: string } {
  if (apiVersion === "v3_current") return currentHsi.forceReconnect(apiVersion);
  if (apiVersion === "v2_legacy") return legacyHsi.forceReconnect(apiVersion);

  const legacy = legacyHsi.forceReconnect("v2_legacy");
  const current = currentHsi.forceReconnect("v3_current");
  if (legacy.ok || current.ok) {
    return { ok: true, message: [legacy.ok && "HSI Legacy v2 reconnect triggered", current.ok && "HSI Current v3 reconnect triggered"].filter(Boolean).join("; ") };
  }
  return { ok: false, message: "No active broker config — HSI was never started" };
}

export function getHsiStatus() {
  const legacy = legacyHsi.getHsiStatus();
  return "brokerConfigId" in legacy && legacy.brokerConfigId
    ? legacy
    : currentHsi.getHsiStatus();
}

export function getHsiStatuses(configs: BrokerConfig[] = []) {
  const legacyStatuses = legacyHsi.getHsiStatuses(configs);
  const currentStatuses = currentHsi.getHsiStatuses(configs);
  return legacyStatuses.map((status, index) => {
    const current = currentStatuses[index];
    return status.apiVersion === "v3_current" ? current : status;
  });
}

export function getHsiHistory() {
  return [...legacyHsi.getHsiHistory(), ...currentHsi.getHsiHistory()]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function getHsiHistories() {
  const legacy = legacyHsi.getHsiHistories();
  const current = currentHsi.getHsiHistories();
  return {
    v2_legacy: legacy.v2_legacy,
    v3_current: current.v3_current,
  };
}

export function registerOrderCallbackForConfig(
  config: BrokerConfig,
  orderId: string,
  cb: (result: { avgPrc: number; source: "trade" | "order" }) => void,
): void {
  if (isCurrent(config)) currentHsi.registerOrderCallback(orderId, cb);
  else legacyHsi.registerOrderCallback(orderId, cb);
}

export function deregisterOrderCallbackForConfig(config: BrokerConfig, orderId: string): void {
  if (isCurrent(config)) currentHsi.deregisterOrderCallback(orderId);
  else legacyHsi.deregisterOrderCallback(orderId);
}

export function registerOrderRejectCallbackForConfig(
  config: BrokerConfig,
  orderId: string,
  cb: (reason: string) => void,
): void {
  if (isCurrent(config)) currentHsi.registerOrderRejectCallback(orderId, cb);
  else legacyHsi.registerOrderRejectCallback(orderId, cb);
}

export function deregisterOrderRejectCallbackForConfig(config: BrokerConfig, orderId: string): void {
  if (isCurrent(config)) currentHsi.deregisterOrderRejectCallback(orderId);
  else legacyHsi.deregisterOrderRejectCallback(orderId);
}

export function registerExitOrderForConfig(config: BrokerConfig, orderId: string, tradeId: string): void {
  if (isCurrent(config)) currentHsi.registerExitOrder(orderId, tradeId);
  else legacyHsi.registerExitOrder(orderId, tradeId);
}

export function getHsiProfileLabel(config: BrokerConfig): string {
  return getKotakApiProfileInfo(config.apiVersion).label;
}
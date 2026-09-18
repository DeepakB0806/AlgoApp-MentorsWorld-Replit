import type { BrokerConfig } from "@workspace/db";
import EL from "./el-kotak-neo-v3";

export const KOTAK_API_VERSIONS = ["v2_legacy", "v3_current"] as const;
export type KotakApiVersion = (typeof KOTAK_API_VERSIONS)[number];

export interface KotakApiProfileInfo {
  value: KotakApiVersion;
  label: string;
  description: string;
  recommended: boolean;
}

const PROFILE_INFO: Record<KotakApiVersion, KotakApiProfileInfo> = {
  v2_legacy: {
    value: "v2_legacy",
    label: "Legacy v2",
    description: "Compatibility profile for existing Kotak Neo v2 behavior.",
    recommended: false,
  },
  v3_current: {
    value: "v3_current",
    label: "Current v3",
    description: "Current Kotak Neo API with strict canonical order validation.",
    recommended: true,
  },
};

export function isKotakApiVersion(value: unknown): value is KotakApiVersion {
  return typeof value === "string" && KOTAK_API_VERSIONS.includes(value as KotakApiVersion);
}

export function normalizeKotakApiVersion(value: unknown): KotakApiVersion {
  return isKotakApiVersion(value) ? value : "v3_current";
}

export function getKotakApiProfileInfo(value: unknown): KotakApiProfileInfo {
  return PROFILE_INFO[normalizeKotakApiVersion(value)];
}

function invalid(error: string) {
  return Promise.resolve({ success: false as const, error });
}

function validateV3Order(
  params: Record<string, any>,
  operation: "place" | "modify",
): string | null {
  const orderType = String(params.priceType ?? params.orderType ?? "").trim().toUpperCase();
  const validity = String(params.validity ?? "").trim().toUpperCase();
  const price = Number(params.price);
  const quantity = Number(params.quantity);

  if (!["L", "MKT", "SL", "SL-M"].includes(orderType)) {
    return `Kotak v3 rejects order type "${orderType || "(blank)"}". Allowed values: L, MKT, SL, SL-M.`;
  }
  if (!["DAY", "IOC"].includes(validity)) {
    return `Kotak v3 rejects validity "${validity || "(blank)"}". Allowed values: DAY, IOC.`;
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return "Kotak v3 requires quantity to be a positive integer.";
  }
  if ((orderType === "L" || orderType === "SL") && (!Number.isFinite(price) || price <= 0)) {
    return `Kotak v3 requires a positive price for ${orderType} orders.`;
  }

  if (operation === "place") {
    const exchange = String(params.exchange ?? params.exchangeSegment ?? "").trim().toLowerCase();
    const product = String(params.productType ?? params.product ?? "").trim().toUpperCase();
    if (!["nse_cm", "bse_cm", "nse_fo", "bse_fo", "mcx_fo"].includes(exchange)) {
      return `Kotak v3 rejects exchange segment "${exchange || "(blank)"}". Currency derivatives and generic exchange aliases are unsupported.`;
    }
    if (!["CNC", "NRML", "MIS", "MTF"].includes(product)) {
      return `Kotak v3 rejects product "${product || "(blank)"}". Cover and bracket orders are unsupported.`;
    }
    if (exchange === "mcx_fo" && validity !== "DAY") {
      return "Kotak v3 supports DAY validity only for MCX orders.";
    }
  }

  return null;
}

const KotakAPI = new Proxy(EL, {
  get(target, property, receiver) {
    if (property === "authenticate") {
      return (config: BrokerConfig, totp: string) => {
        normalizeKotakApiVersion(config.apiVersion);
        return target.authenticate(config, totp);
      };
    }

    if (property === "placeOrder") {
      return (config: BrokerConfig, params: Record<string, any>) => {
        if (normalizeKotakApiVersion(config.apiVersion) === "v3_current") {
          const error = validateV3Order(params, "place");
          if (error) return invalid(error);
        }
        return target.placeOrder(config, params);
      };
    }

    if (property === "modifyOrder") {
      return (config: BrokerConfig, params: Record<string, any>) => {
        if (normalizeKotakApiVersion(config.apiVersion) === "v3_current") {
          const error = validateV3Order(params, "modify");
          if (error) return invalid(error);
        }
        return target.modifyOrder(config, params);
      };
    }

    if (property === "cancelOrder") {
      return (
        config: BrokerConfig,
        orderNo: string,
        orderType: "regular" | "cover" | "bracket" = "regular",
        afterMarketOrder = false,
      ) => {
        if (normalizeKotakApiVersion(config.apiVersion) === "v3_current" && orderType !== "regular") {
          return invalid("Kotak v3 does not support cover or bracket order cancellation.");
        }
        return target.cancelOrder(config, orderNo, orderType, afterMarketOrder);
      };
    }

    if (property === "getLimits") {
      return (config: BrokerConfig, exchange = "ALL", segment = "ALL", product = "ALL") => {
        if (normalizeKotakApiVersion(config.apiVersion) === "v3_current") {
          return target.getLimits(config);
        }
        return target.getLimits(config, exchange, segment, product);
      };
    }

    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
}) as typeof EL;

export default KotakAPI;
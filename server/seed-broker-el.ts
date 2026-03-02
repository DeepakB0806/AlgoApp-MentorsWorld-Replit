import { db } from "./db";
import { broker_api_endpoints, broker_exchange_maps, broker_headers } from "@shared/schema";
import { eq } from "drizzle-orm";

const BROKER_NAME = "kotak_neo_v3";
const LOG_PREFIX = "[EL-Seed]";

export async function ensureBrokerEndpoints(): Promise<{ endpoints: number; exchanges: number; headers: number }> {
  const existingEndpoints = await db.select().from(broker_api_endpoints).where(eq(broker_api_endpoints.brokerName, BROKER_NAME));
  const existingExchanges = await db.select().from(broker_exchange_maps).where(eq(broker_exchange_maps.brokerName, BROKER_NAME));
  const existingHeaders = await db.select().from(broker_headers).where(eq(broker_headers.brokerName, BROKER_NAME));

  const existingEndpointNames = new Set(existingEndpoints.map(e => e.endpointName));
  const missingEndpoints: { brokerName: string; category: string; endpointName: string; endpointPath: string; httpMethod: string; baseUrlType: string; contentType: string; bodyFormat: string; authType: string; description: string; sortOrder: number }[] = [];
  if (!existingEndpointNames.has("scrip_master_file_paths")) {
    missingEndpoints.push({ brokerName: BROKER_NAME, category: "data_get", endpointName: "scrip_master_file_paths", endpointPath: "/script-details/1.0/masterscrip/file-paths", httpMethod: "GET", baseUrlType: "trading", contentType: "application/json", bodyFormat: "none", authType: "session", description: "Get scrip master file download URLs", sortOrder: 16 });
  }
  if (missingEndpoints.length > 0) {
    const added = await db.insert(broker_api_endpoints).values(missingEndpoints).returning();
    console.log(`${LOG_PREFIX} Added ${added.length} missing endpoints: ${added.map(e => e.endpointName).join(', ')}`);
  }

  const existingHeaderKeys = new Set(existingHeaders.map(h => `${h.authType}::${h.headerName}`));
  const missingHeaders: { brokerName: string; authType: string; headerName: string; headerSource: string; headerValue: string; sortOrder: number }[] = [];
  if (!existingHeaderKeys.has("session::Authorization")) {
    missingHeaders.push({ brokerName: BROKER_NAME, authType: "session", headerName: "Authorization", headerSource: "config_field", headerValue: "consumerKey", sortOrder: 4 });
  }
  if (missingHeaders.length > 0) {
    const added = await db.insert(broker_headers).values(missingHeaders).returning();
    console.log(`${LOG_PREFIX} Added ${added.length} missing headers: ${added.map(h => `${h.authType}::${h.headerName}`).join(', ')}`);
  }

  if (existingEndpoints.length > 0 && existingExchanges.length > 0 && existingHeaders.length > 0) {
    console.log(`${LOG_PREFIX} Already populated (${existingEndpoints.length + missingEndpoints.length} endpoints, ${existingExchanges.length} exchanges, ${existingHeaders.length} headers)`);
    return { endpoints: existingEndpoints.length + missingEndpoints.length, exchanges: existingExchanges.length, headers: existingHeaders.length };
  }

  let endpointCount = 0;
  let exchangeCount = 0;
  let headerCount = 0;

  if (existingEndpoints.length === 0) {
    const endpoints = [
      { brokerName: BROKER_NAME, category: "auth", endpointName: "totp_login", endpointPath: "/login/1.0/tradeApiLogin", httpMethod: "POST", baseUrlType: "login", contentType: "application/json", bodyFormat: "json", authType: "consumer_key", description: "TOTP Login - Step 1 of authentication", sortOrder: 1 },
      { brokerName: BROKER_NAME, category: "auth", endpointName: "mpin_validate", endpointPath: "/login/1.0/tradeApiValidate", httpMethod: "POST", baseUrlType: "login", contentType: "application/json", bodyFormat: "json", authType: "consumer_key_with_view", description: "MPIN Validate - Step 2 of authentication", sortOrder: 2 },
      { brokerName: BROKER_NAME, category: "order_place", endpointName: "place_order", endpointPath: "/quick/order/rule/ms/place", httpMethod: "POST", baseUrlType: "trading", contentType: "application/x-www-form-urlencoded", bodyFormat: "jdata_urlencoded", authType: "session", description: "Place regular order", sortOrder: 3 },
      { brokerName: BROKER_NAME, category: "order_modify", endpointName: "modify_order", endpointPath: "/quick/order/vr/modify", httpMethod: "POST", baseUrlType: "trading", contentType: "application/x-www-form-urlencoded", bodyFormat: "jdata_urlencoded", authType: "session", description: "Modify existing order", sortOrder: 4 },
      { brokerName: BROKER_NAME, category: "order_cancel", endpointName: "cancel_order", endpointPath: "/quick/order/cancel", httpMethod: "POST", baseUrlType: "trading", contentType: "application/x-www-form-urlencoded", bodyFormat: "jdata_urlencoded", authType: "session", description: "Cancel regular order", sortOrder: 5 },
      { brokerName: BROKER_NAME, category: "order_cancel", endpointName: "exit_cover_order", endpointPath: "/quick/order/co/exit", httpMethod: "POST", baseUrlType: "trading", contentType: "application/x-www-form-urlencoded", bodyFormat: "jdata_urlencoded", authType: "session", description: "Exit cover order", sortOrder: 6 },
      { brokerName: BROKER_NAME, category: "order_cancel", endpointName: "exit_bracket_order", endpointPath: "/quick/order/bo/exit", httpMethod: "POST", baseUrlType: "trading", contentType: "application/x-www-form-urlencoded", bodyFormat: "jdata_urlencoded", authType: "session", description: "Exit bracket order", sortOrder: 7 },
      { brokerName: BROKER_NAME, category: "order_history", endpointName: "order_history", endpointPath: "/quick/order/history", httpMethod: "POST", baseUrlType: "trading", contentType: "application/x-www-form-urlencoded", bodyFormat: "jdata_urlencoded", authType: "session", description: "Get order history by order number", sortOrder: 8 },
      { brokerName: BROKER_NAME, category: "data_get", endpointName: "order_book", endpointPath: "/quick/user/orders", httpMethod: "GET", baseUrlType: "trading", contentType: "application/x-www-form-urlencoded", bodyFormat: "none", authType: "session", description: "Get order book", sortOrder: 9 },
      { brokerName: BROKER_NAME, category: "data_get", endpointName: "trade_book", endpointPath: "/quick/user/trades", httpMethod: "GET", baseUrlType: "trading", contentType: "application/x-www-form-urlencoded", bodyFormat: "none", authType: "session", description: "Get trade book", sortOrder: 10 },
      { brokerName: BROKER_NAME, category: "positions", endpointName: "positions", endpointPath: "/quick/user/positions", httpMethod: "GET", baseUrlType: "trading", contentType: "application/x-www-form-urlencoded", bodyFormat: "none", authType: "session", description: "Get current positions", sortOrder: 11 },
      { brokerName: BROKER_NAME, category: "holdings", endpointName: "holdings", endpointPath: "/portfolio/v1/holdings", httpMethod: "GET", baseUrlType: "trading", contentType: "application/x-www-form-urlencoded", bodyFormat: "none", authType: "session", description: "Get portfolio holdings", sortOrder: 12 },
      { brokerName: BROKER_NAME, category: "margin", endpointName: "check_margin", endpointPath: "/quick/user/check-margin", httpMethod: "POST", baseUrlType: "trading", contentType: "application/x-www-form-urlencoded", bodyFormat: "jdata_urlencoded", authType: "session", description: "Check margin requirement", sortOrder: 13 },
      { brokerName: BROKER_NAME, category: "limits", endpointName: "limits", endpointPath: "/quick/user/limits", httpMethod: "POST", baseUrlType: "trading", contentType: "application/x-www-form-urlencoded", bodyFormat: "jdata_urlencoded", authType: "session", description: "Get available funds/limits", sortOrder: 14 },
      { brokerName: BROKER_NAME, category: "quotes", endpointName: "quotes", endpointPath: "/script-details/1.0/quotes/neosymbol/{exchange}|{token}/all", httpMethod: "GET", baseUrlType: "trading", contentType: "application/x-www-form-urlencoded", bodyFormat: "none", authType: "consumer_key", description: "Get live quotes", sortOrder: 15 },
      { brokerName: BROKER_NAME, category: "data_get", endpointName: "scrip_master_file_paths", endpointPath: "/script-details/1.0/masterscrip/file-paths", httpMethod: "GET", baseUrlType: "trading", contentType: "application/json", bodyFormat: "none", authType: "session", description: "Get scrip master file download URLs", sortOrder: 16 },
    ];
    const inserted = await db.insert(broker_api_endpoints).values(endpoints).returning();
    endpointCount = inserted.length;
    console.log(`${LOG_PREFIX} Seeded ${endpointCount} endpoints`);
  }

  if (existingExchanges.length === 0) {
    const exchanges = [
      { brokerName: BROKER_NAME, universalCode: "NSE", brokerCode: "nse_cm", description: "NSE Cash Market" },
      { brokerName: BROKER_NAME, universalCode: "BSE", brokerCode: "bse_cm", description: "BSE Cash Market" },
      { brokerName: BROKER_NAME, universalCode: "NFO", brokerCode: "nse_fo", description: "NSE Futures & Options" },
      { brokerName: BROKER_NAME, universalCode: "BFO", brokerCode: "bse_fo", description: "BSE Futures & Options" },
      { brokerName: BROKER_NAME, universalCode: "MCX", brokerCode: "mcx_fo", description: "MCX Commodity Futures" },
      { brokerName: BROKER_NAME, universalCode: "CDS", brokerCode: "cds_fo", description: "Currency Derivatives" },
    ];
    const inserted = await db.insert(broker_exchange_maps).values(exchanges).returning();
    exchangeCount = inserted.length;
    console.log(`${LOG_PREFIX} Seeded ${exchangeCount} exchange mappings`);
  }

  if (existingHeaders.length === 0) {
    const headers = [
      { brokerName: BROKER_NAME, authType: "consumer_key", headerName: "Authorization", headerSource: "config_field", headerValue: "consumerKey", sortOrder: 1 },
      { brokerName: BROKER_NAME, authType: "consumer_key", headerName: "neo-fin-key", headerSource: "static", headerValue: "neotradeapi", sortOrder: 2 },
      { brokerName: BROKER_NAME, authType: "consumer_key", headerName: "Content-Type", headerSource: "static", headerValue: "application/json", sortOrder: 3 },
      { brokerName: BROKER_NAME, authType: "consumer_key_with_view", headerName: "Authorization", headerSource: "config_field", headerValue: "consumerKey", sortOrder: 1 },
      { brokerName: BROKER_NAME, authType: "consumer_key_with_view", headerName: "neo-fin-key", headerSource: "static", headerValue: "neotradeapi", sortOrder: 2 },
      { brokerName: BROKER_NAME, authType: "consumer_key_with_view", headerName: "Content-Type", headerSource: "static", headerValue: "application/json", sortOrder: 3 },
      { brokerName: BROKER_NAME, authType: "consumer_key_with_view", headerName: "Auth", headerSource: "config_field", headerValue: "viewToken", sortOrder: 4 },
      { brokerName: BROKER_NAME, authType: "consumer_key_with_view", headerName: "sid", headerSource: "config_field", headerValue: "sidView", sortOrder: 5 },
      { brokerName: BROKER_NAME, authType: "session", headerName: "Sid", headerSource: "config_field", headerValue: "sessionId", sortOrder: 1 },
      { brokerName: BROKER_NAME, authType: "session", headerName: "Auth", headerSource: "config_field", headerValue: "accessToken", sortOrder: 2 },
      { brokerName: BROKER_NAME, authType: "session", headerName: "Content-Type", headerSource: "static", headerValue: "application/x-www-form-urlencoded", sortOrder: 3 },
      { brokerName: BROKER_NAME, authType: "session", headerName: "Authorization", headerSource: "config_field", headerValue: "consumerKey", sortOrder: 4 },
    ];
    const inserted = await db.insert(broker_headers).values(headers).returning();
    headerCount = inserted.length;
    console.log(`${LOG_PREFIX} Seeded ${headerCount} header templates`);
  }

  return { endpoints: endpointCount || existingEndpoints.length, exchanges: exchangeCount || existingExchanges.length, headers: headerCount || existingHeaders.length };
}

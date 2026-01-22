/**
 * Kotak Neo Trading API Client
 * Based on official Kotak Neo API Postman collection
 * 
 * Authentication Flow:
 * 1. TOTP Login: POST /login/1.0/tradeApiLogin with mobileNumber, ucc, totp
 *    - Returns: viewtoken and sidView
 * 2. MPIN Validate: POST /login/1.0/tradeApiValidate with mpin
 *    - Returns: sessiontoken, sidSession, and baseUrl for trading APIs
 */

import type { KotakNeoAuthResponse } from "@shared/schema";

// API Base URLs
const LOGIN_BASE_URL = "https://mis.kotaksecurities.com";
const NEO_FIN_KEY = "neotradeapi";

export interface KotakNeoSession {
  viewToken: string;
  sidView: string;
  sessionToken: string;
  sidSession: string;
  baseUrl: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface OrderParams {
  tradingSymbol: string;     // e.g., "TCS-EQ"
  exchange: string;          // e.g., "nse_cm", "bse_cm", "nse_fo"
  transactionType: "B" | "S"; // Buy or Sell
  quantity: number;
  price: number;
  orderType: "L" | "MKT" | "SL" | "SL-M"; // Limit, Market, Stop Loss, Stop Loss Market
  productType: "CNC" | "NRML" | "MIS" | "CO" | "BO"; // Cash & Carry, Normal, Intraday, Cover, Bracket
  validity: "DAY" | "IOC" | "GTD"; // Day, Immediate or Cancel, Good Till Date
  triggerPrice?: number;     // For SL orders
  disclosedQuantity?: number;
  afterMarketOrder?: boolean;
}

export interface ModifyOrderParams extends OrderParams {
  orderNo: string;
}

// TOTP Login - Step 1 of authentication
export async function totpLogin(
  consumerKey: string,
  mobileNumber: string,
  ucc: string,
  totp: string
): Promise<ApiResponse<{ token: string; sid: string }>> {
  try {
    const response = await fetch(`${LOGIN_BASE_URL}/login/1.0/tradeApiLogin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "neo-fin-key": NEO_FIN_KEY,
        "Authorization": consumerKey,
      },
      body: JSON.stringify({
        mobileNumber,
        ucc,
        totp,
      }),
    });

    const data = await response.json();

    if (response.ok && data.data?.token && data.data?.sid) {
      return {
        success: true,
        data: {
          token: data.data.token,
          sid: data.data.sid,
        },
        message: "TOTP validation successful",
      };
    }

    return {
      success: false,
      error: data.message || data.error || `TOTP validation failed (${response.status})`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error during TOTP login",
    };
  }
}

// MPIN Validate - Step 2 of authentication
export async function mpinValidate(
  consumerKey: string,
  viewToken: string,
  sidView: string,
  mpin: string
): Promise<ApiResponse<{ token: string; sid: string; baseUrl: string }>> {
  try {
    const response = await fetch(`${LOGIN_BASE_URL}/login/1.0/tradeApiValidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "neo-fin-key": NEO_FIN_KEY,
        "Authorization": consumerKey,
        "Auth": viewToken,
        "sid": sidView,
      },
      body: JSON.stringify({
        mpin,
      }),
    });

    const data = await response.json();

    if (response.ok && data.data?.token && data.data?.sid && data.data?.baseUrl) {
      return {
        success: true,
        data: {
          token: data.data.token,
          sid: data.data.sid,
          baseUrl: data.data.baseUrl,
        },
        message: "MPIN validation successful - Session established",
      };
    }

    return {
      success: false,
      error: data.message || data.error || `MPIN validation failed (${response.status})`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error during MPIN validation",
    };
  }
}

// Full authentication flow
export async function authenticate(
  consumerKey: string,
  mobileNumber: string,
  ucc: string,
  mpin: string,
  totp: string
): Promise<ApiResponse<KotakNeoSession>> {
  // Step 1: TOTP Login
  const totpResult = await totpLogin(consumerKey, mobileNumber, ucc, totp);

  if (!totpResult.success || !totpResult.data) {
    return {
      success: false,
      error: totpResult.error || "TOTP login failed",
    };
  }

  // Step 2: MPIN Validation
  const mpinResult = await mpinValidate(
    consumerKey,
    totpResult.data.token,
    totpResult.data.sid,
    mpin
  );

  if (!mpinResult.success || !mpinResult.data) {
    return {
      success: false,
      error: mpinResult.error || "MPIN validation failed",
    };
  }

  return {
    success: true,
    data: {
      viewToken: totpResult.data.token,
      sidView: totpResult.data.sid,
      sessionToken: mpinResult.data.token,
      sidSession: mpinResult.data.sid,
      baseUrl: mpinResult.data.baseUrl,
    },
    message: "Authentication successful - Trading session established",
  };
}

// Helper to create authenticated request headers
function getAuthHeaders(session: KotakNeoSession): Record<string, string> {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    "Sid": session.sidSession,
    "Auth": session.sessionToken,
  };
}

// Place Order
export async function placeOrder(
  session: KotakNeoSession,
  params: OrderParams
): Promise<ApiResponse<{ orderNo: string }>> {
  try {
    const orderData = {
      am: params.afterMarketOrder ? "YES" : "NO",
      dq: String(params.disclosedQuantity || 0),
      es: params.exchange,
      mp: "0",
      pc: params.productType,
      pf: "N",
      pr: String(params.price),
      pt: params.orderType === "MKT" ? "MKT" : "L",
      qt: String(params.quantity),
      rt: params.validity,
      tp: String(params.triggerPrice || 0),
      ts: params.tradingSymbol,
      tt: params.transactionType,
    };

    const response = await fetch(`${session.baseUrl}/quick/order/rule/ms/place`, {
      method: "POST",
      headers: getAuthHeaders(session),
      body: new URLSearchParams({ jData: JSON.stringify(orderData) }),
    });

    const data = await response.json();

    if (data.nOrdNo) {
      return {
        success: true,
        data: { orderNo: data.nOrdNo },
        message: `Order placed successfully. Order No: ${data.nOrdNo}`,
      };
    }

    return {
      success: false,
      error: data.message || data.errMsg || "Order placement failed",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Order placement error",
    };
  }
}

// Modify Order
export async function modifyOrder(
  session: KotakNeoSession,
  params: ModifyOrderParams
): Promise<ApiResponse<{ orderNo: string }>> {
  try {
    const orderData = {
      am: params.afterMarketOrder ? "YES" : "NO",
      dq: String(params.disclosedQuantity || 0),
      es: params.exchange,
      mp: "0",
      pc: params.productType,
      pf: "N",
      pr: String(params.price),
      pt: params.orderType === "MKT" ? "MKT" : "L",
      qt: String(params.quantity),
      vd: params.validity,
      tp: String(params.triggerPrice || 0),
      ts: params.tradingSymbol,
      tt: params.transactionType,
      no: params.orderNo,
    };

    const response = await fetch(`${session.baseUrl}/quick/order/vr/modify`, {
      method: "POST",
      headers: getAuthHeaders(session),
      body: new URLSearchParams({ jData: JSON.stringify(orderData) }),
    });

    const data = await response.json();

    if (data.nOrdNo) {
      return {
        success: true,
        data: { orderNo: data.nOrdNo },
        message: `Order modified successfully. Order No: ${data.nOrdNo}`,
      };
    }

    return {
      success: false,
      error: data.message || data.errMsg || "Order modification failed",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Order modification error",
    };
  }
}

// Cancel Order
export async function cancelOrder(
  session: KotakNeoSession,
  orderNo: string,
  afterMarketOrder = false
): Promise<ApiResponse> {
  try {
    const response = await fetch(`${session.baseUrl}/quick/order/cancel`, {
      method: "POST",
      headers: getAuthHeaders(session),
      body: new URLSearchParams({
        jData: JSON.stringify({ on: orderNo, am: afterMarketOrder ? "YES" : "NO" }),
      }),
    });

    const data = await response.json();

    if (response.ok && !data.errMsg) {
      return {
        success: true,
        message: `Order ${orderNo} cancelled successfully`,
      };
    }

    return {
      success: false,
      error: data.message || data.errMsg || "Order cancellation failed",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Order cancellation error",
    };
  }
}

// Exit Cover Order
export async function exitCoverOrder(
  session: KotakNeoSession,
  orderNo: string
): Promise<ApiResponse> {
  try {
    const response = await fetch(`${session.baseUrl}/quick/order/co/exit`, {
      method: "POST",
      headers: getAuthHeaders(session),
      body: new URLSearchParams({
        jData: JSON.stringify({ on: orderNo, am: "NO" }),
      }),
    });

    const data = await response.json();

    if (response.ok && !data.errMsg) {
      return {
        success: true,
        message: `Cover order ${orderNo} exited successfully`,
      };
    }

    return {
      success: false,
      error: data.message || data.errMsg || "Cover order exit failed",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Cover order exit error",
    };
  }
}

// Exit Bracket Order
export async function exitBracketOrder(
  session: KotakNeoSession,
  orderNo: string
): Promise<ApiResponse> {
  try {
    const response = await fetch(`${session.baseUrl}/quick/order/bo/exit`, {
      method: "POST",
      headers: getAuthHeaders(session),
      body: new URLSearchParams({
        jData: JSON.stringify({ on: orderNo, am: "NO" }),
      }),
    });

    const data = await response.json();

    if (response.ok && !data.errMsg) {
      return {
        success: true,
        message: `Bracket order ${orderNo} exited successfully`,
      };
    }

    return {
      success: false,
      error: data.message || data.errMsg || "Bracket order exit failed",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Bracket order exit error",
    };
  }
}

// Get Order History
export async function getOrderHistory(
  session: KotakNeoSession,
  orderNo: string
): Promise<ApiResponse<unknown[]>> {
  try {
    const response = await fetch(`${session.baseUrl}/quick/order/history`, {
      method: "POST",
      headers: getAuthHeaders(session),
      body: new URLSearchParams({
        jData: JSON.stringify({ nOrdNo: orderNo }),
      }),
    });

    const data = await response.json();

    if (Array.isArray(data)) {
      return {
        success: true,
        data,
      };
    }

    return {
      success: false,
      error: data.message || data.errMsg || "Failed to fetch order history",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Order history error",
    };
  }
}

// Get Order Book
export async function getOrderBook(session: KotakNeoSession): Promise<ApiResponse<unknown[]>> {
  try {
    const response = await fetch(`${session.baseUrl}/quick/user/orders`, {
      method: "GET",
      headers: getAuthHeaders(session),
    });

    const data = await response.json();

    if (Array.isArray(data)) {
      return { success: true, data };
    }

    if (data.data && Array.isArray(data.data)) {
      return { success: true, data: data.data };
    }

    return { success: true, data: [] };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Order book error",
    };
  }
}

// Get Trade Book
export async function getTradeBook(session: KotakNeoSession): Promise<ApiResponse<unknown[]>> {
  try {
    const response = await fetch(`${session.baseUrl}/quick/user/trades`, {
      method: "GET",
      headers: getAuthHeaders(session),
    });

    const data = await response.json();

    if (Array.isArray(data)) {
      return { success: true, data };
    }

    if (data.data && Array.isArray(data.data)) {
      return { success: true, data: data.data };
    }

    return { success: true, data: [] };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Trade book error",
    };
  }
}

// Get Positions
export async function getPositions(session: KotakNeoSession): Promise<ApiResponse<unknown[]>> {
  try {
    const response = await fetch(`${session.baseUrl}/quick/user/positions`, {
      method: "GET",
      headers: getAuthHeaders(session),
    });

    const data = await response.json();

    if (Array.isArray(data)) {
      return { success: true, data };
    }

    if (data.data && Array.isArray(data.data)) {
      return { success: true, data: data.data };
    }

    return { success: true, data: [] };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Positions error",
    };
  }
}

// Get Holdings
export async function getHoldings(session: KotakNeoSession): Promise<ApiResponse<unknown[]>> {
  try {
    const response = await fetch(`${session.baseUrl}/portfolio/v1/holdings`, {
      method: "GET",
      headers: getAuthHeaders(session),
    });

    const data = await response.json();

    if (Array.isArray(data)) {
      return { success: true, data };
    }

    if (data.data && Array.isArray(data.data)) {
      return { success: true, data: data.data };
    }

    return { success: true, data: [] };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Holdings error",
    };
  }
}

// Check Margin
export interface MarginParams {
  exchange: string;      // e.g., "nse_cm"
  token: string;         // Token/Symbol ID
  transactionType: "B" | "S";
  quantity: number;
  price: number;
  orderType: "L" | "MKT";
  productType: string;
}

export async function checkMargin(
  session: KotakNeoSession,
  params: MarginParams
): Promise<ApiResponse<unknown>> {
  try {
    const marginData = {
      brkName: "KOTAK",
      brnchId: "ONLINE",
      exSeg: params.exchange,
      prc: String(params.price),
      prcTp: params.orderType,
      prod: params.productType,
      qty: String(params.quantity),
      tok: params.token,
      trnsTp: params.transactionType,
    };

    const response = await fetch(`${session.baseUrl}/quick/user/check-margin`, {
      method: "POST",
      headers: getAuthHeaders(session),
      body: new URLSearchParams({ jData: JSON.stringify(marginData) }),
    });

    const data = await response.json();

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Margin check error",
    };
  }
}

// Get Limits (Available Funds)
export async function getLimits(
  session: KotakNeoSession,
  exchange = "ALL",
  segment = "ALL",
  product = "ALL"
): Promise<ApiResponse<unknown>> {
  try {
    const response = await fetch(`${session.baseUrl}/quick/user/limits`, {
      method: "POST",
      headers: getAuthHeaders(session),
      body: new URLSearchParams({
        jData: JSON.stringify({ exch: exchange, seg: segment, prod: product }),
      }),
    });

    const data = await response.json();

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Limits error",
    };
  }
}

// Get Quotes
export async function getQuotes(
  session: KotakNeoSession,
  consumerKey: string,
  exchange: string,
  token: string
): Promise<ApiResponse<unknown>> {
  try {
    const response = await fetch(
      `${session.baseUrl}/script-details/1.0/quotes/neosymbol/${exchange}|${token}/all`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": consumerKey,
        },
      }
    );

    const data = await response.json();

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Quotes error",
    };
  }
}

// Get Scrip Master File Paths
export async function getScripMasterPaths(
  consumerKey: string
): Promise<ApiResponse<unknown>> {
  try {
    const response = await fetch(
      "https://d-mis.kotaksecurities.com/script-details/1.0/masterscrip/file-paths",
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": consumerKey,
        },
      }
    );

    const data = await response.json();

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Scrip master error",
    };
  }
}

// Test connectivity (doesn't require full authentication)
export async function testConnectivity(consumerKey?: string): Promise<KotakNeoAuthResponse> {
  try {
    // Test connection to Kotak Neo API servers using a simple request
    const response = await fetch(`${LOGIN_BASE_URL}/login/1.0/tradeApiLogin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "neo-fin-key": NEO_FIN_KEY,
        ...(consumerKey && { Authorization: consumerKey }),
      },
      body: JSON.stringify({
        mobileNumber: "",
        ucc: "",
        totp: "",
      }),
    });

    // Even if we get an error response, the server is reachable
    if (response.status < 500) {
      return {
        success: true,
        message: "Kotak Neo API servers are reachable",
      };
    }

    return {
      success: false,
      message: "Server error",
      error: `Server returned status ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      message: "Unable to reach Kotak Neo API servers",
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

// Wrapper for legacy compatibility
export async function testKotakNeoConnectivity(consumerKey: string): Promise<KotakNeoAuthResponse> {
  return testConnectivity(consumerKey);
}

// Wrapper for legacy compatibility
export async function authenticateKotakNeo(credentials: {
  consumer_key: string;
  mobile_number: string;
  ucc: string;
  mpin: string;
  totp: string;
}): Promise<KotakNeoAuthResponse> {
  const result = await authenticate(
    credentials.consumer_key,
    credentials.mobile_number,
    credentials.ucc,
    credentials.mpin,
    credentials.totp
  );

  if (result.success && result.data) {
    return {
      success: true,
      message: result.message || "Authentication successful",
      accessToken: result.data.sessionToken,
      sessionId: result.data.sidSession,
    };
  }

  return {
    success: false,
    message: result.error || "Authentication failed",
    error: result.error,
  };
}

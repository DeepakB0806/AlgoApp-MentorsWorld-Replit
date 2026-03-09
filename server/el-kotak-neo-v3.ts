import { db } from "./db";
import { broker_api_endpoints, broker_exchange_maps, broker_headers } from "@shared/schema";
import type { BrokerConfig } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import TL from "./tl-kotak-neo-v3";

const BROKER_NAME = "kotak_neo_v3";
const LOG_PREFIX = "[EL]";
const LOGIN_BASE_URL = "https://mis.kotaksecurities.com";

interface EndpointEntry {
  id: number;
  category: string;
  endpointName: string;
  endpointPath: string;
  httpMethod: string;
  baseUrlType: string;
  contentType: string;
  bodyFormat: string;
  authType: string;
  description: string | null;
}

interface ExchangeMapEntry {
  universalCode: string;
  brokerCode: string;
}

interface HeaderEntry {
  authType: string;
  headerName: string;
  headerSource: string;
  headerValue: string;
}

interface ELStatus {
  isReady: boolean;
  brokerName: string;
  endpointCount: number;
  exchangeMapCount: number;
  headerCount: number;
  categories: string[];
  endpointNames: string[];
  lastLoadTime: string | null;
  lastLoadDurationMs: number | null;
  initError: string | null;
  tlReady: boolean;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  sessionExpired?: boolean;
}

class ExecutionLayer {
  private endpoints: EndpointEntry[] = [];
  private endpointsByCategory: Map<string, EndpointEntry[]> = new Map();
  private endpointByName: Map<string, EndpointEntry> = new Map();
  private exchangeMap: Map<string, string> = new Map();
  private reverseExchangeMap: Map<string, string> = new Map();
  private headersByAuthType: Map<string, HeaderEntry[]> = new Map();

  private ready = false;
  private lastLoadTime: string | null = null;
  private lastLoadDurationMs: number | null = null;
  private initError: string | null = null;
  private reloading = false;

  async init(): Promise<void> {
    const start = Date.now();
    console.log(`${LOG_PREFIX} Initializing Execution Layer for ${BROKER_NAME}...`);

    try {
      const rawEndpoints = await db
        .select()
        .from(broker_api_endpoints)
        .where(eq(broker_api_endpoints.brokerName, BROKER_NAME));

      if (rawEndpoints.length === 0) {
        this.ready = false;
        this.initError = `No API endpoints found for ${BROKER_NAME}`;
        console.error(`${LOG_PREFIX} FAIL: ${this.initError}`);
        return;
      }

      this.endpoints = rawEndpoints.map((r) => ({
        id: r.id,
        category: r.category,
        endpointName: r.endpointName,
        endpointPath: r.endpointPath,
        httpMethod: r.httpMethod,
        baseUrlType: r.baseUrlType,
        contentType: r.contentType,
        bodyFormat: r.bodyFormat,
        authType: r.authType,
        description: r.description,
      }));

      const rawExchanges = await db
        .select()
        .from(broker_exchange_maps)
        .where(eq(broker_exchange_maps.brokerName, BROKER_NAME));

      if (rawExchanges.length === 0) {
        this.ready = false;
        this.initError = `No exchange mappings found for ${BROKER_NAME}`;
        console.error(`${LOG_PREFIX} FAIL: ${this.initError}`);
        return;
      }

      const rawHeaders = await db
        .select()
        .from(broker_headers)
        .where(and(eq(broker_headers.brokerName, BROKER_NAME), eq(broker_headers.isActive, true)));

      if (rawHeaders.length === 0) {
        this.ready = false;
        this.initError = `No header templates found for ${BROKER_NAME}`;
        console.error(`${LOG_PREFIX} FAIL: ${this.initError}`);
        return;
      }

      this.buildMaps(rawExchanges, rawHeaders);

      const elapsed = Date.now() - start;
      this.lastLoadTime = new Date().toISOString();
      this.lastLoadDurationMs = elapsed;
      this.initError = null;
      this.ready = true;

      const categories = [...this.endpointsByCategory.keys()];
      console.log(
        `${LOG_PREFIX} Ready — ${this.endpoints.length} endpoints, ${this.exchangeMap.size} exchanges, ${rawHeaders.length} headers, ${categories.length} categories [${categories.join(", ")}] loaded in ${elapsed}ms`,
      );
    } catch (error: any) {
      this.ready = false;
      this.initError = error.message;
      console.error(`${LOG_PREFIX} Init failed: ${error.message}`);
    }
  }

  private buildMaps(
    rawExchanges: { universalCode: string; brokerCode: string }[],
    rawHeaders: { authType: string; headerName: string; headerSource: string; headerValue: string }[],
  ): void {
    this.endpointsByCategory.clear();
    this.endpointByName.clear();
    this.exchangeMap.clear();
    this.reverseExchangeMap.clear();
    this.headersByAuthType.clear();

    for (const ep of this.endpoints) {
      this.endpointByName.set(ep.endpointName, ep);
      if (!this.endpointsByCategory.has(ep.category)) {
        this.endpointsByCategory.set(ep.category, []);
      }
      this.endpointsByCategory.get(ep.category)!.push(ep);
    }

    for (const ex of rawExchanges) {
      this.exchangeMap.set(ex.universalCode, ex.brokerCode);
      this.reverseExchangeMap.set(ex.brokerCode, ex.universalCode);
    }

    for (const h of rawHeaders) {
      if (!this.headersByAuthType.has(h.authType)) {
        this.headersByAuthType.set(h.authType, []);
      }
      this.headersByAuthType.get(h.authType)!.push({
        authType: h.authType,
        headerName: h.headerName,
        headerSource: h.headerSource,
        headerValue: h.headerValue,
      });
    }
  }

  async reload(): Promise<void> {
    if (this.reloading) {
      console.warn(`${LOG_PREFIX} Reload already in progress, skipping`);
      return;
    }
    this.reloading = true;
    try {
      console.log(`${LOG_PREFIX} Reloading from database...`);
      await this.init();
    } finally {
      this.reloading = false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  getStatus(): ELStatus {
    return {
      isReady: this.ready,
      brokerName: BROKER_NAME,
      endpointCount: this.endpoints.length,
      exchangeMapCount: this.exchangeMap.size,
      headerCount: [...this.headersByAuthType.values()].reduce((sum, arr) => sum + arr.length, 0),
      categories: [...this.endpointsByCategory.keys()],
      endpointNames: this.endpoints.map((e) => e.endpointName),
      lastLoadTime: this.lastLoadTime,
      lastLoadDurationMs: this.lastLoadDurationMs,
      initError: this.initError,
      tlReady: TL.isReady(),
    };
  }

  mapExchange(universalCode: string | null | undefined): string {
    if (!universalCode) return "nse_fo";
    return this.exchangeMap.get(universalCode.toUpperCase()) || universalCode.toLowerCase();
  }

  reverseMapExchange(brokerCode: string | null | undefined): string {
    if (!brokerCode) return "NFO";
    return this.reverseExchangeMap.get(brokerCode) || brokerCode.toUpperCase();
  }

  private getEndpoint(name: string): EndpointEntry | null {
    return this.endpointByName.get(name) || null;
  }

  private buildHeaders(
    authType: string,
    configFields: Record<string, string | null>,
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    const templates = this.headersByAuthType.get(authType) || [];

    for (const t of templates) {
      if (t.headerSource === "static") {
        headers[t.headerName] = t.headerValue;
      } else if (t.headerSource === "config_field") {
        const value = configFields[t.headerValue];
        if (value) {
          headers[t.headerName] = value;
        }
      }
    }

    return headers;
  }

  private buildHeadersForEndpoint(
    endpoint: EndpointEntry,
    configFields: Record<string, string | null>,
  ): Record<string, string> {
    const headers = this.buildHeaders(endpoint.authType, configFields);
    if (!headers["Content-Type"] && !headers["content-type"] && endpoint.httpMethod !== "GET") {
      headers["Content-Type"] = endpoint.contentType;
    }
    return headers;
  }

  private resolveUrl(endpoint: EndpointEntry, baseUrl?: string | null): string {
    if (endpoint.baseUrlType === "login") {
      return `${LOGIN_BASE_URL}${endpoint.endpointPath}`;
    }
    if (baseUrl) {
      return `${baseUrl}${endpoint.endpointPath}`;
    }
    return endpoint.endpointPath;
  }

  private formatBody(
    bodyFormat: string,
    data: Record<string, any>,
  ): { body: string | URLSearchParams; contentType?: string } | null {
    if (bodyFormat === "none") return null;

    if (bodyFormat === "json") {
      return { body: JSON.stringify(data) };
    }

    if (bodyFormat === "jdata_urlencoded") {
      const stringified: Record<string, string> = {};
      for (const [k, v] of Object.entries(data)) {
        if (v === undefined || v === null) continue;
        stringified[k] = String(v);
      }
      return { body: new URLSearchParams({ jData: JSON.stringify(stringified) }).toString() };
    }

    return { body: JSON.stringify(data) };
  }

  private async executeRequest(
    endpoint: EndpointEntry,
    headers: Record<string, string>,
    baseUrl?: string | null,
    body?: Record<string, any>,
  ): Promise<any> {
    const url = this.resolveUrl(endpoint, baseUrl);

    const fetchOptions: RequestInit = {
      method: endpoint.httpMethod,
      headers,
    };

    if (body && endpoint.httpMethod !== "GET") {
      const formatted = this.formatBody(endpoint.bodyFormat, body);
      if (formatted) {
        fetchOptions.body = formatted.body;
      }
    }

    const response = await fetch(url, fetchOptions);
    return response.json();
  }

  async authenticate(
    config: BrokerConfig,
    totp: string,
  ): Promise<ApiResponse<{ viewToken: string; sidView: string; sessionToken: string; sidSession: string; baseUrl: string }>> {
    if (!this.ready) {
      return { success: false, error: "EL not ready" };
    }

    try {
      const totpEndpoint = this.getEndpoint("totp_login");
      if (!totpEndpoint) {
        return { success: false, error: "totp_login endpoint not configured in database" };
      }

      const totpHeaders = this.buildHeadersForEndpoint(totpEndpoint, {
        consumerKey: config.consumerKey,
      });

      const totpBody = TL.isReady()
        ? TL.translateRequest("auth", {
            mobileNumber: config.mobileNumber,
            ucc: config.ucc,
            totp: totp,
          }).payload
        : { mobileNumber: config.mobileNumber, ucc: config.ucc, totp };

      const totpData = await this.executeRequest(totpEndpoint, totpHeaders, null, totpBody);

      if (!totpData?.data?.token || !totpData?.data?.sid) {
        return {
          success: false,
          error: totpData?.message || totpData?.error || "TOTP validation failed",
        };
      }

      const viewToken = totpData.data.token;
      const sidView = totpData.data.sid;

      const mpinEndpoint = this.getEndpoint("mpin_validate");
      if (!mpinEndpoint) {
        return { success: false, error: "mpin_validate endpoint not configured in database" };
      }

      const mpinHeaders = this.buildHeadersForEndpoint(mpinEndpoint, {
        consumerKey: config.consumerKey,
        viewToken,
        sidView,
      });

      const mpinBody = TL.isReady()
        ? TL.translateRequest("auth", { mpin: config.mpin }).payload
        : { mpin: config.mpin };

      const mpinData = await this.executeRequest(mpinEndpoint, mpinHeaders, null, mpinBody);

      if (!mpinData?.data?.token || !mpinData?.data?.sid || !mpinData?.data?.baseUrl) {
        return {
          success: false,
          error: mpinData?.message || mpinData?.error || "MPIN validation failed",
        };
      }

      return {
        success: true,
        data: {
          viewToken,
          sidView,
          sessionToken: mpinData.data.token,
          sidSession: mpinData.data.sid,
          baseUrl: mpinData.data.baseUrl,
        },
        message: "Authentication successful - Trading session established",
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Authentication error",
      };
    }
  }

  async placeOrder(
    config: BrokerConfig,
    universalParams: Record<string, any>,
  ): Promise<ApiResponse<{ orderNo: string }>> {
    if (!this.ready) return { success: false, error: "EL not ready" };

    try {
      const endpoint = this.getEndpoint("place_order");
      if (!endpoint) return { success: false, error: "place_order endpoint not configured" };

      const headers = this.buildHeadersForEndpoint(endpoint, {
        accessToken: config.accessToken,
        sessionId: config.sessionId,
        consumerKey: config.consumerKey,
      });

      let body: Record<string, any>;
      if (TL.isReady()) {
        const result = TL.buildRequestPayload("order_place", universalParams, true);
        body = result.payload;
        if (result.unmapped.length > 0) {
          console.warn(`${LOG_PREFIX} placeOrder unmapped fields: [${result.unmapped.join(", ")}]`);
        }
      } else {
        body = universalParams;
      }

      console.log(`${LOG_PREFIX} placeOrder request: ${JSON.stringify(body).slice(0, 300)}`);
      const data = await this.executeRequest(endpoint, headers, config.baseUrl, body);
      console.log(`${LOG_PREFIX} placeOrder response: ${JSON.stringify(data).slice(0, 500)}`);

      if (data?.nOrdNo) {
        return {
          success: true,
          data: { orderNo: data.nOrdNo },
          message: `Order placed successfully. Order No: ${data.nOrdNo}`,
        };
      }

      return {
        success: false,
        error: data?.emsg || data?.message || data?.errMsg || "Order placement failed",
        sessionExpired: this.isSessionError(data),
      };
    } catch (error: any) {
      return { success: false, error: error.message || "Order placement error" };
    }
  }

  async modifyOrder(
    config: BrokerConfig,
    universalParams: Record<string, any>,
  ): Promise<ApiResponse<{ orderNo: string }>> {
    if (!this.ready) return { success: false, error: "EL not ready" };

    try {
      const endpoint = this.getEndpoint("modify_order");
      if (!endpoint) return { success: false, error: "modify_order endpoint not configured" };

      const headers = this.buildHeadersForEndpoint(endpoint, {
        accessToken: config.accessToken,
        sessionId: config.sessionId,
        consumerKey: config.consumerKey,
      });

      let body: Record<string, any>;
      if (TL.isReady()) {
        const result = TL.buildRequestPayload("order_modify", universalParams, true);
        body = result.payload;
      } else {
        body = universalParams;
      }

      const data = await this.executeRequest(endpoint, headers, config.baseUrl, body);

      if (data?.nOrdNo) {
        return {
          success: true,
          data: { orderNo: data.nOrdNo },
          message: `Order modified successfully. Order No: ${data.nOrdNo}`,
        };
      }

      return { success: false, error: data?.message || data?.errMsg || "Order modification failed" };
    } catch (error: any) {
      return { success: false, error: error.message || "Order modification error" };
    }
  }

  async cancelOrder(
    config: BrokerConfig,
    orderNo: string,
    orderType: "regular" | "cover" | "bracket" = "regular",
    afterMarketOrder = false,
  ): Promise<ApiResponse> {
    if (!this.ready) return { success: false, error: "EL not ready" };

    try {
      const endpointName =
        orderType === "cover" ? "exit_cover_order" :
        orderType === "bracket" ? "exit_bracket_order" :
        "cancel_order";

      const endpoint = this.getEndpoint(endpointName);
      if (!endpoint) return { success: false, error: `${endpointName} endpoint not configured` };

      const headers = this.buildHeadersForEndpoint(endpoint, {
        accessToken: config.accessToken,
        sessionId: config.sessionId,
        consumerKey: config.consumerKey,
      });

      let body: Record<string, any>;
      if (TL.isReady()) {
        const result = TL.buildRequestPayload("order_cancel", {
          orderNo,
          afterMarketOrder: afterMarketOrder ? "YES" : "NO",
        });
        body = result.payload;
      } else {
        body = { on: orderNo, am: afterMarketOrder ? "YES" : "NO" };
      }

      const data = await this.executeRequest(endpoint, headers, config.baseUrl, body);

      if (!data?.errMsg) {
        return { success: true, message: `Order ${orderNo} cancelled successfully` };
      }

      return { success: false, error: data?.message || data?.errMsg || "Order cancellation failed" };
    } catch (error: any) {
      return { success: false, error: error.message || "Order cancellation error" };
    }
  }

  async getOrderBook(config: BrokerConfig): Promise<ApiResponse<unknown[]>> {
    return this.executeGetRequest(config, "order_book", "data_get");
  }

  async getTradeBook(config: BrokerConfig): Promise<ApiResponse<unknown[]>> {
    return this.executeGetRequest(config, "trade_book", "data_get");
  }

  async getPositions(config: BrokerConfig): Promise<ApiResponse<unknown[]>> {
    return this.executeGetRequest(config, "positions", "positions");
  }

  async getHoldings(config: BrokerConfig): Promise<ApiResponse<unknown[]>> {
    if (!this.ready) return { success: false, error: "EL not ready" };

    try {
      const endpoint = this.getEndpoint("holdings");
      if (!endpoint) return { success: false, error: "holdings endpoint not configured" };

      const headers = this.buildHeadersForEndpoint(endpoint, {
        accessToken: config.accessToken,
        sessionId: config.sessionId,
        consumerKey: config.consumerKey,
      });

      const data = await this.executeRequest(endpoint, headers, config.baseUrl);

      if (data?.error && Array.isArray(data.error)) {
        const errorMsg = data.error[0]?.message || "Unknown error";
        const errorCode = data.error[0]?.code;
        return {
          success: false,
          error: errorMsg,
          sessionExpired: errorCode === 401 || errorMsg.toLowerCase().includes("invalid session"),
        };
      }

      const items = this.extractArray(data);
      if (TL.isReady() && items.length > 0) {
        const translated = items.map((item: Record<string, any>) =>
          TL.translateResponse("holdings", item).payload,
        );
        return { success: true, data: translated };
      }

      return { success: true, data: items };
    } catch (error: any) {
      return { success: false, error: error.message || "Holdings error" };
    }
  }

  async getOrderHistory(
    config: BrokerConfig,
    orderNo: string,
  ): Promise<ApiResponse<unknown[]>> {
    if (!this.ready) return { success: false, error: "EL not ready" };

    try {
      const endpoint = this.getEndpoint("order_history");
      if (!endpoint) return { success: false, error: "order_history endpoint not configured" };

      const headers = this.buildHeadersForEndpoint(endpoint, {
        accessToken: config.accessToken,
        sessionId: config.sessionId,
        consumerKey: config.consumerKey,
      });

      let body: Record<string, any>;
      if (TL.isReady()) {
        const result = TL.buildRequestPayload("order_history", { orderNo });
        body = result.payload;
      } else {
        body = { nOrdNo: orderNo };
      }

      const data = await this.executeRequest(endpoint, headers, config.baseUrl, body);

      if (Array.isArray(data)) {
        return { success: true, data };
      }

      return { success: false, error: data?.message || data?.errMsg || "Failed to fetch order history" };
    } catch (error: any) {
      return { success: false, error: error.message || "Order history error" };
    }
  }

  async checkMargin(
    config: BrokerConfig,
    universalParams: Record<string, any>,
  ): Promise<ApiResponse<unknown>> {
    if (!this.ready) return { success: false, error: "EL not ready" };

    try {
      const endpoint = this.getEndpoint("check_margin");
      if (!endpoint) return { success: false, error: "check_margin endpoint not configured" };

      const headers = this.buildHeadersForEndpoint(endpoint, {
        accessToken: config.accessToken,
        sessionId: config.sessionId,
        consumerKey: config.consumerKey,
      });

      let body: Record<string, any>;
      if (TL.isReady()) {
        const result = TL.buildRequestPayload("margin", universalParams);
        body = result.payload;
      } else {
        body = universalParams;
      }

      const data = await this.executeRequest(endpoint, headers, config.baseUrl, body);
      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message || "Margin check error" };
    }
  }

  async getLimits(
    config: BrokerConfig,
    exchange = "ALL",
    segment = "ALL",
    product = "ALL",
  ): Promise<ApiResponse<unknown>> {
    if (!this.ready) return { success: false, error: "EL not ready" };

    try {
      const endpoint = this.getEndpoint("limits");
      if (!endpoint) return { success: false, error: "limits endpoint not configured" };

      const headers = this.buildHeadersForEndpoint(endpoint, {
        accessToken: config.accessToken,
        sessionId: config.sessionId,
        consumerKey: config.consumerKey,
      });

      let body: Record<string, any>;
      if (TL.isReady()) {
        const result = TL.buildRequestPayload("limits", {
          exchange,
          segment,
          product,
        });
        body = result.payload;
      } else {
        body = { exch: exchange, seg: segment, prod: product };
      }

      const data = await this.executeRequest(endpoint, headers, config.baseUrl, body);
      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message || "Limits error" };
    }
  }

  async getQuotes(
    config: BrokerConfig,
    exchange: string,
    token: string,
  ): Promise<ApiResponse<unknown>> {
    if (!this.ready) return { success: false, error: "EL not ready" };

    try {
      const endpoint = this.getEndpoint("quotes");
      if (!endpoint) return { success: false, error: "quotes endpoint not configured" };

      const resolvedPath = endpoint.endpointPath
        .replace("{exchange}", exchange)
        .replace("{token}", token);

      const headers = this.buildHeadersForEndpoint(endpoint, {
        consumerKey: config.consumerKey,
      });

      const url = config.baseUrl
        ? `${config.baseUrl}${resolvedPath}`
        : resolvedPath;

      const response = await fetch(url, { method: "GET", headers });
      const data = await response.json();

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message || "Quotes error" };
    }
  }

  async getScripMasterFilePaths(
    config: BrokerConfig,
  ): Promise<ApiResponse<any>> {
    if (!this.ready) return { success: false, error: "EL not ready" };

    try {
      const endpoint = this.getEndpoint("scrip_master_file_paths");
      if (!endpoint) return { success: false, error: "scrip_master_file_paths endpoint not configured" };

      const headers = this.buildHeadersForEndpoint(endpoint, {
        accessToken: config.accessToken,
        sessionId: config.sessionId,
        consumerKey: config.consumerKey,
      });

      const url = config.baseUrl
        ? `${config.baseUrl}${endpoint.endpointPath}`
        : endpoint.endpointPath;

      const response = await fetch(url, { method: "GET", headers });
      const data = await response.json();

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message || "Scrip master file paths error" };
    }
  }

  async testConnectivity(consumerKey?: string): Promise<ApiResponse> {
    try {
      const totpEndpoint = this.getEndpoint("totp_login");
      if (!totpEndpoint) {
        return { success: false, error: "totp_login endpoint not configured in database" };
      }

      const url = this.resolveUrl(totpEndpoint);

      const headers = this.buildHeadersForEndpoint(totpEndpoint, {
        consumerKey: consumerKey || null,
      });

      const response = await fetch(url, {
        method: totpEndpoint.httpMethod,
        headers,
        body: JSON.stringify({ mobileNumber: "", ucc: "", totp: "" }),
      });

      if (response.status < 500) {
        return { success: true, message: "Kotak Neo API servers are reachable" };
      }

      return { success: false, error: `Server returned status ${response.status}` };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Network error",
        message: "Unable to reach Kotak Neo API servers",
      };
    }
  }

  private async executeGetRequest(
    config: BrokerConfig,
    endpointName: string,
    tlCategory: string,
  ): Promise<ApiResponse<unknown[]>> {
    if (!this.ready) return { success: false, error: "EL not ready" };

    try {
      const endpoint = this.getEndpoint(endpointName);
      if (!endpoint) return { success: false, error: `${endpointName} endpoint not configured` };

      const headers = this.buildHeadersForEndpoint(endpoint, {
        accessToken: config.accessToken,
        sessionId: config.sessionId,
        consumerKey: config.consumerKey,
      });

      const data = await this.executeRequest(endpoint, headers, config.baseUrl);
      const items = this.extractArray(data);

      if (TL.isReady() && items.length > 0) {
        const translated = items.map((item: Record<string, any>) =>
          TL.translateResponse(tlCategory, item).payload,
        );
        return { success: true, data: translated };
      }

      return { success: true, data: items };
    } catch (error: any) {
      return { success: false, error: error.message || `${endpointName} error` };
    }
  }

  private extractArray(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (data?.data && Array.isArray(data.data)) return data.data;
    if (data?.stat === "Ok" && data?.result && Array.isArray(data.result)) return data.result;
    if (data?.equityHoldings && Array.isArray(data.equityHoldings)) return data.equityHoldings;
    if (data?.holdings && Array.isArray(data.holdings)) return data.holdings;
    return [];
  }

  private isSessionError(data: any): boolean {
    if (!data) return false;
    if (data.error && Array.isArray(data.error)) {
      const code = data.error[0]?.code;
      const msg = data.error[0]?.message || "";
      return code === 401 || msg.toLowerCase().includes("invalid session");
    }
    return false;
  }
}

const EL = new ExecutionLayer();

export default EL;
export { ExecutionLayer };
export type { ELStatus, ApiResponse };

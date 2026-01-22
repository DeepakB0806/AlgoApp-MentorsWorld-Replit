import type { LoginCredentials, KotakNeoAuthResponse } from "@shared/schema";

const KOTAK_NEO_BASE_URL = "https://gw-napi.kotaksecurities.com";
const KOTAK_NEO_UAT_URL = "https://gw-napi-uat.kotaksecurities.com";

export interface KotakNeoConfig {
  environment: "prod" | "uat";
  consumerKey: string;
}

export class KotakNeoAPI {
  private baseUrl: string;
  private consumerKey: string;
  private accessToken: string | null = null;
  private sessionId: string | null = null;

  constructor(config: KotakNeoConfig) {
    this.baseUrl = config.environment === "prod" ? KOTAK_NEO_BASE_URL : KOTAK_NEO_UAT_URL;
    this.consumerKey = config.consumerKey;
  }

  async testConnection(): Promise<KotakNeoAuthResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/Files/1.0/masterscrip/v2/file-paths`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.consumerKey}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        return {
          success: true,
          message: "Successfully connected to Kotak Neo API server",
        };
      }

      const errorText = await response.text();
      return {
        success: false,
        message: "Failed to connect to Kotak Neo API",
        error: `Status ${response.status}: ${errorText}`,
      };
    } catch (error) {
      return {
        success: false,
        message: "Network error connecting to Kotak Neo API",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async login(credentials: LoginCredentials): Promise<KotakNeoAuthResponse> {
    try {
      const loginUrl = `${this.baseUrl}/login/1.0/login/v2/validate`;
      
      const response = await fetch(loginUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${credentials.consumer_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mobileNumber: credentials.mobile_number,
          password: credentials.totp,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          message: "Login failed",
          error: `Status ${response.status}: ${errorText}`,
        };
      }

      const data = await response.json();
      
      if (data.data?.token) {
        this.accessToken = data.data.token;
        this.sessionId = data.data.sid;
        
        return {
          success: true,
          message: "Login successful",
          accessToken: this.accessToken || undefined,
          sessionId: this.sessionId || undefined,
        };
      }

      return {
        success: false,
        message: "Login response invalid",
        error: JSON.stringify(data),
      };
    } catch (error) {
      return {
        success: false,
        message: "Network error during login",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async validateMpin(mpin: string): Promise<KotakNeoAuthResponse> {
    try {
      if (!this.accessToken) {
        return {
          success: false,
          message: "Not authenticated. Please login first.",
        };
      }

      const validateUrl = `${this.baseUrl}/login/1.0/login/v2/validate-mpin`;
      
      const response = await fetch(validateUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.consumerKey}`,
          "Content-Type": "application/json",
          "sid": this.sessionId || "",
          "Auth": this.accessToken,
        },
        body: JSON.stringify({
          mpin: mpin,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          message: "MPIN validation failed",
          error: `Status ${response.status}: ${errorText}`,
        };
      }

      const data = await response.json();
      
      return {
        success: true,
        message: "MPIN validated. Trading session active.",
        accessToken: this.accessToken || undefined,
        sessionId: this.sessionId || undefined,
      };
    } catch (error) {
      return {
        success: false,
        message: "Network error during MPIN validation",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getPositions(): Promise<any> {
    if (!this.accessToken) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(`${this.baseUrl}/Orders/2.0/quick/user/positions`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${this.consumerKey}`,
        "Content-Type": "application/json",
        "sid": this.sessionId || "",
        "Auth": this.accessToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get positions: ${response.status}`);
    }

    return response.json();
  }

  async getOrderBook(): Promise<any> {
    if (!this.accessToken) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(`${this.baseUrl}/Orders/2.0/quick/user/orders`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${this.consumerKey}`,
        "Content-Type": "application/json",
        "sid": this.sessionId || "",
        "Auth": this.accessToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get orders: ${response.status}`);
    }

    return response.json();
  }

  async getHoldings(): Promise<any> {
    if (!this.accessToken) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(`${this.baseUrl}/Portfolio/1.0/portfolio/v2/holdings`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${this.consumerKey}`,
        "Content-Type": "application/json",
        "sid": this.sessionId || "",
        "Auth": this.accessToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get holdings: ${response.status}`);
    }

    return response.json();
  }
}

export async function testKotakNeoConnectivity(consumerKey: string): Promise<KotakNeoAuthResponse> {
  const api = new KotakNeoAPI({
    environment: "prod",
    consumerKey,
  });
  
  return api.testConnection();
}

export async function authenticateKotakNeo(credentials: LoginCredentials): Promise<KotakNeoAuthResponse> {
  const api = new KotakNeoAPI({
    environment: "prod",
    consumerKey: credentials.consumer_key,
  });
  
  const loginResult = await api.login(credentials);
  
  if (!loginResult.success) {
    return loginResult;
  }
  
  const mpinResult = await api.validateMpin(credentials.mpin);
  return mpinResult;
}

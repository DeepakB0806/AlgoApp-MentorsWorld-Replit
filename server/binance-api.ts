import { MainClient, OrderType, OrderSide, OrderTimeInForce } from "binance";
import type { KotakNeoAuthResponse } from "@shared/schema";

export interface BinanceSession {
  apiKey: string;
  apiSecret: string;
  isTestnet: boolean;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  sessionExpired?: boolean;
}

export interface BinanceOrderParams {
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET" | "STOP_LOSS_LIMIT" | "TAKE_PROFIT_LIMIT";
  quantity: number;
  price?: number;
  stopPrice?: number;
  timeInForce?: "GTC" | "IOC" | "FOK";
}

function createClient(session: BinanceSession): MainClient {
  return new MainClient({
    api_key: session.apiKey,
    api_secret: session.apiSecret,
    ...(session.isTestnet ? { baseUrl: "https://testnet.binance.vision" } : {}),
  });
}

export async function testConnectivity(apiKey?: string, apiSecret?: string, isTestnet = true): Promise<KotakNeoAuthResponse> {
  try {
    const client = new MainClient({
      ...(apiKey ? { api_key: apiKey } : {}),
      ...(apiSecret ? { api_secret: apiSecret } : {}),
      ...(isTestnet ? { baseUrl: "https://testnet.binance.vision" } : {}),
    });

    await client.testConnectivity();
    const serverTime = await client.getServerTime();

    return {
      success: true,
      message: `Binance ${isTestnet ? "Testnet" : "Production"} API is reachable. Server time: ${new Date(serverTime).toISOString()}`,
    };
  } catch (error) {
    return {
      success: false,
      message: "Unable to reach Binance API servers",
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

export async function authenticate(
  apiKey: string,
  apiSecret: string,
  isTestnet = true
): Promise<KotakNeoAuthResponse> {
  try {
    const client = new MainClient({
      api_key: apiKey,
      api_secret: apiSecret,
      ...(isTestnet ? { baseUrl: "https://testnet.binance.vision" } : {}),
    });

    const account = await client.getAccountInformation();

    const balances = (account.balances || [])
      .filter((b: { free: string; locked: string }) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
      .length;

    return {
      success: true,
      message: `Authenticated successfully. Account has ${balances} assets with balance.`,
      accessToken: apiKey,
      sessionId: isTestnet ? "testnet" : "production",
      baseUrl: isTestnet ? "https://testnet.binance.vision" : "https://api.binance.com",
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Authentication failed";
    const isInvalidKey = errMsg.includes("API-key") || errMsg.includes("-2015") || errMsg.includes("-2014");

    return {
      success: false,
      message: isInvalidKey ? "Invalid API Key or Secret" : "Authentication failed",
      error: errMsg,
    };
  }
}

export async function testBinanceConnectivity(apiKey: string, isTestnet = true): Promise<KotakNeoAuthResponse> {
  return testConnectivity(apiKey, undefined, isTestnet);
}

export async function authenticateBinance(credentials: {
  api_key: string;
  api_secret: string;
  is_testnet: boolean;
}): Promise<KotakNeoAuthResponse> {
  return authenticate(credentials.api_key, credentials.api_secret, credentials.is_testnet);
}

export async function getPositions(session: BinanceSession): Promise<ApiResponse<unknown[]>> {
  try {
    const client = createClient(session);
    const openOrders = await client.getOpenOrders();

    const positions = openOrders.map((order) => ({
      trading_symbol: order.symbol,
      exchange: "BINANCE",
      quantity: parseFloat(String(order.origQty)),
      buy_qty: order.side === "BUY" ? parseFloat(String(order.origQty)) : 0,
      sell_qty: order.side === "SELL" ? parseFloat(String(order.origQty)) : 0,
      buy_avg: order.side === "BUY" ? parseFloat(String(order.price)) : 0,
      sell_avg: order.side === "SELL" ? parseFloat(String(order.price)) : 0,
      buy_amt: order.side === "BUY" ? parseFloat(String(order.origQty)) * parseFloat(String(order.price)) : 0,
      sell_amt: order.side === "SELL" ? parseFloat(String(order.origQty)) * parseFloat(String(order.price)) : 0,
      pnl: 0,
      ltp: parseFloat(String(order.price)),
      product_type: String(order.type),
      token: String(order.orderId),
      order_side: order.side,
      status: order.status,
    }));

    return { success: true, data: positions };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Positions error";
    return {
      success: false,
      error: errMsg,
      sessionExpired: errMsg.includes("API-key") || errMsg.includes("-2015"),
    };
  }
}

export async function getOrderBook(session: BinanceSession): Promise<ApiResponse<unknown[]>> {
  try {
    const client = createClient(session);
    const allOrders = await client.getOpenOrders();

    const orders = allOrders.map((order) => ({
      order_id: String(order.orderId),
      trading_symbol: order.symbol,
      transaction_type: order.side,
      quantity: parseFloat(String(order.origQty)),
      price: parseFloat(String(order.price)),
      status: order.status,
      order_type: order.type,
      exchange: "BINANCE",
      timestamp: new Date(order.time).toISOString(),
      executed_qty: parseFloat(String(order.executedQty)),
      time_in_force: order.timeInForce,
    }));

    return { success: true, data: orders };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Order book error";
    return {
      success: false,
      error: errMsg,
      sessionExpired: errMsg.includes("API-key") || errMsg.includes("-2015"),
    };
  }
}

export async function getHoldings(session: BinanceSession): Promise<ApiResponse<unknown[]>> {
  try {
    const client = createClient(session);
    const account = await client.getAccountInformation();

    const holdings = (account.balances || [])
      .filter((b: { free: string; locked: string }) => {
        const free = parseFloat(b.free);
        const locked = parseFloat(b.locked);
        return free > 0 || locked > 0;
      })
      .map((b: { asset: string; free: string; locked: string }) => {
        const free = parseFloat(b.free);
        const locked = parseFloat(b.locked);
        const total = free + locked;

        return {
          trading_symbol: b.asset,
          quantity: total,
          free_qty: free,
          locked_qty: locked,
          average_price: 0,
          current_price: 0,
          invested_value: 0,
          current_value: 0,
          pnl: 0,
          pnl_percent: 0,
          today_pnl: 0,
          today_pnl_percent: 0,
        };
      });

    return { success: true, data: holdings };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Holdings error";
    return {
      success: false,
      error: errMsg,
      sessionExpired: errMsg.includes("API-key") || errMsg.includes("-2015"),
    };
  }
}

export async function placeOrder(
  session: BinanceSession,
  params: BinanceOrderParams
): Promise<ApiResponse<{ orderNo: string }>> {
  try {
    const client = createClient(session);

    const orderParams: Record<string, unknown> = {
      symbol: params.symbol,
      side: params.side as OrderSide,
      type: params.type as OrderType,
      quantity: params.quantity,
    };

    if (params.type !== "MARKET") {
      orderParams.price = params.price;
      orderParams.timeInForce = (params.timeInForce || "GTC") as OrderTimeInForce;
    }

    if (params.stopPrice) {
      orderParams.stopPrice = params.stopPrice;
    }

    const result = await client.submitNewOrder(orderParams as any);

    return {
      success: true,
      data: { orderNo: String(result.orderId) },
      message: `Order placed successfully. Order ID: ${result.orderId}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Order placement error",
    };
  }
}

export async function cancelOrder(
  session: BinanceSession,
  symbol: string,
  orderId: string
): Promise<ApiResponse> {
  try {
    const client = createClient(session);
    await client.cancelOrder({ symbol, orderId: parseInt(orderId) });

    return {
      success: true,
      message: `Order ${orderId} cancelled successfully`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Order cancellation error",
    };
  }
}

export async function getAccountBalance(session: BinanceSession): Promise<ApiResponse<unknown>> {
  try {
    const client = createClient(session);
    const account = await client.getAccountInformation();

    const nonZeroBalances = (account.balances || [])
      .filter((b: { free: string; locked: string }) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);

    let totalEstimatedValue = 0;
    for (const b of nonZeroBalances as { asset: string; free: string; locked: string }[]) {
      const total = parseFloat(b.free) + parseFloat(b.locked);
      if (b.asset === "USDT" || b.asset === "BUSD" || b.asset === "USDC") {
        totalEstimatedValue += total;
      }
    }

    return {
      success: true,
      data: {
        balances: nonZeroBalances,
        totalAssets: nonZeroBalances.length,
        estimatedUsdValue: totalEstimatedValue,
        canTrade: account.canTrade,
        canWithdraw: account.canWithdraw,
        canDeposit: account.canDeposit,
        accountType: account.accountType,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Account balance error",
    };
  }
}

export async function getTradeHistory(
  session: BinanceSession,
  symbol: string
): Promise<ApiResponse<unknown[]>> {
  try {
    const client = createClient(session);
    const trades = await client.getAccountTradeList({ symbol });

    return {
      success: true,
      data: trades.map((trade) => ({
        trade_id: String(trade.id),
        order_id: String(trade.orderId),
        symbol: trade.symbol,
        side: trade.isBuyer ? "BUY" : "SELL",
        price: parseFloat(String(trade.price)),
        quantity: parseFloat(String(trade.qty)),
        commission: parseFloat(String(trade.commission)),
        commission_asset: trade.commissionAsset,
        timestamp: new Date(trade.time).toISOString(),
        is_maker: trade.isMaker,
      })),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Trade history error",
    };
  }
}

export async function getTickerPrice(
  session: BinanceSession,
  symbol?: string
): Promise<ApiResponse<unknown>> {
  try {
    const client = createClient(session);

    if (symbol) {
      const ticker = await client.getSymbolPriceTicker({ symbol });
      return { success: true, data: ticker };
    }

    const tickers = await client.getSymbolPriceTicker();
    return { success: true, data: tickers };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Ticker price error",
    };
  }
}

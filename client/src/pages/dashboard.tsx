import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, TrendingDown, RefreshCw, Home, Wifi, WifiOff, Search, BarChart3 } from "lucide-react";
import { Link } from "wouter";
import type { Position, Order, Holding, PortfolioSummary, OrderParams } from "@shared/schema";

interface BrokerSessionStatus {
  isAuthenticated: boolean;
  broker: string | null;
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("positions");
  const [searchPositions, setSearchPositions] = useState("");
  const [searchHoldings, setSearchHoldings] = useState("");
  const [orderForm, setOrderForm] = useState<OrderParams>({
    exchange_segment: "nse_cm",
    product: "CNC",
    price: "",
    order_type: "L",
    quantity: "",
    validity: "DAY",
    trading_symbol: "",
    transaction_type: "B",
  });

  const { data: positions = [], isLoading: positionsLoading, refetch: refetchPositions } = useQuery<Position[]>({
    queryKey: ["/api/positions"],
  });

  const { data: orders = [], isLoading: ordersLoading, refetch: refetchOrders } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
  });

  const { data: holdings = [], isLoading: holdingsLoading, refetch: refetchHoldings } = useQuery<Holding[]>({
    queryKey: ["/api/holdings"],
  });

  const { data: portfolioSummary, isLoading: summaryLoading } = useQuery<PortfolioSummary>({
    queryKey: ["/api/portfolio-summary"],
  });

  const { data: sessionStatus } = useQuery<BrokerSessionStatus>({
    queryKey: ["/api/broker-session-status"],
    refetchInterval: 30000,
  });

  const isLiveData = sessionStatus?.isAuthenticated ?? false;

  const handleRefresh = () => {
    refetchPositions();
    refetchOrders();
    refetchHoldings();
  };

  const isLoading = positionsLoading || ordersLoading || holdingsLoading || summaryLoading;

  // Filter positions by search
  const filteredPositions = positions.filter(p => 
    p.trading_symbol.toLowerCase().includes(searchPositions.toLowerCase())
  );

  // Filter holdings by search
  const filteredHoldings = holdings.filter(h => 
    h.trading_symbol.toLowerCase().includes(searchHoldings.toLowerCase())
  );

  // Calculate position summaries - use API fields when available, otherwise compute
  const positionTotals = {
    totalPnL: positions.reduce((sum, p) => sum + (p.pnl || 0), 0),
    unrealisedPnL: positions.reduce((sum, p) => {
      // Use API-provided unrealised P/L if available, otherwise compute
      if (p.unrealised_pnl !== undefined) return sum + p.unrealised_pnl;
      return sum + ((p.ltp - p.buy_avg) * p.quantity);
    }, 0),
    realisedPnL: positions.reduce((sum, p) => sum + (p.realised_pnl || 0), 0),
    netTradedValue: positions.reduce((sum, p) => sum + (p.ltp * Math.abs(p.quantity)), 0),
  };

  // Calculate holdings summaries - use API values when available
  const holdingTotals = {
    totalPnL: holdings.reduce((sum, h) => sum + (h.pnl || 0), 0),
    investedValue: holdings.reduce((sum, h) => sum + (h.invested_value || h.average_price * h.quantity), 0),
    currentValue: holdings.reduce((sum, h) => sum + (h.current_value || h.current_price * h.quantity), 0),
    todayPnL: holdings.reduce((sum, h) => sum + (h.today_pnl || 0), 0),
  };
  
  // Calculate percentages
  // Overall P&L %: profit as percentage of invested value
  const pnlPercent = holdingTotals.investedValue > 0 
    ? ((holdingTotals.currentValue - holdingTotals.investedValue) / holdingTotals.investedValue) * 100 
    : 0;
  // Today's P&L %: today's change as percentage of previous day value (current - today's pnl)
  const prevDayValue = holdingTotals.currentValue - holdingTotals.todayPnL;
  const todayPnlPercent = prevDayValue > 0 
    ? (holdingTotals.todayPnL / prevDayValue) * 100
    : 0;

  const formatCurrency = (value: number) => {
    const absValue = Math.abs(value);
    if (absValue >= 100000) {
      return `${(value / 100000).toFixed(2)}L`;
    }
    return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  };

  const formatPnL = (value: number) => {
    const formatted = formatCurrency(Math.abs(value));
    return value >= 0 ? `+${formatted}` : `-${formatted}`;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3">
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-foreground" data-testid="text-dashboard-title">Trading Dashboard</h1>
              <Badge 
                variant={isLiveData ? "default" : "secondary"} 
                className="flex items-center gap-1"
                data-testid="badge-connection-status"
              >
                {isLiveData ? (
                  <>
                    <Wifi className="w-3 h-3" />
                    LIVE
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3 h-3" />
                    DEMO
                  </>
                )}
              </Badge>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Link href="/">
                <Button variant="outline" size="sm" data-testid="button-home">
                  <Home className="w-4 h-4 mr-2" />
                  Home
                </Button>
              </Link>
              <Button
                onClick={handleRefresh}
                variant="outline"
                size="sm"
                disabled={isLoading}
                data-testid="button-refresh"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-card border border-border h-12" data-testid="tabs-dashboard">
            <TabsTrigger value="investments" className="px-6 data-[state=active]:bg-primary/10" data-testid="tab-investments">
              INVESTMENTS <Badge variant="secondary" className="ml-2">{holdings.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="positions" className="px-6 data-[state=active]:bg-primary/10" data-testid="tab-positions">
              POSITIONS <Badge variant="secondary" className="ml-2">{positions.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="orders" className="px-6 data-[state=active]:bg-primary/10" data-testid="tab-orders">
              ORDERS <Badge variant="secondary" className="ml-2">{orders.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="place-order" className="px-6 data-[state=active]:bg-primary/10" data-testid="tab-place-order">
              PLACE ORDER
            </TabsTrigger>
          </TabsList>

          {/* INVESTMENTS Tab - Holdings - Kotak Neo Layout */}
          <TabsContent value="investments">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex justify-between items-start gap-4 flex-wrap">
                  {/* Summary cards matching Kotak Neo: Current value, Total invested, Profit/Loss, Today's profit/loss */}
                  <div className="flex gap-8 flex-wrap">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Current value</p>
                      <p className="text-lg font-semibold text-foreground" data-testid="text-current-value">
                        {formatCurrency(holdingTotals.currentValue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Total invested</p>
                      <p className="text-lg font-semibold text-foreground" data-testid="text-invested-value">
                        {formatCurrency(holdingTotals.investedValue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Profit/Loss</p>
                      <p className={`text-lg font-semibold ${holdingTotals.totalPnL >= 0 ? "text-primary" : "text-destructive"}`} data-testid="text-holdings-pnl">
                        {formatPnL(holdingTotals.totalPnL)} ({pnlPercent >= 0 ? "+" : ""}{pnlPercent.toFixed(2)}%)
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Today's profit/loss</p>
                      <p className={`text-lg font-semibold ${holdingTotals.todayPnL >= 0 ? "text-primary" : "text-destructive"}`} data-testid="text-today-pnl">
                        {formatPnL(holdingTotals.todayPnL)} ({todayPnlPercent >= 0 ? "+" : ""}{todayPnlPercent.toFixed(2)}%)
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search in stocks"
                        value={searchHoldings}
                        onChange={(e) => setSearchHoldings(e.target.value)}
                        className="pl-9 w-60"
                        data-testid="input-search-holdings"
                      />
                    </div>
                    <Button variant="outline" size="icon" data-testid="button-analyze-holdings">
                      <BarChart3 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {filteredHoldings.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8" data-testid="text-no-holdings">No holdings found</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Avg cost</TableHead>
                        <TableHead className="text-right">LTP</TableHead>
                        <TableHead className="text-right">Current value</TableHead>
                        <TableHead className="text-right">Invested</TableHead>
                        <TableHead className="text-right">Profit/loss (%)</TableHead>
                        <TableHead className="text-right">Today's P/L (%)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredHoldings.map((holding, index) => (
                        <TableRow key={index} data-testid={`row-holding-${index}`}>
                          <TableCell>
                            <div className="font-medium" data-testid={`text-holding-symbol-${index}`}>{holding.trading_symbol}</div>
                          </TableCell>
                          <TableCell className="text-right">{holding.quantity}</TableCell>
                          <TableCell className="text-right">{holding.average_price.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{holding.current_price.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            {(holding.current_value || holding.current_price * holding.quantity).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                          </TableCell>
                          <TableCell className="text-right">
                            {(holding.invested_value || holding.average_price * holding.quantity).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                          </TableCell>
                          <TableCell className={`text-right font-medium ${holding.pnl >= 0 ? "text-primary" : "text-destructive"}`}>
                            {holding.pnl >= 0 ? "+" : ""}{holding.pnl.toFixed(0)} ({holding.pnl_percent >= 0 ? "+" : ""}{holding.pnl_percent.toFixed(2)}%)
                          </TableCell>
                          <TableCell className={`text-right font-medium ${(holding.today_pnl || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                            {(holding.today_pnl || 0) >= 0 ? "+" : ""}{(holding.today_pnl || 0).toFixed(0)} ({(holding.today_pnl_percent || 0) >= 0 ? "+" : ""}{(holding.today_pnl_percent || 0).toFixed(2)}%)
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* POSITIONS Tab */}
          <TabsContent value="positions">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex justify-between items-start gap-4 flex-wrap">
                  <div className="flex gap-8 flex-wrap">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Profit/Loss</p>
                      <p className={`text-lg font-semibold ${positionTotals.totalPnL >= 0 ? "text-primary" : "text-destructive"}`} data-testid="text-position-pnl">
                        {formatPnL(positionTotals.totalPnL)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Unrealised P/L</p>
                      <p className={`text-lg font-semibold ${positionTotals.unrealisedPnL >= 0 ? "text-primary" : "text-destructive"}`} data-testid="text-unrealised-pnl">
                        {formatPnL(positionTotals.unrealisedPnL)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Realised P/L</p>
                      <p className={`text-lg font-semibold ${positionTotals.realisedPnL >= 0 ? "text-primary" : "text-destructive"}`} data-testid="text-realised-pnl">
                        {formatPnL(positionTotals.realisedPnL)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Net traded value</p>
                      <p className="text-lg font-semibold text-primary" data-testid="text-net-traded-value">
                        +{formatCurrency(positionTotals.netTradedValue)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search in positions"
                        value={searchPositions}
                        onChange={(e) => setSearchPositions(e.target.value)}
                        className="pl-9 w-60"
                        data-testid="input-search-positions"
                      />
                    </div>
                    <Button variant="outline" size="icon" data-testid="button-analyze">
                      <BarChart3 className="w-4 h-4" />
                    </Button>
                    </div>
                </div>
              </CardHeader>
              <CardContent>
                {filteredPositions.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8" data-testid="text-no-positions">No open positions</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Avg.cost</TableHead>
                        <TableHead>LTP</TableHead>
                        <TableHead className="text-right">Profit/loss</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPositions.map((position, index) => (
                        <TableRow key={index} data-testid={`row-position-${index}`}>
                          <TableCell>
                            <div className="font-medium" data-testid={`text-position-symbol-${index}`}>
                              {position.trading_symbol}
                              {position.option_type && (
                                <Badge variant="outline" className="ml-2 text-xs" data-testid={`badge-option-${index}`}>
                                  {position.strike_price} {position.option_type} {position.expiry}
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">{position.exchange}</div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm" data-testid={`text-product-type-${index}`}>{position.product_type || "NRML"}</span>
                          </TableCell>
                          <TableCell>
                            <div>{Math.abs(position.quantity)}</div>
                            <div className="text-xs text-muted-foreground">shares</div>
                          </TableCell>
                          <TableCell>{position.buy_avg.toFixed(2)}</TableCell>
                          <TableCell>{position.ltp.toFixed(2)}</TableCell>
                          <TableCell className={`text-right font-medium ${position.pnl >= 0 ? "text-primary" : "text-destructive"}`}>
                            {position.pnl >= 0 ? "+" : ""}{position.pnl.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ORDERS Tab */}
          <TabsContent value="orders">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Order Book</CardTitle>
              </CardHeader>
              <CardContent>
                {orders.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8" data-testid="text-no-orders">No orders found</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Symbol</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((order) => (
                        <TableRow key={order.order_id} data-testid={`row-order-${order.order_id}`}>
                          <TableCell>
                            <div className="font-medium">{order.trading_symbol}</div>
                            <div className="text-xs text-muted-foreground">{order.exchange}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={order.transaction_type === "B" ? "default" : "destructive"}>
                              {order.transaction_type === "B" ? "BUY" : "SELL"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{order.order_type}</TableCell>
                          <TableCell>{order.quantity}</TableCell>
                          <TableCell>{order.price.toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge 
                              variant={order.status === "COMPLETE" ? "default" : order.status === "CANCELLED" ? "destructive" : "secondary"}
                            >
                              {order.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{order.timestamp}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* PLACE ORDER Tab */}
          <TabsContent value="place-order">
            <Card>
              <CardHeader>
                <CardTitle>Place New Order</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label>Trading Symbol</Label>
                    <Input
                      value={orderForm.trading_symbol}
                      onChange={(e) => setOrderForm({ ...orderForm, trading_symbol: e.target.value })}
                      placeholder="e.g., RELIANCE"
                      data-testid="input-trading-symbol"
                    />
                  </div>

                  <div>
                    <Label>Exchange</Label>
                    <Select
                      value={orderForm.exchange_segment}
                      onValueChange={(value) => setOrderForm({ ...orderForm, exchange_segment: value })}
                    >
                      <SelectTrigger data-testid="select-exchange">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nse_cm">NSE Cash</SelectItem>
                        <SelectItem value="bse_cm">BSE Cash</SelectItem>
                        <SelectItem value="nse_fo">NSE F&O</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Transaction Type</Label>
                    <Select
                      value={orderForm.transaction_type}
                      onValueChange={(value) => setOrderForm({ ...orderForm, transaction_type: value })}
                    >
                      <SelectTrigger data-testid="select-transaction-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="B">Buy</SelectItem>
                        <SelectItem value="S">Sell</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Product Type</Label>
                    <Select
                      value={orderForm.product}
                      onValueChange={(value) => setOrderForm({ ...orderForm, product: value })}
                    >
                      <SelectTrigger data-testid="select-product">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CNC">CNC (Delivery)</SelectItem>
                        <SelectItem value="MIS">MIS (Intraday)</SelectItem>
                        <SelectItem value="NRML">NRML (Normal)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Order Type</Label>
                    <Select
                      value={orderForm.order_type}
                      onValueChange={(value) => setOrderForm({ ...orderForm, order_type: value })}
                    >
                      <SelectTrigger data-testid="select-order-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="L">Limit</SelectItem>
                        <SelectItem value="MKT">Market</SelectItem>
                        <SelectItem value="SL">Stop Loss</SelectItem>
                        <SelectItem value="SL-M">Stop Loss Market</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Validity</Label>
                    <Select
                      value={orderForm.validity}
                      onValueChange={(value) => setOrderForm({ ...orderForm, validity: value })}
                    >
                      <SelectTrigger data-testid="select-validity">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DAY">Day</SelectItem>
                        <SelectItem value="IOC">Immediate or Cancel</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      value={orderForm.quantity}
                      onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })}
                      placeholder="Enter quantity"
                      data-testid="input-quantity"
                    />
                  </div>

                  <div>
                    <Label>Price</Label>
                    <Input
                      type="number"
                      value={orderForm.price}
                      onChange={(e) => setOrderForm({ ...orderForm, price: e.target.value })}
                      placeholder="Enter price"
                      disabled={orderForm.order_type === "MKT"}
                      data-testid="input-price"
                    />
                  </div>
                </div>

                <Button
                  className="w-full"
                  disabled={!orderForm.trading_symbol || !orderForm.quantity}
                  data-testid="button-place-order"
                >
                  Place {orderForm.transaction_type === "B" ? "Buy" : "Sell"} Order
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

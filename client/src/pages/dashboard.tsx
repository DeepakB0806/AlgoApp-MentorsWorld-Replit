import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TrendingUp, TrendingDown, RefreshCw, Home, Wifi, WifiOff, Search, BarChart3, Activity, Play, Pause, Square, Power, Rocket, Loader2, Clock } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Position, Order, Holding, PortfolioSummary, StrategyPlan, StrategyConfig, BrokerConfig, StrategyTrade } from "@shared/schema";
import { Target } from "lucide-react";

interface BrokerSessionStatus {
  isAuthenticated: boolean;
  broker: string | null;
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("positions");
  const [searchPositions, setSearchPositions] = useState("");
  const [searchHoldings, setSearchHoldings] = useState("");

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
            <TabsTrigger value="live-trades" className="px-6 data-[state=active]:bg-primary/10" data-testid="tab-live-trades">
              LIVE TRADES <Badge variant="secondary" className="ml-2"><Activity className="w-3 h-3" /></Badge>
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

          <TabsContent value="live-trades">
            <LiveTradesPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

const DEPLOY_STATUS_MAP: Record<string, { label: string; color: string; icon: typeof Activity }> = {
  draft: { label: "Draft", color: "text-muted-foreground", icon: Clock },
  deployed: { label: "Deployed", color: "text-blue-400", icon: Rocket },
  active: { label: "Active", color: "text-emerald-400", icon: Play },
  paused: { label: "Paused", color: "text-amber-400", icon: Pause },
  squared_off: { label: "Squared Off", color: "text-red-400", icon: Square },
  closed: { label: "Closed", color: "text-muted-foreground", icon: Power },
};

function DashboardTradeCard({ plan, configs, brokerConfigs }: { plan: StrategyPlan; configs: StrategyConfig[]; brokerConfigs: BrokerConfig[] }) {
  const depStatus = plan.deploymentStatus || "draft";
  const depConfig = DEPLOY_STATUS_MAP[depStatus] || DEPLOY_STATUS_MAP.draft;
  const DepIcon = depConfig.icon;

  const { data: trades = [], isLoading: tradesLoading, refetch } = useQuery<StrategyTrade[]>({
    queryKey: ["/api/strategy-trades", plan.id],
    queryFn: async () => {
      const resp = await fetch(`/api/strategy-trades/${plan.id}`);
      if (!resp.ok) throw new Error("Failed to fetch");
      return resp.json();
    },
    refetchInterval: depStatus === "active" ? 30000 : false,
  });

  const totalPnl = trades.reduce((s, t) => s + (t.pnl || 0), 0);
  const openCount = trades.filter((t) => t.status === "open" || t.status === "pending").length;
  const closedCount = trades.filter((t) => t.status === "closed" || t.status === "squared_off").length;

  const getConfigName = (configId: string) => configs.find((c) => c.id === configId)?.name || "Unknown";
  const getBrokerName = (bId: string | null) => {
    if (!bId) return "None";
    const bc = brokerConfigs.find((b) => b.id === bId);
    return bc?.name || bc?.brokerName || "Unknown";
  };

  return (
    <Card data-testid={`card-live-trade-${plan.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-sm" data-testid={`text-live-trade-name-${plan.id}`}>{plan.name}</CardTitle>
            <Badge variant="outline" className={`text-xs ${depConfig.color}`}>
              <DepIcon className="w-3 h-3 mr-1" />
              {depConfig.label}
            </Badge>
            {plan.exchange && <Badge variant="secondary" className="text-xs font-mono">{plan.exchange}</Badge>}
            {plan.ticker && <Badge variant="secondary" className="text-xs font-mono">{plan.ticker}</Badge>}
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={tradesLoading} data-testid={`button-refresh-trade-${plan.id}`}>
            <RefreshCw className={`w-3 h-3 ${tradesLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <span>Config: {getConfigName(plan.configId)}</span>
          <span>Broker: {getBrokerName(plan.brokerConfigId)}</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card border border-border rounded-md p-2 text-center">
            <p className="text-xs text-muted-foreground">total p&l</p>
            <p className={`text-sm font-bold font-mono ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}
            </p>
          </div>
          <div className="bg-card border border-border rounded-md p-2 text-center">
            <p className="text-xs text-muted-foreground">open</p>
            <p className="text-sm font-bold font-mono">{openCount}</p>
          </div>
          <div className="bg-card border border-border rounded-md p-2 text-center">
            <p className="text-xs text-muted-foreground">closed</p>
            <p className="text-sm font-bold font-mono">{closedCount}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LiveTradesPanel() {
  const { toast } = useToast();

  const { data: plans = [] } = useQuery<StrategyPlan[]>({
    queryKey: ["/api/strategy-plans"],
  });

  const { data: configs = [] } = useQuery<StrategyConfig[]>({
    queryKey: ["/api/strategy-configs"],
  });

  const { data: brokerConfigs = [] } = useQuery<BrokerConfig[]>({
    queryKey: ["/api/broker-configs"],
  });

  const deployedPlans = plans.filter((p) => p.deploymentStatus && p.deploymentStatus !== "draft" && p.brokerConfigId);
  const [confirmAction, setConfirmAction] = useState<{ planId: string; action: string } | null>(null);

  const deploymentMutation = useMutation({
    mutationFn: async ({ id, deploymentStatus }: { id: string; deploymentStatus: string }) => {
      return apiRequest("PATCH", `/api/strategy-plans/${id}/deployment`, { deploymentStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-plans"] });
      setConfirmAction(null);
      toast({ title: "Strategy deployment status updated" });
    },
    onError: () => {
      toast({ title: "Failed to update deployment status", variant: "destructive" });
    },
  });

  const getActions = (status: string): { action: string; label: string; icon: typeof Play; variant: "default" | "outline" | "destructive" }[] => {
    switch (status) {
      case "deployed":
        return [
          { action: "active", label: "Activate", icon: Play, variant: "default" },
          { action: "closed", label: "Close", icon: Power, variant: "destructive" },
        ];
      case "active":
        return [
          { action: "paused", label: "Pause", icon: Pause, variant: "outline" },
          { action: "squared_off", label: "Square Off", icon: Square, variant: "destructive" },
        ];
      case "paused":
        return [
          { action: "active", label: "Resume", icon: Play, variant: "default" },
          { action: "squared_off", label: "Square Off", icon: Square, variant: "destructive" },
        ];
      case "squared_off":
        return [
          { action: "active", label: "Reactivate", icon: Play, variant: "default" },
          { action: "closed", label: "Close", icon: Power, variant: "destructive" },
        ];
      default:
        return [];
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-emerald-400" />
              <CardTitle data-testid="text-live-trades-title">Live Trades</CardTitle>
              <Badge variant="secondary">{deployedPlans.length} strategies</Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      {deployedPlans.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Live Trades</h3>
            <p className="text-muted-foreground">Deploy strategies from the Strategy page to see live trades here</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {deployedPlans.map((plan) => {
            const depStatus = plan.deploymentStatus || "draft";
            const actions = getActions(depStatus);
            return (
              <div key={plan.id} className="space-y-2">
                <DashboardTradeCard plan={plan} configs={configs} brokerConfigs={brokerConfigs} />
                {actions.length > 0 && (
                  <div className="flex items-center gap-2 pl-4 flex-wrap">
                    {actions.map((a) => {
                      const ActionIcon = a.icon;
                      return (
                        <Button
                          key={a.action}
                          variant={a.variant}
                          size="sm"
                          onClick={() => setConfirmAction({ planId: plan.id, action: a.action })}
                          disabled={deploymentMutation.isPending}
                          data-testid={`button-dash-${a.action}-${plan.id}`}
                        >
                          <ActionIcon className="w-3 h-3 mr-1" />
                          {a.label}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent aria-describedby="dash-deployment-confirm-desc">
          <DialogHeader>
            <DialogTitle>Confirm Action</DialogTitle>
            <DialogDescription id="dash-deployment-confirm-desc">Confirm the strategy control action below.</DialogDescription>
          </DialogHeader>
          {confirmAction && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {confirmAction.action === "active" && "Activate this strategy? It will begin executing trades."}
                {confirmAction.action === "paused" && "Pause this strategy? Open positions will remain, no new trades."}
                {confirmAction.action === "squared_off" && "Square off all positions for this strategy?"}
                {confirmAction.action === "closed" && "Close this strategy deployment?"}
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setConfirmAction(null)} data-testid="button-cancel-dash-action">Cancel</Button>
                <Button
                  variant={confirmAction.action === "squared_off" || confirmAction.action === "closed" ? "destructive" : "default"}
                  onClick={() => {
                    if (confirmAction) deploymentMutation.mutate({ id: confirmAction.planId, deploymentStatus: confirmAction.action });
                  }}
                  disabled={deploymentMutation.isPending}
                  data-testid="button-confirm-dash-action"
                >
                  {deploymentMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Confirm
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

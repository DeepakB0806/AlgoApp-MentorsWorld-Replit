import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, TrendingDown, RefreshCw, Home, Wifi, WifiOff, Search, BarChart3, Activity, Play, Pause, Square, Power, Rocket, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "wouter";
import { queryClient } from "@/lib/queryClient";

import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
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

  const { data: portfolioSummary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery<PortfolioSummary>({
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
    refetchSummary();
  };

  const isLoading = positionsLoading || ordersLoading || holdingsLoading || summaryLoading;

  // F&O detection
  const isFnO = (exchange: string) => {
    const ex = (exchange || "").toLowerCase();
    return ex.includes("nse_fo") || ex.includes("bse_fo") || ex === "nfo" || ex === "bfo";
  };

  // Split positions into equity and F&O
  const equityPositions = positions.filter(p => !isFnO(p.exchange || ""));
  const nfoPositions = positions.filter(p => isFnO(p.exchange || ""));

  // Filter by search
  const filteredPositions = equityPositions.filter(p =>
    (p.trading_symbol || "").toLowerCase().includes(searchPositions.toLowerCase())
  );
  const filteredNfoPositions = nfoPositions.filter(p =>
    (p.trading_symbol || "").toLowerCase().includes(searchPositions.toLowerCase())
  );

  // Filter holdings by search
  const filteredHoldings = holdings.filter(h => 
    (h.trading_symbol || "").toLowerCase().includes(searchHoldings.toLowerCase())
  );

  // Calculate position summaries - use API fields when available, otherwise compute
  const positionTotals = {
    totalPnL: positions.reduce((sum, p) => sum + Number(p.pnl || 0), 0),
    unrealisedPnL: positions.reduce((sum, p) => {
      if (p.unrealised_pnl !== undefined) return sum + Number(p.unrealised_pnl);
      return sum + ((Number(p.ltp || 0) - Number(p.buy_avg || 0)) * Number(p.quantity || 0));
    }, 0),
    realisedPnL: positions.reduce((sum, p) => sum + Number(p.realised_pnl || 0), 0),
    netTradedValue: positions.reduce((sum, p) => sum + (Number(p.ltp || 0) * Math.abs(Number(p.quantity || 0))), 0),
  };

  // Calculate holdings summaries - use API values when available
  const holdingTotals = {
    totalPnL: holdings.reduce((sum, h) => sum + Number(h.pnl || 0), 0),
    investedValue: holdings.reduce((sum, h) => sum + Number(h.invested_value || (Number(h.average_price || 0) * Number(h.quantity || 0))), 0),
    currentValue: holdings.reduce((sum, h) => sum + Number(h.current_value || (Number(h.current_price || 0) * Number(h.quantity || 0))), 0),
    todayPnL: holdings.reduce((sum, h) => sum + Number(h.today_pnl || 0), 0),
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
          <div className="mt-2">
            <PageBreadcrumbs items={[{ label: "Dashboard" }]} />
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
              POSITIONS <Badge variant="secondary" className="ml-2">{equityPositions.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="nfo-pos" className="px-6 data-[state=active]:bg-primary/10" data-testid="tab-nfo-pos">
              NFO POS <Badge variant="secondary" className="ml-2">{nfoPositions.length}</Badge>
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
                  <div className="overflow-x-auto">
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
                        <TableHead className="text-right">Prev Close</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredHoldings.map((holding, index) => (
                        <TableRow key={index} data-testid={`row-holding-${index}`}>
                          <TableCell>
                            <div className="font-medium" data-testid={`text-holding-symbol-${index}`}>{holding.trading_symbol}</div>
                          </TableCell>
                          <TableCell className="text-right">{holding.quantity}</TableCell>
                          <TableCell className="text-right">{Number(holding.average_price || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right">{Number(holding.current_price || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            {(Number(holding.current_value) || Number(holding.current_price || 0) * Number(holding.quantity || 0)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                          </TableCell>
                          <TableCell className="text-right">
                            {(Number(holding.invested_value) || Number(holding.average_price || 0) * Number(holding.quantity || 0)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                          </TableCell>
                          <TableCell className={`text-right font-medium ${Number(holding.pnl || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                            {Number(holding.pnl || 0) >= 0 ? "+" : ""}{Number(holding.pnl || 0).toFixed(0)} ({Number(holding.pnl_percent || 0) >= 0 ? "+" : ""}{Number(holding.pnl_percent || 0).toFixed(2)}%)
                          </TableCell>
                          <TableCell className={`text-right font-medium ${Number(holding.today_pnl || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                            {Number(holding.today_pnl || 0) >= 0 ? "+" : ""}{Number(holding.today_pnl || 0).toFixed(0)} ({Number(holding.today_pnl_percent || 0) >= 0 ? "+" : ""}{Number(holding.today_pnl_percent || 0).toFixed(2)}%)
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {Number(holding.prev_close || 0) > 0 ? Number(holding.prev_close || 0).toFixed(2) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* POSITIONS Tab — Equity / non-F&O only */}
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
                        placeholder="Search positions"
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
                  <p className="text-muted-foreground text-center py-8" data-testid="text-no-positions">No equity positions</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Symbol</TableHead>
                          <TableHead>Exchange</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Buy Avg</TableHead>
                          <TableHead className="text-right">Sell Avg</TableHead>
                          <TableHead className="text-right">LTP</TableHead>
                          <TableHead className="text-right">P&L</TableHead>
                          <TableHead className="text-right">P&L Realz</TableHead>
                          <TableHead className="text-right">P&L URealz</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPositions.map((position, index) => {
                          const unrealisedPnl = Number(position.unrealised_pnl ?? ((Number(position.ltp || 0) - Number(position.buy_avg || 0)) * Number(position.quantity || 0)));
                          return (
                            <TableRow key={index} data-testid={`row-position-${index}`}>
                              <TableCell>
                                <div className="font-medium text-sm" data-testid={`text-position-symbol-${index}`}>{position.trading_symbol}</div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs" data-testid={`badge-exchange-${index}`}>{position.exchange}</Badge>
                              </TableCell>
                              <TableCell>
                                <span className="text-sm">{position.product_type || "NRML"}</span>
                              </TableCell>
                              <TableCell className="text-right">{Math.abs(Number(position.quantity || 0))}</TableCell>
                              <TableCell className="text-right">{Number(position.buy_avg || 0).toFixed(2)}</TableCell>
                              <TableCell className="text-right">{Number(position.sell_avg || 0).toFixed(2)}</TableCell>
                              <TableCell className="text-right">{Number(position.ltp || 0).toFixed(2)}</TableCell>
                              <TableCell className={`text-right font-medium ${Number(position.pnl || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                                {Number(position.pnl || 0) >= 0 ? "+" : ""}{Number(position.pnl || 0).toFixed(2)}
                              </TableCell>
                              <TableCell className={`text-right text-xs ${Number(position.realised_pnl || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                                {Number(position.realised_pnl || 0) >= 0 ? "+" : ""}{Number(position.realised_pnl || 0).toFixed(2)}
                              </TableCell>
                              <TableCell className={`text-right text-xs ${unrealisedPnl >= 0 ? "text-primary" : "text-destructive"}`}>
                                {unrealisedPnl >= 0 ? "+" : ""}{unrealisedPnl.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* NFO POS Tab — F&O positions only */}
          <TabsContent value="nfo-pos">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex justify-between items-start gap-4 flex-wrap">
                  <div className="flex gap-8 flex-wrap">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">F&O P&L</p>
                      <p className={`text-lg font-semibold ${nfoPositions.reduce((s, p) => s + Number(p.pnl || 0), 0) >= 0 ? "text-primary" : "text-destructive"}`} data-testid="text-nfo-pnl">
                        {formatPnL(nfoPositions.reduce((s, p) => s + Number(p.pnl || 0), 0))}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Realised</p>
                      <p className={`text-lg font-semibold ${nfoPositions.reduce((s, p) => s + Number(p.realised_pnl || 0), 0) >= 0 ? "text-primary" : "text-destructive"}`} data-testid="text-nfo-realised">
                        {formatPnL(nfoPositions.reduce((s, p) => s + Number(p.realised_pnl || 0), 0))}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Unrealised</p>
                      <p className={`text-lg font-semibold ${nfoPositions.reduce((s, p) => s + (p.unrealised_pnl !== undefined ? Number(p.unrealised_pnl) : (Number(p.ltp || 0) - Number(p.buy_avg || 0)) * Number(p.quantity || 0)), 0) >= 0 ? "text-primary" : "text-destructive"}`} data-testid="text-nfo-unrealised">
                        {formatPnL(nfoPositions.reduce((s, p) => s + (p.unrealised_pnl !== undefined ? Number(p.unrealised_pnl) : (Number(p.ltp || 0) - Number(p.buy_avg || 0)) * Number(p.quantity || 0)), 0))}
                      </p>
                    </div>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search NFO positions"
                      value={searchPositions}
                      onChange={(e) => setSearchPositions(e.target.value)}
                      className="pl-9 w-60"
                      data-testid="input-search-nfo"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {filteredNfoPositions.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8" data-testid="text-no-nfo-positions">No F&O positions</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Order ID</TableHead>
                          <TableHead>Symbol</TableHead>
                          <TableHead>Exchange</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Strike</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead>Option</TableHead>
                          <TableHead>Expiry</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Buy Avg</TableHead>
                          <TableHead className="text-right">Sell Avg</TableHead>
                          <TableHead className="text-right">LTP</TableHead>
                          <TableHead className="text-right">P&L</TableHead>
                          <TableHead className="text-right">P&L Realz</TableHead>
                          <TableHead className="text-right">P&L URealz</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredNfoPositions.map((position, index) => {
                          const unrealisedPnl = Number(position.unrealised_pnl ?? ((Number(position.ltp || 0) - Number(position.buy_avg || 0)) * Number(position.quantity || 0)));
                          const instType = (position as any).instrument_type || "";
                          const token = (position as any).token || "";
                          return (
                            <TableRow key={index} data-testid={`row-nfo-${index}`}>
                              <TableCell>
                                <code className="text-xs text-muted-foreground font-mono" data-testid={`text-nfo-token-${index}`}>{token || "—"}</code>
                              </TableCell>
                              <TableCell>
                                <div className="font-medium text-sm" data-testid={`text-nfo-symbol-${index}`}>{position.trading_symbol}</div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs text-violet-400 border-violet-400/50" data-testid={`badge-nfo-exchange-${index}`}>{position.exchange}</Badge>
                              </TableCell>
                              <TableCell>
                                <span className="text-xs font-mono">{instType || "—"}</span>
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {position.strike_price || "—"}
                              </TableCell>
                              <TableCell>
                                <span className="text-xs">{position.product_type || "NRML"}</span>
                              </TableCell>
                              <TableCell>
                                {position.option_type ? (
                                  <Badge variant="outline" className={`text-xs ${position.option_type === "CE" ? "text-emerald-400 border-emerald-400/50" : "text-red-400 border-red-400/50"}`} data-testid={`badge-nfo-option-${index}`}>
                                    {position.option_type}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <span className="text-xs">{position.expiry || "—"}</span>
                              </TableCell>
                              <TableCell className="text-right">{Math.abs(Number(position.quantity || 0))}</TableCell>
                              <TableCell className="text-right">{Number(position.buy_avg || 0).toFixed(2)}</TableCell>
                              <TableCell className="text-right">{Number(position.sell_avg || 0).toFixed(2)}</TableCell>
                              <TableCell className="text-right">{Number(position.ltp || 0).toFixed(2)}</TableCell>
                              <TableCell className={`text-right font-medium ${Number(position.pnl || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                                {Number(position.pnl || 0) >= 0 ? "+" : ""}{Number(position.pnl || 0).toFixed(2)}
                              </TableCell>
                              <TableCell className={`text-right text-xs ${Number(position.realised_pnl || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                                {Number(position.realised_pnl || 0) >= 0 ? "+" : ""}{Number(position.realised_pnl || 0).toFixed(2)}
                              </TableCell>
                              <TableCell className={`text-right text-xs ${unrealisedPnl >= 0 ? "text-primary" : "text-destructive"}`}>
                                {unrealisedPnl >= 0 ? "+" : ""}{unrealisedPnl.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
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
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Order ID</TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Exchange</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((order) => (
                        <TableRow key={order.order_id} data-testid={`row-order-${order.order_id}`}>
                          <TableCell>
                            <code className="text-xs text-muted-foreground font-mono" data-testid={`text-order-id-${order.order_id}`}>{order.order_id}</code>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{order.trading_symbol}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{order.exchange}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={order.transaction_type === "B" ? "default" : "destructive"}>
                              {order.transaction_type === "B" ? "BUY" : "SELL"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{order.order_type}</TableCell>
                          <TableCell className="text-right">{order.quantity}</TableCell>
                          <TableCell className="text-right">{Number(order.price || 0).toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge
                              variant={order.status === "COMPLETE" ? "default" : (order.status === "CANCELLED" || order.status === "REJECTED") ? "destructive" : "secondary"}
                              data-testid={`status-order-${order.order_id}`}
                            >
                              {order.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate" data-testid={`text-rejection-reason-${order.order_id}`}>
                            {order.rejection_reason || ""}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{order.timestamp}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="live-trades">
            <LiveTradesPanel nfoPositions={nfoPositions} />
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

function DashboardTradeCard({ plan, configs, brokerConfigs, nfoPositions }: { plan: StrategyPlan; configs: StrategyConfig[]; brokerConfigs: BrokerConfig[]; nfoPositions: Position[] }) {
  const depStatus = plan.deploymentStatus || "draft";
  const depConfig = DEPLOY_STATUS_MAP[depStatus] || DEPLOY_STATUS_MAP.draft;
  const DepIcon = depConfig.icon;
  const [tableCollapsed, setTableCollapsed] = useState(false);

  const { data: trades = [], isLoading: tradesLoading, refetch } = useQuery<StrategyTrade[]>({
    queryKey: ["/api/strategy-trades", plan.id],
    queryFn: async () => {
      const resp = await fetch(`/api/strategy-trades/${plan.id}`);
      if (!resp.ok) throw new Error("Failed to fetch");
      return resp.json();
    },
    refetchInterval: depStatus === "active" ? 30000 : false,
  });

  const strategySymbols = new Set(trades.map((t) => t.tradingSymbol).filter(Boolean));
  const strategyPositions = nfoPositions.filter((p) => strategySymbols.has(p.trading_symbol || ""));

  const totalPnl = strategyPositions.reduce((s, p) => s + Number(p.pnl || 0), 0);
  const openCount = strategyPositions.filter((p) => Number(p.quantity || 0) !== 0).length;
  const closedCount = strategyPositions.filter((p) => Number(p.quantity || 0) === 0).length;

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
            <span className="text-xs text-muted-foreground">Config: {getConfigName(plan.configId)}</span>
            <span className="text-xs text-muted-foreground">Broker: {getBrokerName(plan.brokerConfigId)}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-bold font-mono ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              P&L: {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}
            </span>
            <Badge variant="secondary" className="text-xs">Open: {openCount}</Badge>
            <Badge variant="secondary" className="text-xs">Closed: {closedCount}</Badge>
            <Button variant="ghost" size="sm" onClick={() => setTableCollapsed(!tableCollapsed)} data-testid={`button-toggle-table-${plan.id}`}>
              {tableCollapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={tradesLoading} data-testid={`button-refresh-trade-${plan.id}`}>
              <RefreshCw className={`w-3 h-3 ${tradesLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      {!tableCollapsed && (
      <CardContent className="pt-0">
        {tradesLoading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
        ) : strategyPositions.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No positions for this strategy</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Order ID</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Exchange</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Strike</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Option</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Buy Avg</TableHead>
                  <TableHead className="text-right">Sell Avg</TableHead>
                  <TableHead className="text-right">LTP</TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                  <TableHead className="text-right">P&L Realz</TableHead>
                  <TableHead className="text-right">P&L URealz</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {strategyPositions.map((position, index) => {
                  const unrealisedPnl = Number(position.unrealised_pnl ?? ((Number(position.ltp || 0) - Number(position.buy_avg || 0)) * Number(position.quantity || 0)));
                  const instType = (position as any).instrument_type || "";
                  const token = (position as any).token || "";
                  return (
                    <TableRow key={index} data-testid={`row-live-trade-${plan.id}-${index}`}>
                      <TableCell>
                        <code className="text-xs text-muted-foreground font-mono">{token || "—"}</code>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{position.trading_symbol}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs text-violet-400 border-violet-400/50">{position.exchange}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs font-mono">{instType || "—"}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {position.strike_price || "—"}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs">{position.product_type || "NRML"}</span>
                      </TableCell>
                      <TableCell>
                        {position.option_type ? (
                          <Badge variant="outline" className={`text-xs ${position.option_type === "CE" ? "text-emerald-400 border-emerald-400/50" : "text-red-400 border-red-400/50"}`}>
                            {position.option_type}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs">{position.expiry || "—"}</span>
                      </TableCell>
                      <TableCell className="text-right">{Math.abs(Number(position.quantity || 0))}</TableCell>
                      <TableCell className="text-right">{Number(position.buy_avg || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{Number(position.sell_avg || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{Number(position.ltp || 0).toFixed(2)}</TableCell>
                      <TableCell className={`text-right font-medium ${Number(position.pnl || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                        {Number(position.pnl || 0) >= 0 ? "+" : ""}{Number(position.pnl || 0).toFixed(2)}
                      </TableCell>
                      <TableCell className={`text-right text-xs ${Number(position.realised_pnl || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                        {Number(position.realised_pnl || 0) >= 0 ? "+" : ""}{Number(position.realised_pnl || 0).toFixed(2)}
                      </TableCell>
                      <TableCell className={`text-right text-xs ${unrealisedPnl >= 0 ? "text-primary" : "text-destructive"}`}>
                        {unrealisedPnl >= 0 ? "+" : ""}{unrealisedPnl.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      )}
    </Card>
  );
}

function LiveTradesPanel({ nfoPositions }: { nfoPositions: Position[] }) {
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 px-1">
        <Activity className="w-5 h-5 text-emerald-400" />
        <span className="font-semibold" data-testid="text-live-trades-title">Live Trades</span>
        <Badge variant="secondary">{deployedPlans.length} strategies</Badge>
      </div>

      {deployedPlans.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Live Trades</h3>
            <p className="text-muted-foreground">Deploy strategies from the Strategy page to see live trades here</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {deployedPlans.map((plan) => (
            <DashboardTradeCard key={plan.id} plan={plan} configs={configs} brokerConfigs={brokerConfigs} nfoPositions={nfoPositions} />
          ))}
        </div>
      )}
    </div>
  );
}

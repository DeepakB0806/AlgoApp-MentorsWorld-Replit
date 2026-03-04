import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Trash2, Settings, Link2, Loader2, X, Clock, Shield, Target, TrendingUp, Rocket, Play, Pause, Square, Power, RefreshCw, Wifi, WifiOff, TrendingDown, Activity, ChevronDown, ChevronUp, BarChart3, Archive, AlertTriangle, ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { StrategyConfig, StrategyPlan, StrategyTrade, StrategyDailyPnl } from "@shared/schema";
import type { TradeParams } from "@shared/schema";
import { buildBrokerOrderParams } from "@shared/schema";
import type { BrokerConfig } from "@shared/schema";

function parseJsonSafe<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

const DEPLOYMENT_STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Activity }> = {
  draft: { label: "Draft", color: "text-muted-foreground", icon: Clock },
  deployed: { label: "Deployed", color: "text-blue-400", icon: Rocket },
  active: { label: "Active", color: "text-emerald-400", icon: Play },
  paused: { label: "Paused", color: "text-amber-400", icon: Pause },
  squared_off: { label: "Squared Off", color: "text-red-400", icon: Square },
  closed: { label: "Closed", color: "text-muted-foreground", icon: Power },
  archived: { label: "Archived", color: "text-purple-400", icon: Archive },
};

function formatTradeTime(timeUnix: number | null, localTime: string | null, executedAt: string | null): string {
  if (localTime) return localTime;
  if (timeUnix) {
    const d = new Date(timeUnix > 9999999999 ? timeUnix : timeUnix * 1000);
    return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
  }
  if (executedAt) {
    const d = new Date(executedAt);
    return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
  }
  return "-";
}

function TradeTableContent({ trades, groupedTrades, BLOCK_LABELS, plan }: {
  trades: StrategyTrade[];
  groupedTrades: Record<string, StrategyTrade[]>;
  BLOCK_LABELS: Record<string, { label: string; icon: typeof TrendingUp; color: string }>;
  plan?: StrategyPlan;
}) {
  if (trades.length === 0) return null;

  const getFieldValue = (trade: StrategyTrade, key: string): string => {
    if (key === "timeUnix") return formatTradeTime(trade.timeUnix || null, null, trade.executedAt);
    if (key === "exchange") return trade.exchange || plan?.exchange || "-";
    if (key === "ticker") return trade.ticker || trade.tradingSymbol || plan?.ticker || "-";
    if (key === "indicator") return trade.indicator || "-";
    if (key === "alert") return trade.alert || trade.action || "-";
    if (key === "signalPrice") return (trade.price || 0).toFixed(2);
    if (key === "localTime") return trade.localTime || "-";
    if (key === "mode") return trade.mode || "-";
    if (key === "modeDesc") return trade.modeDesc || "-";
    return "-";
  };

  const HEADERS = [
    { key: "timeUnix", label: "time_unix", align: "text-left" },
    { key: "exchange", label: "exchange", align: "text-left" },
    { key: "ticker", label: "ticker", align: "text-left" },
    { key: "indicator", label: "indicator", align: "text-left" },
    { key: "alert", label: "action", align: "text-left" },
    { key: "signalPrice", label: "price", align: "text-right" },
    { key: "localTime", label: "local_time", align: "text-left" },
    { key: "mode", label: "mode", align: "text-left" },
    { key: "modeDesc", label: "mode_desc", align: "text-left" },
    { key: "qty", label: "qty", align: "text-right" },
    { key: "entryPrice", label: "price", align: "text-right" },
    { key: "pnl", label: "p&l", align: "text-right" },
    { key: "status", label: "status", align: "text-left" },
  ];

  return (
    <div className="space-y-3">
      {Object.entries(groupedTrades).map(([blockType, blockTrades]) => {
        const blockCfg = BLOCK_LABELS[blockType] || BLOCK_LABELS.legs;
        const BlockIcon = blockCfg.icon;
        const blockPnl = blockTrades.reduce((s, t) => s + (t.pnl || 0), 0);
        return (
          <div key={blockType} className="border border-border/30 rounded-md" data-testid={`container-block-${blockType}`}>
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border/20 flex-wrap">
              <div className="flex items-center gap-2">
                <BlockIcon className={`w-3.5 h-3.5 ${blockCfg.color}`} />
                <span className="text-xs font-semibold">{blockCfg.label}</span>
                <Badge variant="secondary" className="text-xs">{blockTrades.length} trade{blockTrades.length !== 1 ? "s" : ""}</Badge>
              </div>
              <span className={`text-xs font-mono font-semibold ${blockPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                p&l: {blockPnl >= 0 ? "+" : ""}{blockPnl.toFixed(2)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30">
                    {HEADERS.map((h) => (
                      <th key={h.key} className={`whitespace-nowrap ${h.align} px-2 py-1 text-muted-foreground font-medium`}>{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {blockTrades.map((trade) => {
                    const isClosed = trade.status === "closed" || trade.status === "squared_off";
                    const alertVal = trade.alert || trade.action || "-";
                    const isSell = alertVal.toUpperCase().includes("SELL") || trade.action === "SELL";
                    const isBuy = alertVal.toUpperCase().includes("BUY") || trade.action === "BUY";
                    return (
                      <tr key={trade.id} className="border-b border-border/20" data-testid={`row-trade-${trade.id}`}>
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono text-muted-foreground">{getFieldValue(trade, "timeUnix")}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono">{getFieldValue(trade, "exchange")}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono font-medium">{getFieldValue(trade, "ticker")}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{getFieldValue(trade, "indicator")}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          <Badge variant={isSell ? "destructive" : isBuy ? "default" : "secondary"} className="font-mono text-xs">
                            {alertVal}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">{getFieldValue(trade, "signalPrice")}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono text-muted-foreground">{getFieldValue(trade, "localTime")}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{getFieldValue(trade, "mode")}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{getFieldValue(trade, "modeDesc")}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">{trade.quantity}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">{(trade.price || 0).toFixed(2)}</td>
                        <td className={`whitespace-nowrap px-2 py-1.5 text-right font-mono font-semibold ${(trade.pnl || 0) > 0 ? "text-emerald-400" : (trade.pnl || 0) < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                          {isClosed ? (<>{(trade.pnl || 0) >= 0 ? "+" : ""}{(trade.pnl || 0).toFixed(2)}</>) : (<span className="text-muted-foreground/60">--</span>)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          <Badge variant="outline" className="text-xs">{trade.status}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LivePositionTracker({ plan, brokerConfigs, parentConfig }: { plan: StrategyPlan; brokerConfigs: BrokerConfig[]; parentConfig?: StrategyConfig }) {
  const { toast } = useToast();
  const brokerConfig = brokerConfigs.find((bc) => bc.id === plan.brokerConfigId);
  const isConnected = brokerConfig?.isConnected || false;
  const isDeployed = plan.deploymentStatus && plan.deploymentStatus !== "draft";
  const isPaperTrade = brokerConfig?.brokerName === "paper_trade";
  const webhookId = parentConfig?.webhookId;

  const { data: _syncResult } = useQuery({
    queryKey: ["/api/process-production-signals", webhookId],
    queryFn: async () => {
      const resp = await fetch(`/api/process-production-signals/${webhookId}`, { method: "POST" });
      if (!resp.ok) return null;
      return resp.json();
    },
    enabled: !!isPaperTrade && !!webhookId && plan.deploymentStatus === "active",
    refetchInterval: 60000,
  });

  const { data: trades = [], isLoading, refetch } = useQuery<StrategyTrade[]>({
    queryKey: ["/api/strategy-trades", plan.id],
    queryFn: async () => {
      const resp = await fetch(`/api/strategy-trades/${plan.id}`);
      if (!resp.ok) throw new Error("Failed to fetch");
      return resp.json();
    },
    enabled: !!isDeployed,
    refetchInterval: plan.deploymentStatus === "active" ? 30000 : false,
  });

  const clearTradesMutation = useMutation({
    mutationFn: async (days: number | "all") => {
      if (days === "all") {
        return apiRequest("DELETE", `/api/strategy-trades/${plan.id}/clear?days=all`);
      }
      return apiRequest("DELETE", `/api/strategy-trades/${plan.id}/clear?days=${days}`);
    },
    onSuccess: (_data, days) => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-trades", plan.id] });
      toast({ title: days === "all" ? "All trade data cleared" : `Trades older than ${days} day${days !== 1 ? "s" : ""} cleared` });
    },
    onError: () => {
      toast({ title: "Failed to clear trade data", variant: "destructive" });
    },
  });

  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const tradesCount = trades.length;
  useEffect(() => {
    if (tradesCount > 0 || !isLoading) setLastFetched(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }));
  }, [tradesCount, isLoading]);

  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalValue = trades.reduce((sum, t) => sum + ((t.price || 0) * (t.quantity || 0)), 0);
  const openTrades = trades.filter((t) => t.status === "executed" || t.status === "partial");
  const closedTrades = trades.filter((t) => t.status === "closed" || t.status === "squared_off");

  const BLOCK_LABELS: Record<string, { label: string; icon: typeof TrendingUp; color: string }> = {
    uptrend: { label: "Uptrend Block", icon: TrendingUp, color: "text-emerald-400" },
    downtrend: { label: "Downtrend Block", icon: TrendingDown, color: "text-red-400" },
    neutral: { label: "Neutral Block", icon: Activity, color: "text-amber-400" },
    legs: { label: "Legs", icon: Target, color: "text-blue-400" },
  };

  const groupedTrades: Record<string, StrategyTrade[]> = {};
  trades.forEach((t) => {
    const key = t.blockType || "legs";
    if (!groupedTrades[key]) groupedTrades[key] = [];
    groupedTrades[key].push(t);
  });

  return (
    <div className="mt-3 border-t border-border/50 pt-3" data-testid={`container-live-positions-${plan.id}`}>
      <button
        className="w-full flex items-center justify-between gap-2 mb-2 cursor-pointer"
        onClick={() => setIsCollapsed(!isCollapsed)}
        data-testid={`button-toggle-trades-${plan.id}`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Activity className="w-4 h-4 text-emerald-400" />
          <Label className="text-xs font-semibold cursor-pointer">Strategy Trade Tracker</Label>
          {isConnected ? (
            <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30">
              <Wifi className="w-3 h-3 mr-1" />
              Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-red-400 border-red-400/30">
              <WifiOff className="w-3 h-3 mr-1" />
              Disconnected
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs">{trades.length} trade{trades.length !== 1 ? "s" : ""}</Badge>
          {trades.length > 0 && (
            <span className={`text-xs font-mono font-semibold ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              P&L: {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && <span className="text-xs text-muted-foreground">Updated: {lastFetched}</span>}
          {isCollapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {!isCollapsed && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {brokerConfig && (
              <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                <span>Broker:</span>
                <span className="font-medium text-foreground">{brokerConfig.name || brokerConfig.brokerName}</span>
                {brokerConfig.environment === "uat" && <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/30">Sandbox</Badge>}
                {brokerConfig.environment === "prod" && <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30">Production</Badge>}
              </div>
            )}
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={(e) => { e.stopPropagation(); refetch(); }} disabled={isLoading} data-testid={`button-refresh-positions-${plan.id}`} title="Refresh">
                <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={clearTradesMutation.isPending || trades.length === 0}
                    data-testid={`button-clear-trades-${plan.id}`}
                    title="Clear trade data"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => clearTradesMutation.mutate(1)} data-testid={`clear-trades-1-day-${plan.id}`}>
                    Older than 1 day
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => clearTradesMutation.mutate(7)} data-testid={`clear-trades-7-days-${plan.id}`}>
                    Older than 7 days
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => clearTradesMutation.mutate(30)} data-testid={`clear-trades-30-days-${plan.id}`}>
                    Older than 30 days
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => clearTradesMutation.mutate("all")} data-testid={`clear-trades-all-${plan.id}`} className="text-destructive">
                    Clear All Trades
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="icon"
                onClick={(e) => { e.stopPropagation(); setIsSheetOpen(true); setSheetExpanded(false); }}
                data-testid={`button-expand-trades-${plan.id}`}
                title="Expand"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-card border border-border rounded-md p-2">
              <p className="text-xs text-muted-foreground">Total Value</p>
              <p className="text-sm font-semibold font-mono">{totalValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
            </div>
            <div className="bg-card border border-border rounded-md p-2">
              <p className="text-xs text-muted-foreground">Total P&L</p>
              <p className={`text-sm font-semibold font-mono ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}
              </p>
            </div>
            <div className="bg-card border border-border rounded-md p-2">
              <p className="text-xs text-muted-foreground">Open Trades</p>
              <p className="text-sm font-semibold font-mono">{openTrades.length}</p>
            </div>
            <div className="bg-card border border-border rounded-md p-2">
              <p className="text-xs text-muted-foreground">Closed Trades</p>
              <p className="text-sm font-semibold font-mono">{closedTrades.length}</p>
            </div>
          </div>

          {trades.length > 0 ? (
            <TradeTableContent trades={trades} groupedTrades={groupedTrades} BLOCK_LABELS={BLOCK_LABELS} plan={plan} />
          ) : (
            <div className="text-center py-6 border border-dashed border-border/40 rounded-md" data-testid={`empty-state-trades-${plan.id}`}>
              <Activity className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground font-medium">No trades executed by this strategy</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {plan.deploymentStatus === "active"
                  ? "Trades will appear here when market conditions trigger execution blocks"
                  : "Deploy and activate this strategy to start executing trades"}
              </p>
            </div>
          )}
        </div>
      )}

      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className={`${sheetExpanded ? "w-full sm:max-w-full" : "w-full max-w-[900px]"} h-full max-h-screen overflow-hidden flex flex-col`} side="right">
          <SheetHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <SheetTitle data-testid={`title-trade-sheet-${plan.id}`}>Trade Tracker: {plan.name || `Plan #${plan.id}`}</SheetTitle>
                <SheetDescription>
                  {trades.length} trade{trades.length !== 1 ? "s" : ""} | Open: {openTrades.length} | Closed: {closedTrades.length} | P&L: {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}
                </SheetDescription>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => refetch()}
                  disabled={isLoading}
                  data-testid={`button-sheet-refresh-${plan.id}`}
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={clearTradesMutation.isPending || trades.length === 0}
                      data-testid={`button-sheet-clear-trades-${plan.id}`}
                      title="Clear trade data"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => clearTradesMutation.mutate(1)} data-testid={`sheet-clear-trades-1-day-${plan.id}`}>
                      Older than 1 day
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => clearTradesMutation.mutate(7)} data-testid={`sheet-clear-trades-7-days-${plan.id}`}>
                      Older than 7 days
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => clearTradesMutation.mutate(30)} data-testid={`sheet-clear-trades-30-days-${plan.id}`}>
                      Older than 30 days
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => clearTradesMutation.mutate("all")} data-testid={`sheet-clear-trades-all-${plan.id}`} className="text-destructive">
                      Clear All Trades
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setSheetExpanded(!sheetExpanded)}
                  data-testid={`button-sheet-expand-${plan.id}`}
                  title={sheetExpanded ? "Collapse" : "Expand"}
                >
                  {sheetExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </SheetHeader>
          <div className="mt-4 flex-1 min-h-0 overflow-y-auto">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <div className="bg-card border border-border rounded-md p-2">
                <p className="text-xs text-muted-foreground">Total Value</p>
                <p className="text-sm font-semibold font-mono">{totalValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
              </div>
              <div className="bg-card border border-border rounded-md p-2">
                <p className="text-xs text-muted-foreground">Total P&L</p>
                <p className={`text-sm font-semibold font-mono ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}
                </p>
              </div>
              <div className="bg-card border border-border rounded-md p-2">
                <p className="text-xs text-muted-foreground">Open Trades</p>
                <p className="text-sm font-semibold font-mono">{openTrades.length}</p>
              </div>
              <div className="bg-card border border-border rounded-md p-2">
                <p className="text-xs text-muted-foreground">Closed Trades</p>
                <p className="text-sm font-semibold font-mono">{closedTrades.length}</p>
              </div>
            </div>
            {trades.length > 0 ? (
              <TradeTableContent trades={trades} groupedTrades={groupedTrades} BLOCK_LABELS={BLOCK_LABELS} plan={plan} />
            ) : (
              <div className="text-center py-8">
                <Activity className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No trades to display</p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DailyPnlTable({ entries }: { entries: StrategyDailyPnl[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="overflow-auto flex-1 min-h-0">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 z-20 bg-card">
          <tr className="border-b">
            <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Date</th>
            <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-right font-medium text-muted-foreground">Day P&L</th>
            <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-right font-medium text-muted-foreground">Cumulative P&L</th>
            <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-center font-medium text-muted-foreground">Trades</th>
            <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-center font-medium text-muted-foreground">Open</th>
            <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-center font-medium text-muted-foreground">Closed</th>
            <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} data-testid={`row-daily-pnl-${entry.id}`} className="border-b hover:bg-muted/50">
              <td className="whitespace-nowrap px-2 py-2 font-mono font-medium">{entry.date}</td>
              <td className={`whitespace-nowrap px-2 py-2 text-right font-mono font-semibold ${(entry.dailyPnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {(entry.dailyPnl || 0) >= 0 ? "+" : ""}{(entry.dailyPnl || 0).toFixed(2)}
              </td>
              <td className={`whitespace-nowrap px-2 py-2 text-right font-mono font-semibold ${(entry.cumulativePnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {(entry.cumulativePnl || 0) >= 0 ? "+" : ""}{(entry.cumulativePnl || 0).toFixed(2)}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-center font-mono">{entry.tradesCount || 0}</td>
              <td className="whitespace-nowrap px-2 py-2 text-center font-mono">{entry.openTrades || 0}</td>
              <td className="whitespace-nowrap px-2 py-2 text-center font-mono">{entry.closedTrades || 0}</td>
              <td className="whitespace-nowrap px-2 py-2">
                <Badge variant={entry.status === "active" ? "default" : "secondary"} className="text-xs">{entry.status}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyPnlLogSheet({ plan, isOpen, onOpenChange }: { plan: StrategyPlan; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const { data: rawEntries = [], isLoading, refetch } = useQuery<StrategyDailyPnl[]>({
    queryKey: ["/api/strategy-daily-pnl", plan.id],
    enabled: isOpen,
  });

  const clearDailyPnlMutation = useMutation({
    mutationFn: async (days: number | "all") => {
      if (days === "all") {
        return apiRequest("DELETE", `/api/strategy-daily-pnl/${plan.id}/clear?days=all`);
      }
      return apiRequest("DELETE", `/api/strategy-daily-pnl/${plan.id}/clear?days=${days}`);
    },
    onSuccess: (_data, days) => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-daily-pnl", plan.id] });
      toast({ title: days === "all" ? "All daily P&L data cleared" : `P&L entries older than ${days} day${days !== 1 ? "s" : ""} cleared` });
    },
    onError: () => {
      toast({ title: "Failed to clear daily P&L data", variant: "destructive" });
    },
  });

  const entries = [...rawEntries].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const planName = plan.name || `Plan #${plan.id}`;

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className={`${sheetExpanded ? "w-full sm:max-w-full" : "w-full max-w-[800px]"} h-full max-h-screen overflow-hidden flex flex-col`} side="right">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <SheetTitle data-testid={`title-daily-pnl-sheet-${plan.id}`}>Daily P&L Log: {planName}</SheetTitle>
              <SheetDescription>
                {entries.length} day{entries.length !== 1 ? "s" : ""} of P&L data recorded
                {entries.length > 0 && (
                  <span className={`ml-2 font-mono font-semibold ${(entries[0]?.cumulativePnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    Cumulative: {(entries[0]?.cumulativePnl || 0) >= 0 ? "+" : ""}{(entries[0]?.cumulativePnl || 0).toFixed(2)}
                  </span>
                )}
              </SheetDescription>
            </div>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetch()}
                disabled={isLoading}
                data-testid={`button-sheet-refresh-pnl-${plan.id}`}
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={clearDailyPnlMutation.isPending || entries.length === 0}
                    data-testid={`button-sheet-clear-pnl-${plan.id}`}
                    title="Clear P&L data"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => clearDailyPnlMutation.mutate(1)} data-testid={`sheet-clear-pnl-1-day-${plan.id}`}>
                    Older than 1 day
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => clearDailyPnlMutation.mutate(7)} data-testid={`sheet-clear-pnl-7-days-${plan.id}`}>
                    Older than 7 days
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => clearDailyPnlMutation.mutate(30)} data-testid={`sheet-clear-pnl-30-days-${plan.id}`}>
                    Older than 30 days
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => clearDailyPnlMutation.mutate("all")} data-testid={`sheet-clear-pnl-all-${plan.id}`} className="text-destructive">
                    Clear All P&L Data
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setSheetExpanded(!sheetExpanded)}
                data-testid={`button-sheet-expand-pnl-${plan.id}`}
                title={sheetExpanded ? "Collapse" : "Expand"}
              >
                {sheetExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </SheetHeader>
        <div className="mt-6 flex-1 min-h-0 flex flex-col">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mr-2" />
              <span className="text-sm text-muted-foreground">Loading daily P&L data...</span>
            </div>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground text-center py-8" data-testid={`empty-state-daily-pnl-${plan.id}`}>No daily P&L entries recorded yet for this strategy.</p>
          ) : (
            <DailyPnlTable entries={entries} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function BrokerLinking() {
  const { toast } = useToast();

  const { data: plans = [], isLoading } = useQuery<StrategyPlan[]>({
    queryKey: ["/api/strategy-plans"],
  });

  const { data: brokerConfigs = [] } = useQuery<BrokerConfig[]>({
    queryKey: ["/api/broker-configs"],
  });

  const activePlans = plans.filter((p) => p.status === "active");

  const [localState, setLocalState] = useState<Record<string, { brokerConfigId: string; isProxyMode: boolean }>>({});
  const [confirmAction, setConfirmAction] = useState<{ planId: string; action: string } | null>(null);
  const [deployConfig, setDeployConfig] = useState<Record<string, { lotMultiplier: number; stoploss: number; profitTarget: number; baseStoploss: number; baseProfitTarget: number; brokerConfigId?: string }>>({});
  const [pnlSheetPlanId, setPnlSheetPlanId] = useState<string | null>(null);

  const plansKey = activePlans.map((p) => `${p.id}:${p.brokerConfigId}:${p.isProxyMode}`).join(",");
  useEffect(() => {
    const state: Record<string, { brokerConfigId: string; isProxyMode: boolean }> = {};
    activePlans.forEach((p) => {
      state[p.id] = {
        brokerConfigId: p.brokerConfigId || "",
        isProxyMode: p.isProxyMode || false,
      };
    });
    setLocalState(state);
  }, [plansKey]);

  const linkMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      return apiRequest("PATCH", `/api/strategy-plans/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-plans"] });
      toast({ title: "Broker linking updated" });
    },
    onError: () => {
      toast({ title: "Failed to update broker linking", variant: "destructive" });
    },
  });

  const deploymentMutation = useMutation({
    mutationFn: async ({ id, deploymentStatus, lotMultiplier, deployStoploss, deployProfitTarget, brokerConfigId }: { id: string; deploymentStatus: string; lotMultiplier?: number; deployStoploss?: number; deployProfitTarget?: number; brokerConfigId?: string }) => {
      const body: Record<string, unknown> = { deploymentStatus };
      if (lotMultiplier !== undefined) body.lotMultiplier = lotMultiplier;
      if (deployStoploss !== undefined) body.deployStoploss = deployStoploss;
      if (deployProfitTarget !== undefined) body.deployProfitTarget = deployProfitTarget;
      if (brokerConfigId !== undefined) body.brokerConfigId = brokerConfigId;
      return apiRequest("PATCH", `/api/strategy-plans/${id}/deployment`, body);
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

  const handleLink = (planId: string) => {
    const state = localState[planId];
    if (!state) return;
    linkMutation.mutate({
      id: planId,
      data: {
        brokerConfigId: state.brokerConfigId || null,
        isProxyMode: state.isProxyMode,
      },
    });
  };

  const handleUnlink = (planId: string) => {
    linkMutation.mutate({
      id: planId,
      data: {
        brokerConfigId: null,
        isProxyMode: false,
      },
    });
    setLocalState((prev) => ({
      ...prev,
      [planId]: { brokerConfigId: "", isProxyMode: false },
    }));
  };

  const updateLocalState = (planId: string, field: string, value: string | boolean) => {
    setLocalState((prev) => ({
      ...prev,
      [planId]: { ...prev[planId], [field]: value },
    }));
  };

  const initDeployConfig = (plan: StrategyPlan) => {
    const tp = plan.tradeParams ? parseJsonSafe<TradeParams>(plan.tradeParams, { legs: [] }) : { legs: [] };
    const baseSL = tp.stoploss?.value || 0;
    const basePT = tp.profitTarget?.value || 0;
    setDeployConfig((prev) => ({
      ...prev,
      [plan.id]: {
        lotMultiplier: plan.lotMultiplier || 1,
        stoploss: plan.deployStoploss || baseSL,
        profitTarget: plan.deployProfitTarget || basePT,
        baseStoploss: baseSL,
        baseProfitTarget: basePT,
        brokerConfigId: plan.brokerConfigId || "",
      },
    }));
  };

  const updateDeployMultiplier = (planId: string, multiplier: number) => {
    setDeployConfig((prev) => {
      const cfg = prev[planId];
      if (!cfg) return prev;
      return {
        ...prev,
        [planId]: {
          ...cfg,
          lotMultiplier: multiplier,
          stoploss: parseFloat((cfg.baseStoploss * multiplier).toFixed(2)),
          profitTarget: parseFloat((cfg.baseProfitTarget * multiplier).toFixed(2)),
        },
      };
    });
  };

  const handleDeploymentAction = (planId: string, action: string) => {
    setConfirmAction({ planId, action });
  };

  const executeDeploymentAction = () => {
    if (!confirmAction) return;
    const cfg = deployConfig[confirmAction.planId];
    if (confirmAction.action === "deployed" && cfg) {
      deploymentMutation.mutate({
        id: confirmAction.planId,
        deploymentStatus: confirmAction.action,
        lotMultiplier: cfg.lotMultiplier,
        deployStoploss: cfg.stoploss,
        deployProfitTarget: cfg.profitTarget,
        brokerConfigId: cfg.brokerConfigId || undefined,
      });
    } else {
      deploymentMutation.mutate({ id: confirmAction.planId, deploymentStatus: confirmAction.action });
    }
  };

  const { data: configs = [] } = useQuery<StrategyConfig[]>({
    queryKey: ["/api/strategy-configs"],
  });

  const getConfigName = (cId: string) => {
    const c = configs.find((cfg) => cfg.id === cId);
    return c ? c.name : "Unknown";
  };

  const hasFieldCorrelation = (plan: StrategyPlan) => {
    if (!plan.brokerConfigId || !plan.tradeParams) return false;
    const tp = parseJsonSafe<TradeParams>(plan.tradeParams, { legs: [], uptrendLegs: [], downtrendLegs: [], neutralLegs: [] });
    return (tp.uptrendLegs || []).length > 0 || (tp.downtrendLegs || []).length > 0 || (tp.neutralLegs || []).length > 0 || (tp.legs || []).length > 0;
  };

  const getDeploymentActions = (status: string): { action: string; label: string; icon: typeof Play; variant: "default" | "outline" | "destructive" }[] => {
    switch (status) {
      case "draft":
        return [];
      case "deployed":
        return [
          { action: "active", label: "Activate", icon: Play, variant: "default" },
          { action: "closed", label: "Close", icon: Power, variant: "destructive" },
        ];
      case "active":
        return [
          { action: "paused", label: "Pause", icon: Pause, variant: "outline" },
          { action: "squared_off", label: "Square Off", icon: Square, variant: "destructive" },
          { action: "closed", label: "Close", icon: Power, variant: "destructive" },
        ];
      case "paused":
        return [
          { action: "active", label: "Resume", icon: Play, variant: "default" },
          { action: "squared_off", label: "Square Off", icon: Square, variant: "destructive" },
          { action: "closed", label: "Close", icon: Power, variant: "destructive" },
        ];
      case "squared_off":
        return [
          { action: "active", label: "Reactivate", icon: Play, variant: "default" },
          { action: "closed", label: "Close", icon: Power, variant: "destructive" },
        ];
      case "closed":
        return [
          { action: "archived", label: "Archive", icon: Archive, variant: "outline" },
          { action: "deployed", label: "Re-deploy", icon: Rocket, variant: "default" },
        ];
      case "archived":
        return [
          { action: "deployed", label: "Re-deploy", icon: Rocket, variant: "default" },
        ];
      default:
        return [];
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold" data-testid="text-broker-linking-title">Broker Linking</h2>

      {activePlans.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Link2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Active Plans</h3>
            <p className="text-muted-foreground">Activate a trade plan to link it to a broker</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {activePlans.map((plan) => {
            const state = localState[plan.id] || { brokerConfigId: "", isProxyMode: false };
            const depStatus = plan.deploymentStatus || "draft";
            const depConfig = DEPLOYMENT_STATUS_CONFIG[depStatus] || DEPLOYMENT_STATUS_CONFIG.draft;
            const DepIcon = depConfig.icon;
            const canDeploy = hasFieldCorrelation(plan) && depStatus === "draft";
            const canRedeploy = depStatus === "closed" || depStatus === "archived";
            const isDeployed = depStatus !== "draft";
            const actions = getDeploymentActions(depStatus);

            return (
              <Card key={plan.id} data-testid={`card-broker-link-${plan.id}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 flex-wrap" data-testid={`text-broker-plan-name-${plan.id}`}>
                    {plan.name}
                    <Badge variant="default">{plan.status}</Badge>
                    {plan.brokerConfigId && (
                      <Badge variant="secondary" className="text-xs">
                        <Link2 className="w-3 h-3 mr-1" />
                        Linked
                      </Badge>
                    )}
                    {isDeployed && (
                      <Badge variant="outline" className={`text-xs ${depConfig.color}`} data-testid={`badge-deployment-${plan.id}`}>
                        <DepIcon className="w-3 h-3 mr-1" />
                        {depConfig.label}
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Config: {getConfigName(plan.configId)}
                    {plan.exchange && <span className="ml-2">{plan.exchange}</span>}
                    {plan.ticker && <span className="ml-1">/ {plan.ticker}</span>}
                  </p>
                  {isDeployed && (() => {
                    const parentCfg = configs.find((c) => c.id === plan.configId);
                    const parentVersion = parentCfg?.configVersion || 1;
                    const deployedVersion = plan.deployedConfigVersion || 1;
                    if (parentVersion > deployedVersion) {
                      return (
                        <div className="flex items-center gap-1 mt-1" data-testid={`badge-new-version-${plan.id}`}>
                          <AlertTriangle className="w-3 h-3 text-amber-400" />
                          <span className="text-xs text-amber-400 font-medium">New Version Available (v{parentVersion}) — Archive & Re-deploy to update</span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  {isDeployed && (() => {
                    const tp = parseJsonSafe<TradeParams>(plan.tradeParams, { legs: [] });
                    const effectiveSL = plan.deployStoploss ?? (tp.stoploss?.enabled ? tp.stoploss.value : null);
                    const effectivePT = plan.deployProfitTarget ?? (tp.profitTarget?.enabled ? tp.profitTarget.value : null);
                    const effectiveMultiplier = plan.lotMultiplier || 1;
                    if (effectiveMultiplier <= 1 && !effectiveSL && !effectivePT) return null;
                    return (
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {effectiveMultiplier > 1 && (
                          <Badge variant="outline" className="text-xs text-blue-400 border-blue-400/30">{effectiveMultiplier}x Lots</Badge>
                        )}
                        {effectiveSL != null && effectiveSL > 0 && (
                          <Badge variant="outline" className="text-xs text-red-400 border-red-400/30">SL: {effectiveSL}</Badge>
                        )}
                        {effectivePT != null && effectivePT > 0 && (
                          <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30">PT: {effectivePT}</Badge>
                        )}
                      </div>
                    );
                  })()}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs">Broker Configuration</Label>
                    <Select
                      value={state.brokerConfigId}
                      onValueChange={(v) => updateLocalState(plan.id, "brokerConfigId", v)}
                      disabled={isDeployed}
                    >
                      <SelectTrigger data-testid={`select-broker-${plan.id}`}>
                        <SelectValue placeholder="Select broker" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {brokerConfigs.map((bc) => (
                          <SelectItem key={bc.id} value={bc.id}>
                            {bc.name || bc.brokerName} {bc.ucc ? `(${bc.ucc})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={state.isProxyMode}
                        onCheckedChange={(v) => updateLocalState(plan.id, "isProxyMode", v)}
                        disabled={isDeployed}
                        data-testid={`switch-proxy-${plan.id}`}
                      />
                      <Label className="text-xs cursor-pointer">Proxy Mode</Label>
                    </div>
                    <div className="flex gap-2">
                      {!isDeployed && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => handleLink(plan.id)}
                            disabled={linkMutation.isPending}
                            data-testid={`button-link-${plan.id}`}
                          >
                            {linkMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Link2 className="w-3 h-3 mr-1" />}
                            Link
                          </Button>
                          {plan.brokerConfigId && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleUnlink(plan.id)}
                              disabled={linkMutation.isPending}
                              data-testid={`button-unlink-${plan.id}`}
                            >
                              Unlink
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {plan.brokerConfigId && plan.tradeParams && (() => {
                    const tp = parseJsonSafe<TradeParams>(plan.tradeParams, { legs: [], uptrendLegs: [], downtrendLegs: [], neutralLegs: [] });
                    const parentConfig = configs.find((c) => c.id === plan.configId);
                    const blockGroups = [
                      ...(tp.uptrendLegs || []).length > 0 ? [{ label: "Uptrend", legs: tp.uptrendLegs!, color: "text-emerald-400", productMode: tp.uptrendConfig?.productMode || "MIS" }] : [],
                      ...(tp.downtrendLegs || []).length > 0 ? [{ label: "Downtrend", legs: tp.downtrendLegs!, color: "text-red-400", productMode: tp.downtrendConfig?.productMode || "MIS" }] : [],
                      ...(tp.neutralLegs || []).length > 0 ? [{ label: "Neutral", legs: tp.neutralLegs!, color: "text-blue-400", productMode: tp.neutralConfig?.productMode || "MIS" }] : [],
                      ...(tp.legs || []).length > 0 ? [{ label: "Legs", legs: tp.legs, color: "text-muted-foreground", productMode: "MIS" as const }] : [],
                    ];
                    if (blockGroups.length === 0) return null;
                    return (
                      <div className="mt-3 border-t border-border/50 pt-3" data-testid={`container-field-correlation-${plan.id}`}>
                        <Label className="text-xs mb-2 block text-muted-foreground">Field Correlation Map</Label>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border/30">
                                <th className="text-left px-2 py-1 text-muted-foreground">Block</th>
                                <th className="text-left px-2 py-1 text-muted-foreground">Leg</th>
                                <th className="text-left px-2 py-1 text-muted-foreground">Strategy</th>
                                <th className="text-left px-2 py-1 text-muted-foreground">Broker API</th>
                              </tr>
                            </thead>
                            <tbody>
                              {blockGroups.map((group) =>
                                group.legs.map((leg, i) => {
                                  const params = buildBrokerOrderParams(leg, {
                                    exchange: parentConfig?.exchange,
                                    ticker: parentConfig?.ticker,
                                    productMode: group.productMode as "MIS" | "NRML",
                                  });
                                  return (
                                    <tr key={`${group.label}-${i}`} className="border-b border-border/20">
                                      {i === 0 && (
                                        <td className={`px-2 py-1.5 font-medium ${group.color}`} rowSpan={group.legs.length}>{group.label}</td>
                                      )}
                                      <td className="px-2 py-1.5 font-mono">#{i + 1}</td>
                                      <td className="px-2 py-1.5">
                                        <div className="flex flex-wrap gap-1">
                                          <Badge variant="outline" className="text-xs">{leg.action}</Badge>
                                          <Badge variant="outline" className="text-xs">{leg.type}</Badge>
                                          <Badge variant="outline" className="text-xs">{leg.strike}</Badge>
                                          <Badge variant="outline" className="text-xs">{leg.orderType}</Badge>
                                        </div>
                                      </td>
                                      <td className="px-2 py-1.5">
                                        <div className="flex flex-wrap gap-1">
                                          <Badge variant="secondary" className="text-xs font-mono">tt={params.transaction_type}</Badge>
                                          <Badge variant="secondary" className="text-xs font-mono">pc={params.product}</Badge>
                                          <Badge variant="secondary" className="text-xs font-mono">es={params.exchange_segment}</Badge>
                                          <Badge variant="secondary" className="text-xs font-mono">qt={params.quantity}</Badge>
                                          {params.trading_symbol && <Badge variant="secondary" className="text-xs font-mono">ts={params.trading_symbol}</Badge>}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}

                  {(canDeploy || (canRedeploy && deployConfig[plan.id])) && (
                    <div className="mt-3 border-t border-border/50 pt-3 space-y-3">
                      {!deployConfig[plan.id] ? (
                        <Button
                          className="w-full"
                          variant="outline"
                          onClick={() => initDeployConfig(plan)}
                          data-testid={`button-configure-deploy-${plan.id}`}
                        >
                          <Settings className="w-4 h-4 mr-2" />
                          Configure & Deploy
                        </Button>
                      ) : (
                        <div className="space-y-3" data-testid={`container-deploy-config-${plan.id}`}>
                          <Label className="text-xs font-semibold block text-muted-foreground">{canRedeploy ? "Re-Deploy Configuration" : "Pre-Deploy Configuration"}</Label>

                          {canRedeploy && (
                            <div>
                              <Label className="text-xs mb-1.5 block text-muted-foreground">Broker</Label>
                              <Select
                                value={deployConfig[plan.id].brokerConfigId || ""}
                                onValueChange={(v) => setDeployConfig((prev) => ({
                                  ...prev,
                                  [plan.id]: { ...prev[plan.id], brokerConfigId: v },
                                }))}
                              >
                                <SelectTrigger data-testid={`select-redeploy-broker-${plan.id}`}>
                                  <SelectValue placeholder="Select broker" />
                                </SelectTrigger>
                                <SelectContent>
                                  {brokerConfigs.map((bc) => (
                                    <SelectItem key={bc.id} value={bc.id}>
                                      {bc.name || bc.brokerName} {bc.ucc ? `(${bc.ucc})` : ""}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          <div>
                            <Label className="text-xs mb-1.5 block text-muted-foreground">Lot Multiplier</Label>
                            <div className="flex gap-1.5 flex-wrap">
                              {[1, 2, 3, 4, 5].map((m) => (
                                <Button
                                  key={m}
                                  size="sm"
                                  variant={deployConfig[plan.id].lotMultiplier === m ? "default" : "outline"}
                                  onClick={() => updateDeployMultiplier(plan.id, m)}
                                  data-testid={`button-multiplier-${m}x-${plan.id}`}
                                >
                                  {m}x
                                </Button>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs mb-1 block text-muted-foreground">
                                Stoploss MTM
                                {deployConfig[plan.id].baseStoploss > 0 && (
                                  <span className="ml-1 text-muted-foreground/60">(base: {deployConfig[plan.id].baseStoploss})</span>
                                )}
                              </Label>
                              <Input
                                type="number"
                                value={deployConfig[plan.id].stoploss}
                                onChange={(e) => setDeployConfig((prev) => ({
                                  ...prev,
                                  [plan.id]: { ...prev[plan.id], stoploss: parseFloat(e.target.value) || 0 },
                                }))}
                                data-testid={`input-deploy-stoploss-${plan.id}`}
                              />
                            </div>
                            <div>
                              <Label className="text-xs mb-1 block text-muted-foreground">
                                Profit Target MTM
                                {deployConfig[plan.id].baseProfitTarget > 0 && (
                                  <span className="ml-1 text-muted-foreground/60">(base: {deployConfig[plan.id].baseProfitTarget})</span>
                                )}
                              </Label>
                              <Input
                                type="number"
                                value={deployConfig[plan.id].profitTarget}
                                onChange={(e) => setDeployConfig((prev) => ({
                                  ...prev,
                                  [plan.id]: { ...prev[plan.id], profitTarget: parseFloat(e.target.value) || 0 },
                                }))}
                                data-testid={`input-deploy-profit-target-${plan.id}`}
                              />
                            </div>
                          </div>

                          <div className="bg-card border border-border rounded-md p-2">
                            <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
                              {canRedeploy && deployConfig[plan.id].brokerConfigId && (
                                <span className="text-muted-foreground">Broker: <span className="font-mono font-semibold text-foreground">{(() => { const bc = brokerConfigs.find((b) => b.id === deployConfig[plan.id].brokerConfigId); return bc ? (bc.name || bc.brokerName) : "—"; })()}</span></span>
                              )}
                              <span className="text-muted-foreground">Multiplier: <span className="font-mono font-semibold text-foreground">{deployConfig[plan.id].lotMultiplier}x</span></span>
                              <span className="text-muted-foreground">SL: <span className="font-mono font-semibold text-red-400">{deployConfig[plan.id].stoploss}</span></span>
                              <span className="text-muted-foreground">Target: <span className="font-mono font-semibold text-emerald-400">{deployConfig[plan.id].profitTarget}</span></span>
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDeployConfig((prev) => {
                                const next = { ...prev };
                                delete next[plan.id];
                                return next;
                              })}
                              data-testid={`button-cancel-deploy-config-${plan.id}`}
                            >
                              <X className="w-3 h-3 mr-1" />
                              Cancel
                            </Button>
                            <Button
                              className="flex-1"
                              onClick={() => handleDeploymentAction(plan.id, "deployed")}
                              disabled={deploymentMutation.isPending || (canRedeploy && !deployConfig[plan.id]?.brokerConfigId)}
                              data-testid={`button-deploy-${plan.id}`}
                            >
                              {deploymentMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
                              {canRedeploy ? "Re-Deploy Strategy" : "Deploy Strategy"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {isDeployed && actions.length > 0 && (
                    <div className="mt-3 border-t border-border/50 pt-3" data-testid={`container-deployment-actions-${plan.id}`}>
                      <Label className="text-xs mb-2 block text-muted-foreground">Strategy Controls</Label>
                      <div className="flex gap-2 flex-wrap">
                        {actions.map((a) => {
                          const ActionIcon = a.icon;
                          if (a.action === "deployed" && canRedeploy) {
                            return (
                              <Button
                                key={a.action}
                                variant={a.variant}
                                size="sm"
                                onClick={() => initDeployConfig(plan)}
                                disabled={deploymentMutation.isPending}
                                data-testid={`button-${a.action}-${plan.id}`}
                              >
                                <ActionIcon className="w-3 h-3 mr-1" />
                                {a.label}
                              </Button>
                            );
                          }
                          return (
                            <Button
                              key={a.action}
                              variant={a.variant}
                              size="sm"
                              onClick={() => handleDeploymentAction(plan.id, a.action)}
                              disabled={deploymentMutation.isPending}
                              data-testid={`button-${a.action}-${plan.id}`}
                            >
                              <ActionIcon className="w-3 h-3 mr-1" />
                              {a.label}
                            </Button>
                          );
                        })}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPnlSheetPlanId(plan.id)}
                          data-testid={`button-daily-pnl-${plan.id}`}
                        >
                          <BarChart3 className="w-3 h-3 mr-1" />
                          P&L Log
                        </Button>
                      </div>
                    </div>
                  )}

                  {isDeployed && (
                    <LivePositionTracker plan={plan} brokerConfigs={brokerConfigs} parentConfig={configs.find((c) => c.id === plan.configId)} />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent aria-describedby="deployment-confirm-desc">
          <DialogHeader>
            <DialogTitle>Confirm Action</DialogTitle>
            <DialogDescription id="deployment-confirm-desc">Confirm the strategy deployment action below.</DialogDescription>
          </DialogHeader>
          {confirmAction && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {confirmAction.action === "deployed" && "Are you sure you want to deploy this strategy? Once deployed, the broker linking and trade parameters will be locked."}
                {confirmAction.action === "active" && "Are you sure you want to activate this strategy? It will begin executing trades based on incoming signals."}
                {confirmAction.action === "paused" && "Are you sure you want to pause this strategy? Open positions will remain, but no new trades will be executed."}
                {confirmAction.action === "squared_off" && "Are you sure you want to square off? This will close all open positions for this strategy."}
                {confirmAction.action === "closed" && "Are you sure you want to close this strategy? This will deactivate it completely. You can archive or re-deploy it later."}
                {confirmAction.action === "archived" && "Are you sure you want to archive this strategy? Your P&L history will be preserved. You can re-deploy it later to use updated features."}
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setConfirmAction(null)} data-testid="button-cancel-deployment">
                  Cancel
                </Button>
                <Button
                  variant={confirmAction.action === "squared_off" || confirmAction.action === "closed" ? "destructive" : "default"}
                  onClick={executeDeploymentAction}
                  disabled={deploymentMutation.isPending}
                  data-testid="button-confirm-deployment"
                >
                  {deploymentMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Confirm
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {pnlSheetPlanId && (() => {
        const selectedPlan = plans.find((p) => p.id === pnlSheetPlanId);
        if (!selectedPlan) return null;
        return (
          <DailyPnlLogSheet
            plan={selectedPlan}
            isOpen={!!pnlSheetPlanId}
            onOpenChange={(open) => { if (!open) setPnlSheetPlanId(null); }}
          />
        );
      })()}
    </div>
  );
}

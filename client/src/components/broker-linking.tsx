import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Trash2, Settings, Link2, Loader2, X, Clock, Shield, Target, TrendingUp, Rocket, Play, Pause, Square, Power, RefreshCw, Wifi, WifiOff, Activity, BarChart3, Archive, AlertTriangle, Maximize2, Minimize2, ChevronDown, ChevronUp, ChevronRight, Search } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { StrategyConfig, StrategyPlan, StrategyTrade, StrategyDailyPnl, Position } from "@shared/schema";
import type { TradeParams, TimeLogicConfig } from "@shared/schema";
import { buildBrokerOrderParams } from "@shared/schema";
import type { BrokerConfig, Webhook } from "@shared/schema";

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
              <td className={`whitespace-nowrap px-2 py-2 text-right font-mono font-semibold ${Number(entry.dailyPnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {Number(entry.dailyPnl || 0) >= 0 ? "+" : ""}{Number(entry.dailyPnl || 0).toFixed(2)}
              </td>
              <td className={`whitespace-nowrap px-2 py-2 text-right font-mono font-semibold ${Number(entry.cumulativePnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {Number(entry.cumulativePnl || 0) >= 0 ? "+" : ""}{Number(entry.cumulativePnl || 0).toFixed(2)}
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
  const [searchPositions, setSearchPositions] = useState("");

  const { data: rawEntries = [], isLoading, refetch } = useQuery<StrategyDailyPnl[]>({
    queryKey: ["/api/strategy-daily-pnl", plan.id],
    enabled: isOpen,
    refetchInterval: isOpen ? 30000 : false,
  });

  const { data: trades = [], isLoading: tradesLoading, refetch: refetchTrades } = useQuery<StrategyTrade[]>({
    queryKey: ["/api/strategy-trades", plan.id],
    queryFn: async () => {
      const resp = await fetch(`/api/strategy-trades/${plan.id}`);
      if (!resp.ok) throw new Error("Failed to fetch");
      return resp.json();
    },
    enabled: isOpen,
    refetchInterval: isOpen ? 30000 : false,
  });

  const { data: allPositions = [], isLoading: positionsLoading, refetch: refetchPositions } = useQuery<Position[]>({
    queryKey: ["/api/positions"],
    enabled: isOpen,
    refetchInterval: isOpen ? 30000 : false,
  });

  const nfoPositions = allPositions.filter((p) => p.exchange === "NFO");
  const strategySymbols = new Set(trades.map((t) => t.tradingSymbol).filter(Boolean));
  const strategyPositions = nfoPositions.filter((p) => strategySymbols.has(p.trading_symbol || ""));
  const filteredStrategyPositions = strategyPositions.filter((p) =>
    (p.trading_symbol || "").toLowerCase().includes(searchPositions.toLowerCase())
  );

  const totalPnl = strategyPositions.reduce((s, p) => s + Number(p.pnl || 0), 0);
  const realisedPnl = strategyPositions.reduce((s, p) => s + Number(p.realised_pnl || 0), 0);
  const unrealisedTotal = strategyPositions.reduce((s, p) => s + Number(p.unrealised_pnl ?? ((Number(p.ltp || 0) - Number(p.buy_avg || 0)) * Number(p.quantity || 0))), 0);
  const openCount = strategyPositions.filter((p) => Number(p.quantity || 0) !== 0).length;
  const closedCount = strategyPositions.filter((p) => Number(p.quantity || 0) === 0).length;

  const snapshotRef = useRef({ totalPnl, openCount, closedCount, positionsLoading, tradesLoading });
  snapshotRef.current = { totalPnl, openCount, closedCount, positionsLoading, tradesLoading };

  useEffect(() => {
    if (!isOpen) return;
    const snapshotPnl = () => {
      const { totalPnl: tp, openCount: oc, closedCount: cc, positionsLoading: pl, tradesLoading: tl } = snapshotRef.current;
      if (pl || tl) return;
      fetch(`/api/strategy-daily-pnl/snapshot/${plan.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalPnl: tp, openCount: oc, closedCount: cc }),
      }).then((resp) => {
        if (resp.ok) queryClient.invalidateQueries({ queryKey: ["/api/strategy-daily-pnl", plan.id] });
      }).catch(() => {});
    };
    snapshotPnl();
    const interval = setInterval(snapshotPnl, 30000);
    return () => clearInterval(interval);
  }, [isOpen, plan.id]);

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
  const isAnyLoading = isLoading || tradesLoading || positionsLoading;

  function handleRefreshAll() {
    refetch();
    refetchTrades();
    refetchPositions();
  }

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className={`${sheetExpanded ? "w-full sm:max-w-full" : "w-full max-w-[1000px]"} h-full max-h-screen overflow-hidden flex flex-col`} side="right">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <SheetTitle data-testid={`title-daily-pnl-sheet-${plan.id}`}>P&L Log: {planName}</SheetTitle>
              <SheetDescription>
                {entries.length} day{entries.length !== 1 ? "s" : ""} of P&L data · {strategyPositions.length} live position{strategyPositions.length !== 1 ? "s" : ""}
                {entries.length > 0 && (
                  <span className={`ml-2 font-mono font-semibold ${Number(entries[0]?.cumulativePnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    Cumulative: {Number(entries[0]?.cumulativePnl || 0) >= 0 ? "+" : ""}{Number(entries[0]?.cumulativePnl || 0).toFixed(2)}
                  </span>
                )}
              </SheetDescription>
            </div>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={handleRefreshAll}
                disabled={isAnyLoading}
                data-testid={`button-sheet-refresh-pnl-${plan.id}`}
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${isAnyLoading ? "animate-spin" : ""}`} />
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
        <div className="mt-4 flex-1 min-h-0 overflow-y-auto flex flex-col gap-6">
          <div>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">F&amp;O P&L</span>
                  <span className={`text-sm font-bold font-mono ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`} data-testid={`text-sheet-pnl-${plan.id}`}>
                    {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Realised</span>
                  <span className={`text-sm font-mono ${realisedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {realisedPnl >= 0 ? "+" : ""}{realisedPnl.toFixed(2)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Unrealised</span>
                  <span className={`text-sm font-mono ${unrealisedTotal >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {unrealisedTotal >= 0 ? "+" : ""}{unrealisedTotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">Open: {openCount}</Badge>
                  <Badge variant="secondary" className="text-xs">Closed: {closedCount}</Badge>
                </div>
              </div>
              {strategyPositions.length > 0 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                  <Input
                    placeholder="Search positions"
                    value={searchPositions}
                    onChange={(e) => setSearchPositions(e.target.value)}
                    className="pl-8 h-8 w-48 text-xs"
                    data-testid={`input-search-pnl-positions-${plan.id}`}
                  />
                </div>
              )}
            </div>
            {(tradesLoading || positionsLoading) ? (
              <div className="flex items-center gap-2 py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading positions…</span>
              </div>
            ) : filteredStrategyPositions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4" data-testid={`empty-state-positions-pnl-${plan.id}`}>{strategyPositions.length === 0 ? "No NFO positions linked to this strategy." : "No matching positions."}</p>
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
                    {filteredStrategyPositions.map((position, index) => {
                      const unrealisedPnl = Number(position.unrealised_pnl ?? ((Number(position.ltp || 0) - Number(position.buy_avg || 0)) * Number(position.quantity || 0)));
                      const instType = (position as any).instrument_type || "";
                      const token = (position as any).token || "";
                      return (
                        <TableRow key={index} data-testid={`row-pnl-position-${plan.id}-${index}`}>
                          <TableCell><code className="text-xs text-muted-foreground font-mono">{token || "—"}</code></TableCell>
                          <TableCell><div className="font-medium text-sm">{position.trading_symbol}</div></TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs text-violet-400 border-violet-400/50">{position.exchange}</Badge>
                          </TableCell>
                          <TableCell><span className="text-xs font-mono">{instType || "—"}</span></TableCell>
                          <TableCell className="text-right font-mono text-sm">{position.strike_price || "—"}</TableCell>
                          <TableCell><span className="text-xs">{position.product_type || "NRML"}</span></TableCell>
                          <TableCell>
                            {position.option_type ? (
                              <Badge variant="outline" className={`text-xs ${position.option_type === "CE" ? "text-emerald-400 border-emerald-400/50" : "text-red-400 border-red-400/50"}`}>
                                {position.option_type}
                              </Badge>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell><span className="text-xs">{position.expiry || "—"}</span></TableCell>
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
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Daily P&L Log</p>
            {isLoading ? (
              <div className="flex items-center gap-2 py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading daily P&L data…</span>
              </div>
            ) : entries.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4" data-testid={`empty-state-daily-pnl-${plan.id}`}>No daily P&L entries recorded yet for this strategy.</p>
            ) : (
              <DailyPnlTable entries={entries} />
            )}
          </div>
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

  const { data: webhooks = [] } = useQuery<Webhook[]>({
    queryKey: ["/api/webhooks"],
  });

  const activePlans = plans.filter((p) => p.status === "active");

  const [localState, setLocalState] = useState<Record<string, { brokerConfigId: string; isProxyMode: boolean }>>({});
  const [confirmAction, setConfirmAction] = useState<{ planId: string; action: string } | null>(null);
  const [deployConfig, setDeployConfig] = useState<Record<string, { lotMultiplier: number; stoploss: number; profitTarget: number; baseStoploss: number; baseProfitTarget: number; brokerConfigId?: string }>>({});
  const [pnlSheetPlanId, setPnlSheetPlanId] = useState<string | null>(null);
  const [expandedCorrelationMaps, setExpandedCorrelationMaps] = useState<Set<string>>(new Set());
  const [expandedStrategyConfigs, setExpandedStrategyConfigs] = useState<Set<string>>(new Set());

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
            const tp = parseJsonSafe<TradeParams>(plan.tradeParams, { legs: [], uptrendLegs: [], downtrendLegs: [], neutralLegs: [] });
            const parentConfig = configs.find((c) => c.id === plan.configId);
            const linkedBroker = brokerConfigs.find((b) => b.id === plan.brokerConfigId);
            const blockGroups = [
              ...(tp.uptrendLegs || []).length > 0 ? [{ label: "Uptrend", legs: tp.uptrendLegs!, color: "text-emerald-400", productMode: tp.uptrendConfig?.productMode || "MIS" }] : [],
              ...(tp.downtrendLegs || []).length > 0 ? [{ label: "Downtrend", legs: tp.downtrendLegs!, color: "text-red-400", productMode: tp.downtrendConfig?.productMode || "MIS" }] : [],
              ...(tp.neutralLegs || []).length > 0 ? [{ label: "Neutral", legs: tp.neutralLegs!, color: "text-blue-400", productMode: tp.neutralConfig?.productMode || "MIS" }] : [],
              ...((tp.legs || []).length > 0 && !((tp.uptrendLegs || []).length > 0) ? [{ label: "Legs", legs: tp.legs, color: "text-muted-foreground", productMode: "MIS" as const }] : []),
            ];
            const effectiveSL = plan.deployStoploss ?? (tp.stoploss?.enabled ? tp.stoploss.value : null);
            const effectivePT = plan.deployProfitTarget ?? (tp.profitTarget?.enabled ? tp.profitTarget.value : null);
            const effectiveMultiplier = plan.lotMultiplier || 1;
            const borderCls = ({ active: "border-l-emerald-500", paused: "border-l-amber-400", squared_off: "border-l-red-400", deployed: "border-l-blue-500" } as Record<string, string>)[depStatus] ?? "border-l-border/30";
            const badgeCls = ({ active: "bg-emerald-500 text-white border-transparent", paused: "bg-amber-400 text-black border-transparent", squared_off: "bg-red-500 text-white border-transparent", deployed: "bg-blue-500 text-white border-transparent" } as Record<string, string>)[depStatus] ?? "";
            const tl = (tp.timeLogic || {}) as TimeLogicConfig;
            const expiryOffset = tl.expiryWeekOffset ?? 0;
            const expType = tl.expiryType || "weekly";
            const dayRange = `(${tl.weeklyStartDay || "Mon"}-${tl.weeklyEndDay || "Thu"})`;
            const expiryLabel = expType === "weekly" && expiryOffset === 1
              ? `Expiry: Next Week ${dayRange}`
              : expType === "weekly"
              ? `Expiry: Weekly · Current ${dayRange}`
              : expType === "monthly" ? "Expiry: Monthly"
              : "Expiry: Custom";
            const allBtns = actions.length + 1;
            const isCorrelationExpanded = expandedCorrelationMaps.has(plan.id);
            const isStrategyConfigExpanded = expandedStrategyConfigs.has(plan.id);
            const planWebhook = parentConfig?.webhookId ? webhooks.find((w) => w.id === parentConfig.webhookId) : undefined;
            const chainP = planWebhook?.uniqueCode ? `P-${planWebhook.uniqueCode}` : null;
            const chainMc = parentConfig?.uniqueCode ?? null;
            const chainTps = plan.uniqueCode ?? null;
            const strategyConfigSummary = [
              blockGroups.length > 0 ? `${blockGroups.length} block${blockGroups.length > 1 ? "s" : ""}` : null,
              tp.stoploss?.enabled ? `SL: ${tp.stoploss.value}${tp.stoploss.mode === "percentage" ? "%" : ""}` : null,
              tl.exitTime ? `Exit ${tl.exitTime}` : null,
              tl.exitOnExpiry ? expiryLabel : null,
              (tl.exitAfterDays ?? 0) > 0 ? `Exit +${tl.exitAfterDays}d` : null,
            ].filter(Boolean).join(" · ");

            return (
              <Card key={plan.id} data-testid={`card-broker-link-${plan.id}`} className={`border-l-4 ${borderCls}`}>
                <CardHeader className="px-3 pt-3 pb-2">
                  <div className="flex flex-wrap items-center gap-2" data-testid={`text-broker-plan-name-${plan.id}`}>
                    <span className="text-base font-bold leading-tight">{plan.name}</span>
                    {isDeployed && <Badge className={`text-xs ${badgeCls}`}>{depConfig.label}</Badge>}
                    {plan.brokerConfigId && <Badge variant="secondary" className="text-xs"><Link2 className="w-3 h-3 mr-1" />Linked</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Config: {getConfigName(plan.configId)}{plan.exchange && <> · {plan.exchange}</>}{plan.ticker && <> / {plan.ticker}</>}
                  </p>
                  {plan.description && (
                    <p className="text-sm text-muted-foreground" data-testid={`text-broker-plan-desc-${plan.id}`}>{plan.description}</p>
                  )}
                  {(effectiveMultiplier > 1 || (effectiveSL != null && effectiveSL > 0) || (effectivePT != null && effectivePT > 0)) && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {effectiveMultiplier > 1 && <Badge variant="outline" className="text-xs text-blue-400 border-blue-400/30">{effectiveMultiplier}x Lots</Badge>}
                      {effectiveSL != null && effectiveSL > 0 && <Badge variant="outline" className="text-xs text-red-400 border-red-400/30">SL: {effectiveSL}</Badge>}
                      {effectivePT != null && effectivePT > 0 && <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30">PT: {effectivePT}</Badge>}
                    </div>
                  )}
                  {isDeployed && (() => {
                    const parentVersion = parentConfig?.configVersion || 1;
                    const deployedVersion = plan.deployedConfigVersion || 1;
                    return parentVersion > deployedVersion ? (
                      <div className="flex items-center gap-1 mt-1" data-testid={`badge-new-version-${plan.id}`}>
                        <AlertTriangle className="w-3 h-3 text-amber-400" />
                        <span className="text-xs text-amber-400 font-medium">New Version Available (v{parentVersion}) — Archive & Re-deploy to update</span>
                      </div>
                    ) : null;
                  })()}
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-2 pt-0">
                  {/* ── Section 2: Strategy Configuration (collapsible) ── */}
                  {blockGroups.length > 0 && (
                    <div className="border border-border/30 rounded-lg overflow-hidden">
                      <button
                        className="flex items-center justify-between w-full px-3 py-2 text-xs hover:bg-muted/30 transition-colors"
                        onClick={() => setExpandedStrategyConfigs(prev => { const next = new Set(prev); next.has(plan.id) ? next.delete(plan.id) : next.add(plan.id); return next; })}
                        data-testid={`button-toggle-strategy-config-${plan.id}`}
                      >
                        <span className="font-semibold uppercase tracking-widest text-[10px] text-muted-foreground">Strategy Configuration</span>
                        <span className="flex items-center gap-2">
                          {!isStrategyConfigExpanded && strategyConfigSummary && (
                            <span className="text-[10px] text-muted-foreground/70 font-normal normal-case tracking-normal">{strategyConfigSummary}</span>
                          )}
                          {isStrategyConfigExpanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                        </span>
                      </button>
                      {isStrategyConfigExpanded && (
                        <div className="px-3 pb-3 pt-1 bg-muted/20 space-y-2">
                          {(chainP || chainMc || chainTps) && (
                            <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                              {chainP && <><span className="text-amber-500">{chainP}</span><ChevronRight className="w-3 h-3" /></>}
                              {chainMc && <><span className="text-blue-500">{chainMc}</span><ChevronRight className="w-3 h-3" /></>}
                              {chainTps && <span className="text-emerald-500">{chainTps}</span>}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                            {blockGroups.map((g, i) => (
                              <span key={g.label} className="flex items-center gap-1">
                                {i > 0 && <span className="text-muted-foreground/40">·</span>}
                                <span className={`font-medium ${g.color}`}>{g.label} ({g.productMode}):</span>
                                <span className="font-mono text-foreground">{g.legs.map((l) => `${l.action} ${l.type} ${l.strike} x${l.lots || 1}`).join(", ")}</span>
                              </span>
                            ))}
                          </div>
                          {(tp.stoploss?.enabled || tl.exitTime || (tl.exitAfterDays ?? 0) > 0 || tl.exitOnExpiry) && (
                            <div className="flex flex-wrap gap-1.5">
                              {tp.stoploss?.enabled && <span className="text-xs text-amber-400 bg-amber-400/10 rounded px-2 py-0.5">SL: {tp.stoploss.value}{tp.stoploss.mode === "percentage" ? "%" : ""}</span>}
                              {tl.exitTime && <span className="text-xs text-amber-400 bg-amber-400/10 rounded px-2 py-0.5">Exit @ {tl.exitTime}</span>}
                              {tl.exitOnExpiry && <span className="text-xs text-amber-400 bg-amber-400/10 rounded px-2 py-0.5">{expiryLabel}</span>}
                              {(tl.exitAfterDays ?? 0) > 0 && <span className="text-xs text-amber-400 bg-amber-400/10 rounded px-2 py-0.5">Exit +{tl.exitAfterDays}d</span>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Section 3: Broker + Controls ── */}
                  {isDeployed ? (
                    <div className="flex flex-wrap items-center gap-2 border border-border/40 rounded-lg px-3 py-2 bg-muted/30">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Broker</p>
                        <p className="text-xs font-semibold truncate">
                          {linkedBroker ? `${linkedBroker.name || linkedBroker.brokerName}${linkedBroker.ucc ? ` (${linkedBroker.ucc})` : ""}` : "—"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5" data-testid={`container-deployment-actions-${plan.id}`}>
                        {actions.map((a) => {
                          const ActionIcon = a.icon;
                          const isSquareOff = a.action === "squared_off";
                          const onClick = a.action === "deployed" && canRedeploy ? () => initDeployConfig(plan) : () => handleDeploymentAction(plan.id, a.action);
                          return (
                            <Button
                              key={a.action}
                              size="sm"
                              variant={isSquareOff ? "outline" : a.variant}
                              className={isSquareOff ? "border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white" : ""}
                              onClick={onClick}
                              disabled={deploymentMutation.isPending}
                              data-testid={`button-${a.action}-${plan.id}`}
                            >
                              <ActionIcon className="w-3 h-3 mr-1" />{a.label}
                            </Button>
                          );
                        })}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPnlSheetPlanId(plan.id)}
                          data-testid={`button-daily-pnl-${plan.id}`}
                        >
                          <BarChart3 className="w-3 h-3 mr-1" />P&L Log
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <Label className="text-xs">Broker Configuration</Label>
                        <Select value={state.brokerConfigId} onValueChange={(v) => updateLocalState(plan.id, "brokerConfigId", v)} disabled={isDeployed}>
                          <SelectTrigger data-testid={`select-broker-${plan.id}`}><SelectValue placeholder="Select broker" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {brokerConfigs.map((bc) => (
                              <SelectItem key={bc.id} value={bc.id}>{bc.name || bc.brokerName} {bc.ucc ? `(${bc.ucc})` : ""}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-2">
                          <Switch checked={state.isProxyMode} onCheckedChange={(v) => updateLocalState(plan.id, "isProxyMode", v)} disabled={isDeployed} data-testid={`switch-proxy-${plan.id}`} />
                          <Label className="text-xs cursor-pointer">Proxy Mode</Label>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleLink(plan.id)} disabled={linkMutation.isPending} data-testid={`button-link-${plan.id}`}>
                            {linkMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Link2 className="w-3 h-3 mr-1" />}Link
                          </Button>
                          {plan.brokerConfigId && (
                            <Button variant="outline" size="sm" onClick={() => handleUnlink(plan.id)} disabled={linkMutation.isPending} data-testid={`button-unlink-${plan.id}`}>Unlink</Button>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {blockGroups.length > 0 && (
                    <div className="border-t border-border/40 pt-3" data-testid={`container-field-correlation-${plan.id}`}>
                      <button
                        className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                        onClick={() => setExpandedCorrelationMaps(prev => { const next = new Set(prev); next.has(plan.id) ? next.delete(plan.id) : next.add(plan.id); return next; })}
                        data-testid={`button-toggle-correlation-${plan.id}`}
                      >
                        <span>Field Correlation Map</span>
                        {isCorrelationExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                      {isCorrelationExpanded && (
                        <div className="overflow-x-auto mt-2">
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
                                  const params = buildBrokerOrderParams(leg, { exchange: parentConfig?.exchange, ticker: parentConfig?.ticker, productMode: group.productMode as "MIS" | "NRML" });
                                  return (
                                    <tr key={`${group.label}-${i}`} className="border-b border-border/20">
                                      {i === 0 && <td className={`px-2 py-1.5 font-medium ${group.color}`} rowSpan={group.legs.length}>{group.label}</td>}
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
                      )}
                    </div>
                  )}

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

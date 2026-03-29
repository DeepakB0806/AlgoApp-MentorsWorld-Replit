import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, Edit, Settings, Link2, Loader2, Save, Clock, Shield, Target, TrendingUp, Info, CalendarIcon, ChevronRight } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { StrategyConfig, StrategyPlan, Webhook } from "@shared/schema";
import type { PlanTradeLeg, TradeParams, BlockConfig, StoplossConfig, ProfitTargetConfig, TrailingStoplossConfig, TimeLogicConfig } from "@shared/schema";
import type { BrokerConfig } from "@shared/schema";

function generateStrikeOptions(): string[] {
  const strikes: string[] = [];
  for (let i = 14; i >= 1; i--) strikes.push(`ITM ${i}`);
  strikes.push("ATM");
  for (let i = 1; i <= 14; i++) strikes.push(`OTM ${i}`);
  return strikes;
}

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="w-3 h-3 text-muted-foreground inline-block ml-1 cursor-help" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] text-xs leading-relaxed">
          <p>{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function parseJsonSafe<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

export function TradePlanning() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<StrategyPlan | null>(null);
  const [planName, setPlanName] = useState("");
  const [planDescription, setPlanDescription] = useState("");
  const [configId, setConfigId] = useState("");
  const [planIndicators, setPlanIndicators] = useState<string[]>([]);
  const [planStatus, setPlanStatus] = useState("draft");
  const [planExchange, setPlanExchange] = useState("");
  const [planTicker, setPlanTicker] = useState("");
  const [uptrendLegs, setUptrendLegs] = useState<PlanTradeLeg[]>([]);
  const [downtrendLegs, setDowntrendLegs] = useState<PlanTradeLeg[]>([]);
  const [neutralLegs, setNeutralLegs] = useState<PlanTradeLeg[]>([]);
  const defaultBlockConfig: BlockConfig = { productMode: "NRML", priceMode: "LMT" };
  const [uptrendConfig, setUptrendConfig] = useState<BlockConfig>(defaultBlockConfig);
  const [downtrendConfig, setDowntrendConfig] = useState<BlockConfig>(defaultBlockConfig);
  const [neutralConfig, setNeutralConfig] = useState<BlockConfig>(defaultBlockConfig);
  const [stoploss, setStoploss] = useState<StoplossConfig>({ enabled: false, mode: "amount", value: 0 });
  const [profitTarget, setProfitTarget] = useState<ProfitTargetConfig>({ enabled: false, mode: "amount", value: 0 });
  const [trailingSL, setTrailingSL] = useState<TrailingStoplossConfig>({ enabled: false, activateAt: 0, lockProfitAt: 0, whenProfitIncreaseBy: 0, increaseTslBy: 0 });
  const [timeLogic, setTimeLogic] = useState<TimeLogicConfig>({ exitTime: "", exitOnExpiry: false, exitAfterDays: 0 });

  const { data: plans = [], isLoading } = useQuery<StrategyPlan[]>({
    queryKey: ["/api/strategy-plans"],
  });

  const { data: configs = [] } = useQuery<StrategyConfig[]>({
    queryKey: ["/api/strategy-configs"],
  });

  const { data: brokerConfigs = [] } = useQuery<BrokerConfig[]>({
    queryKey: ["/api/broker-configs"],
  });

  const { data: webhooks = [] } = useQuery<Webhook[]>({
    queryKey: ["/api/webhooks"],
  });

  const activeConfigs = configs.filter((c) => c.status === "active" || c.status === "draft");
  const selectedConfig = configs.find((c) => c.id === configId);
  const allLegsFlat = [...uptrendLegs, ...downtrendLegs, ...neutralLegs];
  const hasMISLegs = uptrendConfig.productMode === "MIS";

  useEffect(() => {
    if (selectedConfig && !editingPlan) {
      setPlanIndicators(selectedConfig.indicators || []);
      if (!planExchange) setPlanExchange((selectedConfig as any).exchange || "");
      if (!planTicker) setPlanTicker((selectedConfig as any).ticker || "");
    }
  }, [selectedConfig, editingPlan]);

  useEffect(() => {
    const expType = timeLogic.expiryType || "weekly";
    if (expType === "weekly") {
      const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
      const startIdx = days.indexOf(timeLogic.weeklyStartDay || "Monday");
      const endIdx = days.indexOf(timeLogic.weeklyEndDay || "Thursday");
      if (startIdx >= 0 && endIdx >= 0) {
        const span = endIdx >= startIdx ? endIdx - startIdx : 5 - startIdx + endIdx;
        setTimeLogic((s) => ({ ...s, exitAfterDays: span }));
      }
    } else if (expType === "monthly") {
      if (timeLogic.monthlyExpiryDate && timeLogic.monthStartDate) {
        try {
          const expiryDate = new Date(timeLogic.monthlyExpiryDate);
          const startDate = new Date(expiryDate.getFullYear(), expiryDate.getMonth(), timeLogic.monthStartDate);
          const daysDiff = differenceInDays(expiryDate, startDate);
          setTimeLogic((s) => ({ ...s, exitAfterDays: daysDiff > 0 ? daysDiff : 30 }));
        } catch {
          setTimeLogic((s) => ({ ...s, exitAfterDays: 30 }));
        }
      } else {
        setTimeLogic((s) => ({ ...s, exitAfterDays: 30 }));
      }
    }
  }, [timeLogic.expiryType, timeLogic.weeklyStartDay, timeLogic.weeklyEndDay, timeLogic.monthStartDate, timeLogic.monthlyExpiryDate]);

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return apiRequest("POST", "/api/strategy-plans", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-plans"] });
      closeDialog();
      toast({ title: "Plan created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create plan", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      return apiRequest("PATCH", `/api/strategy-plans/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-plans"] });
      closeDialog();
      toast({ title: "Plan updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update plan", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/strategy-plans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-plans"] });
      toast({ title: "Plan deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete plan", variant: "destructive" });
    },
  });

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingPlan(null);
    setPlanName("");
    setPlanDescription("");
    setConfigId("");
    setPlanIndicators([]);
    setPlanStatus("draft");
    setPlanExchange("");
    setPlanTicker("");
    setUptrendLegs([]);
    setDowntrendLegs([]);
    setNeutralLegs([]);
    setUptrendConfig({ productMode: "NRML", priceMode: "LMT" });
    setDowntrendConfig({ productMode: "NRML", priceMode: "LMT" });
    setNeutralConfig({ productMode: "NRML", priceMode: "LMT" });
    setStoploss({ enabled: false, mode: "amount", value: 0 });
    setProfitTarget({ enabled: false, mode: "amount", value: 0 });
    setTrailingSL({ enabled: false, activateAt: 0, lockProfitAt: 0, whenProfitIncreaseBy: 0, increaseTslBy: 0 });
    setTimeLogic({ exitTime: "", exitOnExpiry: false, exitAfterDays: 0 });
  };

  const handleEdit = (plan: StrategyPlan) => {
    setEditingPlan(plan);
    setPlanName(plan.name);
    setPlanDescription(plan.description || "");
    setConfigId(plan.configId);
    setPlanIndicators(plan.selectedIndicators || []);
    setPlanStatus(plan.status);
    setPlanExchange(plan.exchange || "");
    setPlanTicker(plan.ticker || "");
    const tp = parseJsonSafe<TradeParams>(plan.tradeParams, { legs: [], uptrendLegs: [], downtrendLegs: [], neutralLegs: [] });
    const loadedUptrend = tp.uptrendLegs || tp.legs || [];
    const loadedDowntrend = tp.downtrendLegs || [];
    const loadedNeutral = tp.neutralLegs || [];
    setUptrendLegs(loadedUptrend);
    setDowntrendLegs(loadedDowntrend);
    setNeutralLegs(loadedNeutral);
    const deriveMode = (legs: PlanTradeLeg[]): "MIS" | "NRML" => {
      if (legs.length > 0 && legs.every((l) => l.orderType === "NRML")) return "NRML";
      return "MIS";
    };
    setUptrendConfig(tp.uptrendConfig ? { priceMode: "LMT", ...tp.uptrendConfig } : { productMode: deriveMode(loadedUptrend), priceMode: "LMT" });
    setDowntrendConfig(tp.downtrendConfig ? { priceMode: "LMT", ...tp.downtrendConfig } : { productMode: deriveMode(loadedDowntrend), priceMode: "LMT" });
    setNeutralConfig(tp.neutralConfig ? { priceMode: "LMT", ...tp.neutralConfig } : { productMode: deriveMode(loadedNeutral), priceMode: "LMT" });
    setStoploss(tp.stoploss || { enabled: false, mode: "amount", value: 0 });
    setProfitTarget(tp.profitTarget || { enabled: false, mode: "amount", value: 0 });
    setTrailingSL(tp.trailingSL || { enabled: false, activateAt: 0, lockProfitAt: 0, whenProfitIncreaseBy: 0, increaseTslBy: 0 });
    setTimeLogic(tp.timeLogic || { exitTime: "", exitOnExpiry: false, exitAfterDays: 0 });
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    if (!planName.trim()) {
      toast({ title: "Plan name is required", variant: "destructive" });
      return;
    }
    if (!configId) {
      toast({ title: "Select a parent configuration", variant: "destructive" });
      return;
    }
    const payload = {
      name: planName.trim(),
      description: planDescription.trim() || null,
      configId,
      selectedIndicators: planIndicators,
      tradeParams: JSON.stringify({ legs: [], uptrendLegs, downtrendLegs, neutralLegs, uptrendConfig, downtrendConfig, neutralConfig, stoploss, profitTarget, trailingSL, timeLogic }),
      status: planStatus,
      exchange: planExchange || null,
      ticker: planTicker || null,
    };
    if (editingPlan) {
      updateMutation.mutate({ id: editingPlan.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const getConfigName = (cId: string) => {
    const c = configs.find((cfg) => cfg.id === cId);
    return c ? c.name : "Unknown";
  };

  const getPlanChain = (plan: StrategyPlan): { p?: string | null; mc?: string | null; tps?: string | null } => {
    const config = configs.find((c) => c.id === plan.configId);
    const webhook = config ? webhooks.find((w) => w.id === config.webhookId) : undefined;
    return {
      p: webhook?.uniqueCode ? `P-${webhook.uniqueCode}` : undefined,
      mc: config?.uniqueCode,
      tps: plan.uniqueCode,
    };
  };

  const getBrokerName = (bId: string | null | undefined) => {
    if (!bId) return null;
    const b = brokerConfigs.find((bc) => bc.id === bId);
    return b ? (b.name || b.brokerName) : "Unknown";
  };

  const toggleIndicator = (indicator: string) => {
    const parentIndicators = selectedConfig?.indicators || [];
    if (!parentIndicators.includes(indicator)) return;
    setPlanIndicators((prev) =>
      prev.includes(indicator) ? prev.filter((i) => i !== indicator) : [...prev, indicator]
    );
  };

  const getStatusVariant = (s: string) => {
    if (s === "active") return "default" as const;
    if (s === "paused") return "secondary" as const;
    return "outline" as const;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold" data-testid="text-plans-title">Trade Plans</h2>
        <Button onClick={() => setIsDialogOpen(true)} data-testid="button-new-plan">
          <Plus className="w-4 h-4 mr-2" />
          New Plan
        </Button>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); else setIsDialogOpen(true); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-plan-form-title">
              {editingPlan ? "Edit Plan" : "New Plan"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Parent Configuration</Label>
              <Select value={configId} onValueChange={(v) => { setConfigId(v); setUptrendLegs([]); setDowntrendLegs([]); setNeutralLegs([]); setStoploss({ enabled: false, mode: "amount", value: 0 }); setProfitTarget({ enabled: false, mode: "amount", value: 0 }); setTrailingSL({ enabled: false, activateAt: 0, lockProfitAt: 0, whenProfitIncreaseBy: 0, increaseTslBy: 0 }); setTimeLogic({ exitTime: "", exitOnExpiry: false, exitAfterDays: 0 }); }}>
                <SelectTrigger data-testid="select-plan-config">
                  <SelectValue placeholder="Select configuration" />
                </SelectTrigger>
                <SelectContent>
                  {activeConfigs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.status === "draft" ? " (Draft)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Plan Name</Label>
              <Input
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder="Plan name"
                data-testid="input-plan-name"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={planDescription}
                onChange={(e) => setPlanDescription(e.target.value)}
                placeholder="Optional description"
                data-testid="input-plan-description"
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={planStatus} onValueChange={setPlanStatus}>
                <SelectTrigger data-testid="select-plan-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* --- GLOBAL STRATEGY COMMAND CENTER --- */}
            <div className="flex flex-col gap-4 mb-2 p-4 bg-primary/5 rounded-xl border border-primary/10 shadow-sm">
              {/* Row 1: Exchange | Ticker / Symbol */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Exchange</Label>
                  <Select value={planExchange || "auto"} onValueChange={(v) => setPlanExchange(v === "auto" ? "" : v)}>
                    <SelectTrigger data-testid="select-plan-exchange">
                      <SelectValue placeholder="Auto-detect" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto-detect</SelectItem>
                      <SelectItem value="NSE">NSE (National Stock Exchange)</SelectItem>
                      <SelectItem value="BSE">BSE (Bombay Stock Exchange)</SelectItem>
                      <SelectItem value="NFO">NFO (NSE Futures & Options)</SelectItem>
                      <SelectItem value="BFO">BFO (BSE Futures & Options)</SelectItem>
                      <SelectItem value="MCX">MCX (Multi Commodity Exchange)</SelectItem>
                      <SelectItem value="CDS">CDS (Currency Derivatives)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ticker / Symbol</Label>
                  <Select value={planTicker || "auto"} onValueChange={(v) => setPlanTicker(v === "auto" ? "" : v)}>
                    <SelectTrigger data-testid="select-plan-ticker">
                      <SelectValue placeholder="Auto-detect" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto-detect</SelectItem>
                      <SelectItem value="NIFTY">NIFTY</SelectItem>
                      <SelectItem value="BANKNIFTY">BANKNIFTY</SelectItem>
                      <SelectItem value="FINNIFTY">FINNIFTY</SelectItem>
                      <SelectItem value="MIDCPNIFTY">MIDCPNIFTY</SelectItem>
                      <SelectItem value="SENSEX">SENSEX</SelectItem>
                      <SelectItem value="BANKEX">BANKEX</SelectItem>
                      <SelectItem value="CRUDEOIL">CRUDEOIL</SelectItem>
                      <SelectItem value="GOLD">GOLD</SelectItem>
                      <SelectItem value="SILVER">SILVER</SelectItem>
                      <SelectItem value="USDINR">USDINR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* Row 2: Product Type | Execution Mode */}
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-primary/10">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-primary/70">Product Type (Strategy Wide)</Label>
                  <Select
                    value={uptrendConfig.productMode || "NRML"}
                    onValueChange={(v) => {
                      const mode = v as "MIS" | "NRML";
                      const update = (prev: BlockConfig) => ({
                        ...prev,
                        productMode: mode,
                        bracketOrder: mode === "NRML" ? undefined : prev.bracketOrder,
                      });
                      setUptrendConfig(update);
                      setDowntrendConfig(update);
                      setNeutralConfig(update);
                    }}
                  >
                    <SelectTrigger className="w-full h-10 bg-background border-primary/20 font-semibold" data-testid="select-strategy-product-mode">
                      <SelectValue placeholder="NRML / MIS" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NRML">NRML (Overnight / Standard)</SelectItem>
                      <SelectItem value="MIS">MIS (Intraday / Margin)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-primary/70">Execution Mode (SEBI Compliant)</Label>
                  <Select
                    value={uptrendConfig.priceMode || "LMT"}
                    onValueChange={(v) => {
                      const mode = v as "LMT" | "MKT";
                      const update = (prev: BlockConfig) => ({ ...prev, priceMode: mode });
                      setUptrendConfig(update);
                      setDowntrendConfig(update);
                      setNeutralConfig(update);
                    }}
                  >
                    <SelectTrigger className="w-full h-10 bg-background border-primary/20 font-semibold" data-testid="select-strategy-price-mode">
                      <SelectValue placeholder="LMT / MKT" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LMT">LMT (Buffered Limit - Safe)</SelectItem>
                      <SelectItem value="MKT">MKT (Market Order - Unsafe)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            {selectedConfig && selectedConfig.indicators && selectedConfig.indicators.length > 0 && (
              <div>
                <Label className="mb-2 block">Indicators (from parent config)</Label>
                <div className="flex flex-wrap gap-2" data-testid="container-plan-indicators">
                  {selectedConfig.indicators.map((ind) => (
                    <Badge
                      key={ind}
                      className={`cursor-pointer select-none toggle-elevate ${
                        planIndicators.includes(ind) ? "toggle-elevated bg-emerald-600 text-white" : ""
                      }`}
                      variant={planIndicators.includes(ind) ? "default" : "outline"}
                      onClick={() => toggleIndicator(ind)}
                      data-testid={`badge-plan-indicator-${ind.replace(/\s+/g, "-").toLowerCase()}`}
                    >
                      {ind}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {configId && (
              <div className="space-y-4">
                <Label>Execution Blocks</Label>
                {([
                  { key: "uptrend" as const, label: "UPTREND BLOCK", legs: uptrendLegs, setter: setUptrendLegs, config: uptrendConfig, configSetter: setUptrendConfig, borderColor: "border-emerald-500", textColor: "text-emerald-400" },
                  { key: "downtrend" as const, label: "DOWNTREND BLOCK", legs: downtrendLegs, setter: setDowntrendLegs, config: downtrendConfig, configSetter: setDowntrendConfig, borderColor: "border-red-500", textColor: "text-red-400" },
                  { key: "neutral" as const, label: "NEUTRAL BLOCK", legs: neutralLegs, setter: setNeutralLegs, config: neutralConfig, configSetter: setNeutralConfig, borderColor: "border-blue-500", textColor: "text-blue-400" },
                ] as const).map((block) => (
                  <div key={block.key} className={`border-2 ${block.borderColor} rounded-md p-3 space-y-2`} data-testid={`card-plan-block-${block.key}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <h4 className={`font-bold text-xs ${block.textColor}`}>{block.label}</h4>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => block.setter((prev: PlanTradeLeg[]) => [...prev, { type: "CE", action: "BUY", strike: "ATM", lots: 1 }])}
                        data-testid={`button-add-plan-leg-${block.key}`}
                      >
                        <Plus className="w-3 h-3 mr-1" /> Add Leg
                      </Button>
                    </div>
                    {block.legs.length === 0 && (
                      <p className="text-xs text-muted-foreground">No legs configured for {block.key} condition.</p>
                    )}
                    <div className="space-y-2">
                      {block.legs.map((leg, idx) => (
                        <div key={idx} className="flex items-center gap-2 flex-wrap p-2 rounded-md border border-border/50 bg-muted/30" data-testid={`leg-plan-${block.key}-${idx}`}>
                          <span className="text-xs text-muted-foreground w-4">#{idx + 1}</span>
                          <Select value={leg.type} onValueChange={(v) => block.setter((prev: PlanTradeLeg[]) => prev.map((l, i) => i === idx ? { ...l, type: v as PlanTradeLeg["type"] } : l))}>
                            <SelectTrigger className="w-20" data-testid={`select-plan-leg-type-${block.key}-${idx}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="CE">CE</SelectItem>
                              <SelectItem value="PE">PE</SelectItem>
                              <SelectItem value="FUT">FUT</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select value={leg.action} onValueChange={(v) => block.setter((prev: PlanTradeLeg[]) => prev.map((l, i) => i === idx ? { ...l, action: v as PlanTradeLeg["action"] } : l))}>
                            <SelectTrigger className="w-20" data-testid={`select-plan-leg-action-${block.key}-${idx}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="BUY">BUY</SelectItem>
                              <SelectItem value="SELL">SELL</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select value={leg.strike} onValueChange={(v) => block.setter((prev: PlanTradeLeg[]) => prev.map((l, i) => i === idx ? { ...l, strike: v } : l))}>
                            <SelectTrigger className="w-24" data-testid={`select-plan-leg-strike-${block.key}-${idx}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {generateStrikeOptions().map((s) => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            min={1}
                            value={leg.lots}
                            onChange={(e) => block.setter((prev: PlanTradeLeg[]) => prev.map((l, i) => i === idx ? { ...l, lots: parseInt(e.target.value) || 1 } : l))}
                            className="w-16"
                            data-testid={`input-plan-leg-lots-${block.key}-${idx}`}
                          />
                          <span className="text-xs text-muted-foreground">lots</span>
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Input
                                  type="number"
                                  min={0}
                                  step={0.1}
                                  placeholder="SL%"
                                  value={leg.slPercent ?? ""}
                                  onChange={(e) => block.setter((prev: PlanTradeLeg[]) => prev.map((l, i) => i === idx ? { ...l, slPercent: e.target.value ? parseFloat(e.target.value) : undefined } : l))}
                                  className="w-16"
                                  data-testid={`input-plan-leg-sl-${block.key}-${idx}`}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="top"><p>StopLoss %</p></TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Input
                                  type="number"
                                  min={0}
                                  step={0.1}
                                  placeholder="P%"
                                  value={leg.profitPercent ?? ""}
                                  onChange={(e) => block.setter((prev: PlanTradeLeg[]) => prev.map((l, i) => i === idx ? { ...l, profitPercent: e.target.value ? parseFloat(e.target.value) : undefined } : l))}
                                  className="w-16"
                                  data-testid={`input-plan-leg-profit-${block.key}-${idx}`}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="top"><p>Profit %</p></TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => block.setter((prev: PlanTradeLeg[]) => prev.filter((_, i) => i !== idx))}
                            data-testid={`button-remove-plan-leg-${block.key}-${idx}`}
                          >
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    {block.config.productMode === "MIS" && (
                      <div className="border border-border/50 rounded-md p-2 space-y-2 bg-muted/20">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Target className="w-3 h-3 text-orange-400" />
                            <span className="text-xs font-medium">Bracket Order</span>
                            <InfoTip text="Bracket Order places 3 legs: Entry + Stoploss + Target. MIS only. Uses absolute price spreads." />
                          </div>
                          <Switch
                            checked={block.config.bracketOrder?.enabled || false}
                            onCheckedChange={(v) => block.configSetter((prev) => ({ ...prev, bracketOrder: { enabled: v, stoplossSpread: prev.bracketOrder?.stoplossSpread, targetSpread: prev.bracketOrder?.targetSpread, trailingSL: prev.bracketOrder?.trailingSL } }))}
                            data-testid={`switch-bo-${block.key}`}
                          />
                        </div>
                        {block.config.bracketOrder?.enabled && (
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="flex items-center gap-1">
                              <Label className="text-xs whitespace-nowrap">SL Spread</Label>
                              <Input
                                type="number"
                                min={0}
                                step={0.05}
                                placeholder="0.00"
                                value={block.config.bracketOrder.stoplossSpread ?? ""}
                                onChange={(e) => block.configSetter((prev) => ({ ...prev, bracketOrder: { ...prev.bracketOrder!, stoplossSpread: e.target.value ? parseFloat(e.target.value) : undefined } }))}
                                className="w-20"
                                data-testid={`input-bo-sl-spread-${block.key}`}
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <Label className="text-xs whitespace-nowrap">Target Spread</Label>
                              <Input
                                type="number"
                                min={0}
                                step={0.05}
                                placeholder="0.00"
                                value={block.config.bracketOrder.targetSpread ?? ""}
                                onChange={(e) => block.configSetter((prev) => ({ ...prev, bracketOrder: { ...prev.bracketOrder!, targetSpread: e.target.value ? parseFloat(e.target.value) : undefined } }))}
                                className="w-20"
                                data-testid={`input-bo-target-spread-${block.key}`}
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <Label className="text-xs whitespace-nowrap">Trailing SL</Label>
                              <Input
                                type="number"
                                min={0}
                                step={0.05}
                                placeholder="0.00"
                                value={block.config.bracketOrder.trailingSL ?? ""}
                                onChange={(e) => block.configSetter((prev) => ({ ...prev, bracketOrder: { ...prev.bracketOrder!, trailingSL: e.target.value ? parseFloat(e.target.value) : undefined } }))}
                                className="w-20"
                                data-testid={`input-bo-trailing-sl-${block.key}`}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {configId && (
              <div className="space-y-4">
                <Label className="flex items-center gap-2"><Shield className="w-4 h-4" /> Exit & Risk Settings</Label>

                <div className="border border-border rounded-md p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Shield className="w-3 h-3 text-red-400" />
                      <span className="text-sm font-medium">Stoploss MTM</span>
                    </div>
                    <Switch
                      checked={stoploss.enabled}
                      onCheckedChange={(v) => setStoploss((s) => ({ ...s, enabled: v }))}
                      data-testid="switch-stoploss-enabled"
                    />
                  </div>
                  {stoploss.enabled && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Select value={stoploss.mode} onValueChange={(v) => setStoploss((s) => ({ ...s, mode: v as "amount" | "percentage" }))}>
                        <SelectTrigger className="w-32" data-testid="select-stoploss-mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="amount">Amount</SelectItem>
                          <SelectItem value="percentage">Percentage %</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        min={0}
                        step={stoploss.mode === "percentage" ? 0.1 : 1}
                        value={stoploss.value || ""}
                        onChange={(e) => setStoploss((s) => ({ ...s, value: parseFloat(e.target.value) || 0 }))}
                        placeholder={stoploss.mode === "percentage" ? "e.g. 2.5" : "e.g. 5000"}
                        className="w-32"
                        data-testid="input-stoploss-value"
                      />
                      <span className="text-xs text-muted-foreground">{stoploss.mode === "percentage" ? "%" : "INR"}</span>
                    </div>
                  )}
                </div>

                <div className="border border-border rounded-md p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Target className="w-3 h-3 text-emerald-400" />
                      <span className="text-sm font-medium">Profit MTM Target</span>
                    </div>
                    <Switch
                      checked={profitTarget.enabled}
                      onCheckedChange={(v) => setProfitTarget((s) => ({ ...s, enabled: v }))}
                      data-testid="switch-profit-enabled"
                    />
                  </div>
                  {profitTarget.enabled && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Select value={profitTarget.mode} onValueChange={(v) => setProfitTarget((s) => ({ ...s, mode: v as "amount" | "percentage" }))}>
                        <SelectTrigger className="w-32" data-testid="select-profit-mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="amount">Amount</SelectItem>
                          <SelectItem value="percentage">Percentage %</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        min={0}
                        step={profitTarget.mode === "percentage" ? 0.1 : 1}
                        value={profitTarget.value || ""}
                        onChange={(e) => setProfitTarget((s) => ({ ...s, value: parseFloat(e.target.value) || 0 }))}
                        placeholder={profitTarget.mode === "percentage" ? "e.g. 5.0" : "e.g. 10000"}
                        className="w-32"
                        data-testid="input-profit-value"
                      />
                      <span className="text-xs text-muted-foreground">{profitTarget.mode === "percentage" ? "%" : "INR"}</span>
                    </div>
                  )}
                </div>

                {hasMISLegs && (
                  <div className="border border-border rounded-md p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-3 h-3 text-blue-400" />
                        <span className="text-sm font-medium">Trailing Stoploss (MIS Only)</span>
                      </div>
                      <Switch
                        checked={trailingSL.enabled}
                        onCheckedChange={(v) => setTrailingSL((s) => ({ ...s, enabled: v }))}
                        data-testid="switch-tsl-enabled"
                      />
                    </div>
                    {trailingSL.enabled && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Activate At</Label>
                          <Input
                            type="number"
                            min={0}
                            value={trailingSL.activateAt || ""}
                            onChange={(e) => setTrailingSL((s) => ({ ...s, activateAt: parseFloat(e.target.value) || 0 }))}
                            placeholder="e.g. 2000"
                            data-testid="input-tsl-activate-at"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Lock Profit At</Label>
                          <Input
                            type="number"
                            min={0}
                            value={trailingSL.lockProfitAt || ""}
                            onChange={(e) => setTrailingSL((s) => ({ ...s, lockProfitAt: parseFloat(e.target.value) || 0 }))}
                            placeholder="e.g. 1000"
                            data-testid="input-tsl-lock-profit"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">When Profit Increase By</Label>
                          <Input
                            type="number"
                            min={0}
                            value={trailingSL.whenProfitIncreaseBy || ""}
                            onChange={(e) => setTrailingSL((s) => ({ ...s, whenProfitIncreaseBy: parseFloat(e.target.value) || 0 }))}
                            placeholder="e.g. 500"
                            data-testid="input-tsl-profit-increase"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Increase TSL By</Label>
                          <Input
                            type="number"
                            min={0}
                            value={trailingSL.increaseTslBy || ""}
                            onChange={(e) => setTrailingSL((s) => ({ ...s, increaseTslBy: parseFloat(e.target.value) || 0 }))}
                            placeholder="e.g. 250"
                            data-testid="input-tsl-increase-by"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="border border-border rounded-md p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-yellow-400" />
                    <span className="text-sm font-medium">Time Logic & Expiry</span>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Expiry Type
                      <InfoTip text="Select the contract expiry cycle. Weekly: current week's expiry (nearest upcoming). Next Week: following week's expiry (more time value, lower theta). Monthly: for instruments like BANKNIFTY that expire on the last trading day of each month. Custom: for Crypto/Forex with non-standard cycles." />
                    </Label>
                    <Select
                      value={((timeLogic.expiryType || "weekly") === "weekly" && timeLogic.expiryWeekOffset === 1) ? "next_week" : (timeLogic.expiryType || "weekly")}
                      onValueChange={(v) => {
                        if (v === "next_week") {
                          setTimeLogic((s) => ({ ...s, expiryType: "weekly" as TimeLogicConfig["expiryType"], expiryWeekOffset: 1 }));
                        } else if (v === "weekly") {
                          setTimeLogic((s) => ({ ...s, expiryType: "weekly" as TimeLogicConfig["expiryType"], expiryWeekOffset: 0 }));
                        } else {
                          setTimeLogic((s) => ({ ...s, expiryType: v as TimeLogicConfig["expiryType"] }));
                        }
                      }}
                    >
                      <SelectTrigger data-testid="select-expiry-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="next_week">Next Week</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {(timeLogic.expiryType === "weekly" || !timeLogic.expiryType) && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Start Day
                            <InfoTip text="The day a new weekly contract cycle begins. For NIFTY: Wednesday (the day after previous Tuesday expiry)." />
                          </Label>
                          <Select value={timeLogic.weeklyStartDay || "Monday"} onValueChange={(v) => setTimeLogic((s) => ({ ...s, weeklyStartDay: v }))}>
                            <SelectTrigger data-testid="select-weekly-start-day">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((d) => (
                                <SelectItem key={d} value={d}>{d}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            End Day
                            <InfoTip text="The last day of the week your strategy is active. For an expiry-day-only strategy on NIFTY, set this to Tuesday. Use the Expiry Type above to choose current or next week's contract." />
                          </Label>
                          <Select value={timeLogic.weeklyEndDay || "Thursday"} onValueChange={(v) => setTimeLogic((s) => ({ ...s, weeklyEndDay: v }))}>
                            <SelectTrigger data-testid="select-weekly-end-day">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((d) => (
                                <SelectItem key={d} value={d}>{d}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </>
                  )}

                  {timeLogic.expiryType === "monthly" && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Monthly Start Date
                            <InfoTip text="The date each month when your strategy begins tracking a new monthly contract. Usually the 1st of the month." />
                          </Label>
                          <Input
                            type="number"
                            min={1}
                            max={28}
                            value={timeLogic.monthStartDate || ""}
                            onChange={(e) => setTimeLogic((s) => ({ ...s, monthStartDate: parseInt(e.target.value) || undefined }))}
                            placeholder="e.g. 1"
                            data-testid="input-month-start-date"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Contract Selection
                            <InfoTip text="Which monthly contract to trade. 'Current' = this month's expiry. 'Next' = next month's expiry (more time value)." />
                          </Label>
                          <Select value={String(timeLogic.expiryWeekOffset || 0)} onValueChange={(v) => setTimeLogic((s) => ({ ...s, expiryWeekOffset: parseInt(v) }))}>
                            <SelectTrigger data-testid="select-monthly-expiry-offset">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">Current month expiry</SelectItem>
                              <SelectItem value="1">Next month expiry</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Monthly Expiry Date
                          <InfoTip text="Select the exact expiry date for the monthly contract from the calendar. BANKNIFTY expires on the last trading day of the month. Verify against the NSE holiday calendar to avoid non-trading days." />
                        </Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-start text-left font-normal"
                              data-testid="button-monthly-expiry-calendar"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {timeLogic.monthlyExpiryDate
                                ? format(new Date(timeLogic.monthlyExpiryDate), "dd MMM yyyy")
                                : "Select expiry date"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={timeLogic.monthlyExpiryDate ? new Date(timeLogic.monthlyExpiryDate) : undefined}
                              onSelect={(date) => {
                                if (date) {
                                  setTimeLogic((s) => ({ ...s, monthlyExpiryDate: format(date, "yyyy-MM-dd") }));
                                }
                              }}
                              disabled={(date) => date.getDay() === 0 || date.getDay() === 6}
                              data-testid="calendar-monthly-expiry"
                            />
                          </PopoverContent>
                        </Popover>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Weekends are disabled. Verify the selected date is not an NSE holiday.
                        </p>
                      </div>
                    </>
                  )}

                  {timeLogic.expiryType === "custom" && (
                    <p className="text-xs text-muted-foreground">
                      Custom expiry: set exit days manually. For Crypto, Forex, or instruments without standard weekly/monthly cycles. Contract expiry dates must be managed outside the system.
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Exit Time (IST)
                        <InfoTip text="Time in IST (24hr format) to auto-exit positions on expiry day. Common: 15:15 (15 minutes before market close at 15:30)." />
                      </Label>
                      <Input
                        type="time"
                        value={timeLogic.exitTime}
                        onChange={(e) => setTimeLogic((s) => ({ ...s, exitTime: e.target.value }))}
                        data-testid="input-exit-time"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Exit After Days
                        <InfoTip text="Number of trading days from entry to auto-exit. Auto-calculated for weekly (from start/end days) and monthly (from start date to expiry date). Manual entry for custom only." />
                        {(timeLogic.expiryType || "weekly") !== "custom" && (
                          <span className="text-amber-400 ml-1">(auto)</span>
                        )}
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        value={timeLogic.exitAfterDays || ""}
                        onChange={(e) => setTimeLogic((s) => ({ ...s, exitAfterDays: parseInt(e.target.value) || 0 }))}
                        placeholder="e.g. 3"
                        disabled={(timeLogic.expiryType || "weekly") !== "custom"}
                        data-testid="input-exit-after-days"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Label className="text-sm">
                      Exit On Expiry
                      <InfoTip text="When ON, all open positions for this strategy are automatically squared off on the expiry day at the Exit Time above." />
                    </Label>
                    <Switch
                      checked={timeLogic.exitOnExpiry}
                      onCheckedChange={(v) => setTimeLogic((s) => ({ ...s, exitOnExpiry: v }))}
                      data-testid="switch-exit-on-expiry"
                    />
                  </div>
                </div>
              </div>
            )}

            <Button
              onClick={handleSave}
              disabled={!planName.trim() || !configId || createMutation.isPending || updateMutation.isPending}
              className="w-full"
              data-testid="button-save-plan"
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {editingPlan ? "Update Plan" : "Create Plan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : plans.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Settings className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Trade Plans</h3>
            <p className="text-muted-foreground mb-4">Create your first trade plan</p>
            <Button onClick={() => setIsDialogOpen(true)} data-testid="button-create-first-plan">
              <Plus className="w-4 h-4 mr-2" />
              Create Plan
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {plans.map((plan) => (
            <Card key={plan.id} data-testid={`card-plan-${plan.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 flex-wrap" data-testid={`text-plan-name-${plan.id}`}>
                      {plan.name}
                      <Badge variant={getStatusVariant(plan.status)} data-testid={`badge-plan-status-${plan.id}`}>
                        {plan.status}
                      </Badge>
                      {plan.uniqueCode && (
                        <Badge variant="outline" className="font-mono text-xs" data-testid={`badge-plan-code-${plan.id}`}>
                          {plan.uniqueCode}
                        </Badge>
                      )}
                    </CardTitle>
                    {(() => {
                      const chain = getPlanChain(plan);
                      if (!chain.mc && !chain.tps) return null;
                      return (
                        <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground" data-testid={`text-plan-chain-${plan.id}`}>
                          {chain.p && <><span className="text-amber-500">{chain.p}</span><ChevronRight className="w-3 h-3" /></>}
                          {chain.mc && <><span className="text-blue-500">{chain.mc}</span><ChevronRight className="w-3 h-3" /></>}
                          {chain.tps && <span className="text-emerald-500">{chain.tps}</span>}
                        </div>
                      );
                    })()}
                    <p className="text-sm text-muted-foreground">
                      Config: <span data-testid={`text-plan-config-${plan.id}`}>{getConfigName(plan.configId)}</span>
                      {plan.exchange && <span className="ml-2">{plan.exchange}</span>}
                      {plan.ticker && <span className="ml-1">/ {plan.ticker}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(plan)} data-testid={`button-edit-plan-${plan.id}`}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(plan.id)} data-testid={`button-delete-plan-${plan.id}`}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {plan.description && (
                    <p className="text-sm text-muted-foreground" data-testid={`text-plan-desc-${plan.id}`}>{plan.description}</p>
                  )}
                  {plan.selectedIndicators && plan.selectedIndicators.length > 0 && (
                    <div className="flex flex-wrap gap-1" data-testid={`container-plan-indicators-${plan.id}`}>
                      {plan.selectedIndicators.map((ind) => (
                        <Badge key={ind} variant="secondary" className="text-xs">{ind}</Badge>
                      ))}
                    </div>
                  )}
                  {plan.tradeParams && (() => {
                    const tp = parseJsonSafe<TradeParams>(plan.tradeParams, { legs: [], uptrendLegs: [], downtrendLegs: [], neutralLegs: [] });
                    const allLegs = [
                      ...(tp.uptrendLegs || []).length > 0 ? [{ label: "Uptrend", legs: tp.uptrendLegs!, color: "text-emerald-400", mode: `${tp.uptrendConfig?.productMode || "NRML"} ${tp.uptrendConfig?.priceMode || "LMT"}` }] : [],
                      ...(tp.downtrendLegs || []).length > 0 ? [{ label: "Downtrend", legs: tp.downtrendLegs!, color: "text-red-400", mode: `${tp.downtrendConfig?.productMode || "NRML"} ${tp.downtrendConfig?.priceMode || "LMT"}` }] : [],
                      ...(tp.neutralLegs || []).length > 0 ? [{ label: "Neutral", legs: tp.neutralLegs!, color: "text-blue-400", mode: `${tp.neutralConfig?.productMode || "NRML"} ${tp.neutralConfig?.priceMode || "LMT"}` }] : [],
                      ...(tp.legs || []).length > 0 ? [{ label: "Legs", legs: tp.legs, color: "text-muted-foreground", mode: "NRML LMT" }] : [],
                    ];
                    return allLegs.length > 0 ? (
                      <div className="space-y-1" data-testid={`container-plan-legs-${plan.id}`}>
                        {allLegs.map((group) => (
                          <div key={group.label} className="flex items-center gap-1 flex-wrap">
                            <span className={`text-xs font-medium ${group.color}`}>{group.label} ({group.mode}):</span>
                            {group.legs.map((leg, i) => (
                              <Badge key={i} variant="outline" className="text-xs font-mono">
                                {leg.action} {leg.type} {leg.strike} x{leg.lots}{leg.slPercent ? ` SL${leg.slPercent}%` : ""}{leg.profitPercent ? ` P${leg.profitPercent}%` : ""}
                              </Badge>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : null;
                  })()}
                  {plan.tradeParams && (() => {
                    const tp2 = parseJsonSafe<TradeParams>(plan.tradeParams, {} as TradeParams);
                    const exitBadges: { label: string; color: string }[] = [];
                    if (tp2.stoploss?.enabled) {
                      exitBadges.push({ label: `SL: ${tp2.stoploss.value}${tp2.stoploss.mode === "percentage" ? "%" : " INR"}`, color: "text-red-400" });
                    }
                    if (tp2.profitTarget?.enabled) {
                      exitBadges.push({ label: `Target: ${tp2.profitTarget.value}${tp2.profitTarget.mode === "percentage" ? "%" : " INR"}`, color: "text-emerald-400" });
                    }
                    if (tp2.trailingSL?.enabled) {
                      exitBadges.push({ label: "TSL Active", color: "text-blue-400" });
                    }
                    if (tp2.timeLogic?.exitTime) {
                      exitBadges.push({ label: `Exit @ ${tp2.timeLogic.exitTime}`, color: "text-yellow-400" });
                    }
                    if (tp2.timeLogic?.exitOnExpiry) {
                      const expType = tp2.timeLogic.expiryType || "weekly";
                      const weekOffset = tp2.timeLogic.expiryWeekOffset || 0;
                      const dayRange = `(${tp2.timeLogic.weeklyStartDay || "Mon"}-${tp2.timeLogic.weeklyEndDay || "Thu"})`;
                      const expLabel = expType === "weekly" && weekOffset === 1
                        ? `Expiry: Next Week ${dayRange}`
                        : expType === "weekly"
                        ? `Expiry: Weekly · Current ${dayRange}`
                        : expType === "monthly" ? "Expiry: Monthly"
                        : "Expiry: Custom";
                      exitBadges.push({ label: expLabel, color: "text-yellow-400" });
                    }
                    if (tp2.timeLogic?.exitAfterDays && tp2.timeLogic.exitAfterDays > 0) {
                      exitBadges.push({ label: `Exit +${tp2.timeLogic.exitAfterDays}d`, color: "text-yellow-400" });
                    }
                    return exitBadges.length > 0 ? (
                      <div className="flex items-center gap-1 flex-wrap" data-testid={`container-plan-exit-${plan.id}`}>
                        <Shield className="w-3 h-3 text-muted-foreground" />
                        {exitBadges.map((eb, i) => (
                          <Badge key={i} variant="outline" className={`text-xs font-mono ${eb.color}`}>{eb.label}</Badge>
                        ))}
                      </div>
                    ) : null;
                  })()}
                  {plan.brokerConfigId && (
                    <div className="flex items-center gap-2">
                      <Link2 className="w-3 h-3 text-emerald-400" />
                      <span className="text-xs text-muted-foreground" data-testid={`text-plan-broker-${plan.id}`}>
                        Broker: {getBrokerName(plan.brokerConfigId)}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Home, Plus, Trash2, Edit, Settings, Link2, Loader2, X, Save } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { StrategyConfig, StrategyPlan, Webhook } from "@shared/schema";
import { PREDEFINED_INDICATORS, type ActionMapperEntry, type TradeLeg, type ExecutionBlock } from "@shared/schema";
import type { BrokerConfig } from "@shared/schema";

const ACTION_OPTIONS = ["--", "ENTRY", "EXIT", "HOLD"] as const;
const LEG_TYPES = ["CE", "PE", "FUT"] as const;
const LEG_ACTIONS = ["BUY", "SELL"] as const;

function generateStrikeOptions(): string[] {
  const strikes: string[] = [];
  for (let i = 14; i >= 1; i--) strikes.push(`ITM ${i}`);
  strikes.push("ATM");
  for (let i = 1; i <= 14; i++) strikes.push(`OTM ${i}`);
  return strikes;
}

const STRIKE_OPTIONS = generateStrikeOptions();

function parseJsonSafe<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function MotherConfigurator() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [webhookId, setWebhookId] = useState("");
  const [actionMapper, setActionMapper] = useState<ActionMapperEntry[]>([]);
  const [signalsFetched, setSignalsFetched] = useState(false);
  const [uptrendLegs, setUptrendLegs] = useState<TradeLeg[]>([]);
  const [downtrendLegs, setDowntrendLegs] = useState<TradeLeg[]>([]);
  const [neutralLegs, setNeutralLegs] = useState<TradeLeg[]>([]);
  const [status, setStatus] = useState("draft");

  const { data: configs = [], isLoading } = useQuery<StrategyConfig[]>({
    queryKey: ["/api/strategy-configs"],
  });

  const { data: webhooks = [] } = useQuery<Webhook[]>({
    queryKey: ["/api/webhooks"],
  });

  const { data: signals = [], refetch: refetchSignals } = useQuery<string[]>({
    queryKey: ["/api/webhook-signals", webhookId],
    enabled: false,
  });

  const fetchSignals = async () => {
    if (!webhookId || webhookId === "none") return;
    setSignalsFetched(false);
    const result = await refetchSignals();
    const fetched = result.data || [];
    if (fetched.length > 0) {
      setActionMapper(
        fetched.map((s) => ({ signalValue: s, uptrend: "--" as const, downtrend: "--" as const, neutral: "--" as const }))
      );
      setSignalsFetched(true);
    } else {
      toast({ title: "No signals found for this webhook", variant: "destructive" });
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return apiRequest("POST", "/api/strategy-configs", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-configs"] });
      resetForm();
      toast({ title: "Configuration created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create configuration", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      return apiRequest("PATCH", `/api/strategy-configs/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-configs"] });
      resetForm();
      toast({ title: "Configuration updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update configuration", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/strategy-configs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-configs"] });
      toast({ title: "Configuration deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete configuration", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setIsEditing(false);
    setEditingId(null);
    setName("");
    setDescription("");
    setWebhookId("");
    setActionMapper([]);
    setSignalsFetched(false);
    setUptrendLegs([]);
    setDowntrendLegs([]);
    setNeutralLegs([]);
    setStatus("draft");
  };

  const handleEdit = (config: StrategyConfig) => {
    setEditingId(config.id);
    setName(config.name);
    setDescription(config.description || "");
    setWebhookId(config.webhookId || "");
    const parsedMapper = parseJsonSafe<ActionMapperEntry[]>(config.actionMapper, []);
    setActionMapper(parsedMapper);
    setSignalsFetched(parsedMapper.length > 0);
    const upBlock = parseJsonSafe<ExecutionBlock>(config.uptrendBlock, { legs: [] });
    const downBlock = parseJsonSafe<ExecutionBlock>(config.downtrendBlock, { legs: [] });
    const neutralBlock = parseJsonSafe<ExecutionBlock>(config.neutralBlock, { legs: [] });
    setUptrendLegs(upBlock.legs);
    setDowntrendLegs(downBlock.legs);
    setNeutralLegs(neutralBlock.legs);
    setStatus(config.status);
    setIsEditing(true);
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      webhookId: webhookId || null,
      actionMapper: JSON.stringify(actionMapper),
      uptrendBlock: JSON.stringify({ legs: uptrendLegs }),
      downtrendBlock: JSON.stringify({ legs: downtrendLegs }),
      neutralBlock: JSON.stringify({ legs: neutralLegs }),
      status,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const updateMapperEntry = (index: number, field: keyof ActionMapperEntry, value: string) => {
    setActionMapper((prev) => prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)));
  };

  const addLeg = (block: "uptrend" | "downtrend" | "neutral") => {
    const newLeg: TradeLeg = { type: "CE", action: "BUY", strike: "ATM", lots: 1 };
    if (block === "uptrend") setUptrendLegs((prev) => [...prev, newLeg]);
    else if (block === "downtrend") setDowntrendLegs((prev) => [...prev, newLeg]);
    else setNeutralLegs((prev) => [...prev, newLeg]);
  };

  const updateLeg = (block: "uptrend" | "downtrend" | "neutral", index: number, field: keyof TradeLeg, value: string | number) => {
    const setter = block === "uptrend" ? setUptrendLegs : block === "downtrend" ? setDowntrendLegs : setNeutralLegs;
    setter((prev) => prev.map((leg, i) => (i === index ? { ...leg, [field]: value } : leg)));
  };

  const removeLeg = (block: "uptrend" | "downtrend" | "neutral", index: number) => {
    const setter = block === "uptrend" ? setUptrendLegs : block === "downtrend" ? setDowntrendLegs : setNeutralLegs;
    setter((prev) => prev.filter((_, i) => i !== index));
  };

  const getWebhookName = (wId: string | null | undefined) => {
    if (!wId) return "None";
    const wh = webhooks.find((w) => w.id === wId);
    return wh ? wh.name : "Unknown";
  };

  const getStatusVariant = (s: string) => {
    if (s === "active") return "default" as const;
    if (s === "archived") return "secondary" as const;
    return "outline" as const;
  };

  if (isEditing) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-lg font-semibold" data-testid="text-config-form-title">
            {editingId ? "Edit Configuration" : "New Configuration"}
          </h2>
          <Button variant="outline" onClick={resetForm} data-testid="button-cancel-config">
            Cancel
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Strategy name"
              data-testid="input-config-name"
            />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="select-config-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label>Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            data-testid="input-config-description"
          />
        </div>

        <div>
          <Label className="mb-2 block">Indicator Source (Webhook)</Label>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={webhookId} onValueChange={(val) => { setWebhookId(val); setActionMapper([]); setSignalsFetched(false); }}>
              <SelectTrigger className="flex-1 min-w-[200px]" data-testid="select-config-webhook">
                <SelectValue placeholder="Select indicator webhook..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {webhooks.map((wh) => (
                  <SelectItem key={wh.id} value={wh.id}>
                    {wh.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={signalsFetched ? "default" : "outline"}
              onClick={fetchSignals}
              disabled={!webhookId || webhookId === "none"}
              data-testid="button-fetch-signals"
            >
              {signalsFetched ? "Signals Loaded" : "Fetch Signals"}
            </Button>
          </div>
        </div>

        {webhookId && webhookId !== "none" && signals && signals.length > 0 && (
          <div>
            <Label className="mb-2 block">Signal Action Mapper</Label>
            <div className="border border-border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Signal</th>
                    <th className="text-left px-3 py-2 font-medium text-emerald-400">Uptrend</th>
                    <th className="text-left px-3 py-2 font-medium text-red-400">Downtrend</th>
                    <th className="text-left px-3 py-2 font-medium text-blue-400">Neutral</th>
                  </tr>
                </thead>
                <tbody>
                  {actionMapper.map((entry, idx) => (
                    <tr key={idx} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs" data-testid={`text-signal-${idx}`}>{entry.signalValue}</td>
                      <td className="px-3 py-2">
                        <Select value={entry.uptrend} onValueChange={(v) => updateMapperEntry(idx, "uptrend", v)}>
                          <SelectTrigger className="w-28" data-testid={`select-uptrend-${idx}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ACTION_OPTIONS.map((a) => (
                              <SelectItem key={a} value={a}>{a}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Select value={entry.downtrend} onValueChange={(v) => updateMapperEntry(idx, "downtrend", v)}>
                          <SelectTrigger className="w-28" data-testid={`select-downtrend-${idx}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ACTION_OPTIONS.map((a) => (
                              <SelectItem key={a} value={a}>{a}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Select value={entry.neutral} onValueChange={(v) => updateMapperEntry(idx, "neutral", v)}>
                          <SelectTrigger className="w-28" data-testid={`select-neutral-${idx}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ACTION_OPTIONS.map((a) => (
                              <SelectItem key={a} value={a}>{a}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div>
          <div className="grid gap-4 md:grid-cols-3">
            {(
              [
                { key: "uptrend" as const, label: "UPTREND BLOCK", legs: uptrendLegs, borderColor: "border-emerald-500", textColor: "text-emerald-400", btnLabel: "+ Add Uptrend Leg" },
                { key: "downtrend" as const, label: "DOWNTREND BLOCK", legs: downtrendLegs, borderColor: "border-red-500", textColor: "text-red-400", btnLabel: "+ Add Downtrend Leg" },
                { key: "neutral" as const, label: "NEUTRAL BLOCK", legs: neutralLegs, borderColor: "border-blue-500", textColor: "text-blue-400", btnLabel: "+ Add Neutral Leg" },
              ] as const
            ).map((block) => (
              <div key={block.key} className={`border-2 ${block.borderColor} rounded-md p-3 space-y-3`} data-testid={`card-block-${block.key}`}>
                <h3 className={`font-bold text-sm ${block.textColor}`}>{block.label}</h3>
                <div className="space-y-2">
                  {block.legs.map((leg, idx) => (
                    <div key={idx} className="flex items-center gap-2 flex-wrap" data-testid={`leg-${block.key}-${idx}`}>
                      <span className="text-xs font-medium text-muted-foreground w-12 shrink-0">Leg {idx + 1}:</span>
                      <Select value={leg.type} onValueChange={(v) => updateLeg(block.key, idx, "type", v)}>
                        <SelectTrigger className="w-[70px]" data-testid={`select-leg-type-${block.key}-${idx}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LEG_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={leg.action} onValueChange={(v) => updateLeg(block.key, idx, "action", v)}>
                        <SelectTrigger className="w-[80px]" data-testid={`select-leg-action-${block.key}-${idx}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LEG_ACTIONS.map((a) => (
                            <SelectItem key={a} value={a}>{a}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={leg.strike} onValueChange={(v) => updateLeg(block.key, idx, "strike", v)}>
                        <SelectTrigger className="w-[100px]" data-testid={`select-leg-strike-${block.key}-${idx}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STRIKE_OPTIONS.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        min={1}
                        value={leg.lots}
                        onChange={(e) => updateLeg(block.key, idx, "lots", Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-[60px]"
                        data-testid={`input-leg-lots-${block.key}-${idx}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLeg(block.key, idx)}
                        data-testid={`button-remove-leg-${block.key}-${idx}`}
                      >
                        <X className="w-3 h-3 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addLeg(block.key)}
                  data-testid={`button-add-leg-${block.key}`}
                >
                  {block.btnLabel}
                </Button>
              </div>
            ))}
          </div>
        </div>

        <Button
          className="w-full"
          onClick={handleSave}
          disabled={!name.trim() || createMutation.isPending || updateMutation.isPending}
          data-testid="button-save-config"
        >
          {createMutation.isPending || updateMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          {editingId ? "UPDATE STRATEGY CONFIGURATION" : "SAVE STRATEGY CONFIGURATION"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold" data-testid="text-configs-title">Strategy Configurations</h2>
        {isSuperAdmin && (
          <Button onClick={() => setIsEditing(true)} data-testid="button-new-config">
            <Plus className="w-4 h-4 mr-2" />
            New Configuration
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : configs.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Settings className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Configurations</h3>
            <p className="text-muted-foreground mb-4">Create your first strategy configuration</p>
            <Button onClick={() => setIsEditing(true)} data-testid="button-create-first-config">
              <Plus className="w-4 h-4 mr-2" />
              Create Configuration
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {configs.map((config) => (
            <Card key={config.id} data-testid={`card-config-${config.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 flex-wrap" data-testid={`text-config-name-${config.id}`}>
                      {config.name}
                      <Badge variant={getStatusVariant(config.status)} data-testid={`badge-config-status-${config.id}`}>
                        {config.status}
                      </Badge>
                    </CardTitle>
                    <p className="text-sm text-muted-foreground" data-testid={`text-config-desc-${config.id}`}>
                      {config.description || "No description"}
                    </p>
                  </div>
                  {isSuperAdmin && (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(config)} data-testid={`button-edit-config-${config.id}`}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(config.id)} data-testid={`button-delete-config-${config.id}`}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Webhook:</span>
                    <span data-testid={`text-config-webhook-${config.id}`}>{getWebhookName(config.webhookId)}</span>
                  </div>
                  {config.indicators && config.indicators.length > 0 && (
                    <div className="flex flex-wrap gap-1" data-testid={`container-config-indicators-${config.id}`}>
                      {config.indicators.map((ind) => (
                        <Badge key={ind} variant="secondary" className="text-xs">
                          {ind}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {config.createdAt && (
                    <p className="text-xs text-muted-foreground" data-testid={`text-config-date-${config.id}`}>
                      Created: {new Date(config.createdAt).toLocaleDateString()}
                    </p>
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

function TradePlanning() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<StrategyPlan | null>(null);
  const [planName, setPlanName] = useState("");
  const [planDescription, setPlanDescription] = useState("");
  const [configId, setConfigId] = useState("");
  const [planIndicators, setPlanIndicators] = useState<string[]>([]);
  const [planStatus, setPlanStatus] = useState("draft");

  const { data: plans = [], isLoading } = useQuery<StrategyPlan[]>({
    queryKey: ["/api/strategy-plans"],
  });

  const { data: configs = [] } = useQuery<StrategyConfig[]>({
    queryKey: ["/api/strategy-configs"],
  });

  const { data: brokerConfigs = [] } = useQuery<BrokerConfig[]>({
    queryKey: ["/api/broker-configs"],
  });

  const selectedConfig = configs.find((c) => c.id === configId);

  useEffect(() => {
    if (selectedConfig && !editingPlan) {
      setPlanIndicators(selectedConfig.indicators || []);
    }
  }, [selectedConfig, editingPlan]);

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
  };

  const handleEdit = (plan: StrategyPlan) => {
    setEditingPlan(plan);
    setPlanName(plan.name);
    setPlanDescription(plan.description || "");
    setConfigId(plan.configId);
    setPlanIndicators(plan.selectedIndicators || []);
    setPlanStatus(plan.status);
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
      status: planStatus,
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

  const getBrokerName = (bId: string | null | undefined) => {
    if (!bId) return null;
    const b = brokerConfigs.find((bc) => bc.id === bId);
    return b ? b.brokerName : "Unknown";
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-plan-form-title">
              {editingPlan ? "Edit Plan" : "New Plan"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Parent Configuration</Label>
              <Select value={configId} onValueChange={setConfigId}>
                <SelectTrigger data-testid="select-plan-config">
                  <SelectValue placeholder="Select configuration" />
                </SelectTrigger>
                <SelectContent>
                  {configs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
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
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Config: <span data-testid={`text-plan-config-${plan.id}`}>{getConfigName(plan.configId)}</span>
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

function BrokerLinking() {
  const { toast } = useToast();

  const { data: plans = [], isLoading } = useQuery<StrategyPlan[]>({
    queryKey: ["/api/strategy-plans"],
  });

  const { data: brokerConfigs = [] } = useQuery<BrokerConfig[]>({
    queryKey: ["/api/broker-configs"],
  });

  const activePlans = plans.filter((p) => p.status === "active");

  const [localState, setLocalState] = useState<Record<string, { brokerConfigId: string; isProxyMode: boolean }>>({});

  useEffect(() => {
    const state: Record<string, { brokerConfigId: string; isProxyMode: boolean }> = {};
    activePlans.forEach((p) => {
      state[p.id] = {
        brokerConfigId: p.brokerConfigId || "",
        isProxyMode: p.isProxyMode || false,
      };
    });
    setLocalState(state);
  }, [plans]);

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

  const { data: configs = [] } = useQuery<StrategyConfig[]>({
    queryKey: ["/api/strategy-configs"],
  });

  const getConfigName = (cId: string) => {
    const c = configs.find((cfg) => cfg.id === cId);
    return c ? c.name : "Unknown";
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
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Config: {getConfigName(plan.configId)}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs">Broker Configuration</Label>
                    <Select
                      value={state.brokerConfigId}
                      onValueChange={(v) => updateLocalState(plan.id, "brokerConfigId", v)}
                    >
                      <SelectTrigger data-testid={`select-broker-${plan.id}`}>
                        <SelectValue placeholder="Select broker" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {brokerConfigs.map((bc) => (
                          <SelectItem key={bc.id} value={bc.id}>
                            {bc.brokerName} {bc.ucc ? `(${bc.ucc})` : ""}
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
                        data-testid={`switch-proxy-${plan.id}`}
                      />
                      <Label className="text-xs cursor-pointer">Proxy Mode</Label>
                    </div>
                    <div className="flex gap-2">
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
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Strategies() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-strategies-title">Strategy Management</h1>
              <p className="text-muted-foreground text-sm">Configure strategies, plans, and broker linking</p>
            </div>
            <Link href="/">
              <Button variant="outline" size="sm" data-testid="button-home">
                <Home className="w-4 h-4 mr-2" />
                Home
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <Tabs defaultValue="configurator" data-testid="tabs-strategy">
          <TabsList className="mb-6" data-testid="tabslist-strategy">
            <TabsTrigger value="configurator" data-testid="tab-configurator">Mother Configurator</TabsTrigger>
            <TabsTrigger value="planning" data-testid="tab-planning">Trade Planning</TabsTrigger>
            <TabsTrigger value="broker" data-testid="tab-broker">Broker Linking</TabsTrigger>
          </TabsList>
          <TabsContent value="configurator">
            <MotherConfigurator />
          </TabsContent>
          <TabsContent value="planning">
            <TradePlanning />
          </TabsContent>
          <TabsContent value="broker">
            <BrokerLinking />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
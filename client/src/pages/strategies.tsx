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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Home, Plus, Trash2, Edit, Settings, Link2, Loader2, X, Save, Clock, Shield, Target, TrendingUp, Rocket, Play, Pause, Square, Power, RefreshCw, Wifi, WifiOff, TrendingDown, Activity, ChevronDown, ChevronUp, BarChart3 } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { StrategyConfig, StrategyPlan, Webhook, StrategyTrade, StrategyDailyPnl } from "@shared/schema";
import { PREDEFINED_INDICATORS, type ActionMapperEntry, type PlanTradeLeg, type TradeParams, type StoplossConfig, type ProfitTargetConfig, type TrailingStoplossConfig, type TimeLogicConfig, BROKER_FIELD_MAP, buildBrokerOrderParams } from "@shared/schema";
import type { BrokerConfig } from "@shared/schema";

const ACTION_OPTIONS = ["--", "ENTRY", "EXIT", "HOLD"] as const;

function generateStrikeOptions(): string[] {
  const strikes: string[] = [];
  for (let i = 14; i >= 1; i--) strikes.push(`ITM ${i}`);
  strikes.push("ATM");
  for (let i = 1; i <= 14; i++) strikes.push(`OTM ${i}`);
  return strikes;
}

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
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [addedFields, setAddedFields] = useState<string[]>([]);
  const [selectedField, setSelectedField] = useState("");
  const [signalsFetched, setSignalsFetched] = useState(false);
  const [mapperReady, setMapperReady] = useState(false);
  const [loadingValues, setLoadingValues] = useState(false);
  const [status, setStatus] = useState("draft");
  const [exchange, setExchange] = useState("");
  const [ticker, setTicker] = useState("");
  const [exchangeOptions, setExchangeOptions] = useState<string[]>([]);
  const [tickerOptions, setTickerOptions] = useState<string[]>([]);
  const [editingFieldName, setEditingFieldName] = useState<string | null>(null);
  const [editFieldValue, setEditFieldValue] = useState("");

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

  useEffect(() => {
    if (!webhookId || webhookId === "none") {
      setExchangeOptions([]);
      setTickerOptions([]);
      return;
    }
    (async () => {
      try {
        const [exResp, tkResp] = await Promise.all([
          fetch(`/api/webhook-field-values/${webhookId}/exchange`),
          fetch(`/api/webhook-field-values/${webhookId}/ticker`),
        ]);
        if (exResp.ok) {
          const vals: string[] = await exResp.json();
          setExchangeOptions(vals.filter(Boolean));
        }
        if (tkResp.ok) {
          const vals: string[] = await tkResp.json();
          setTickerOptions(vals.filter(Boolean));
        }
      } catch {}
    })();
  }, [webhookId]);

  const fetchSignals = async () => {
    if (!webhookId || webhookId === "none") return;
    setSignalsFetched(false);
    const result = await refetchSignals();
    const fetched = result.data || [];
    if (fetched.length > 0) {
      setAvailableFields(fetched.filter((f) => !addedFields.includes(f)));
      setSignalsFetched(true);
      setSelectedField("");
    } else {
      toast({ title: "No fields found for this webhook", variant: "destructive" });
    }
  };

  const addSignalField = () => {
    if (!selectedField) return;
    setAddedFields((prev) => [...prev, selectedField]);
    setAvailableFields((prev) => prev.filter((f) => f !== selectedField));
    setSelectedField("");
  };

  const removeAddedField = (field: string) => {
    setAddedFields((prev) => prev.filter((f) => f !== field));
    setAvailableFields((prev) => [...prev, field]);
    setActionMapper((prev) => prev.filter((e) => e.fieldKey !== field));
  };

  const loadFieldValues = async () => {
    if (addedFields.length === 0) return;
    setLoadingValues(true);
    try {
      const results = await Promise.all(
        addedFields.map(async (field) => {
          const resp = await fetch(`/api/webhook-field-values/${webhookId}/${field}`);
          if (resp.ok) {
            const values: string[] = await resp.json();
            return values.map((val) => ({ signalValue: val, fieldKey: field, uptrend: null, downtrend: null, neutral: null }));
          }
          return [];
        })
      );
      const allEntries = results.flat().filter(
        (entry, idx, arr) => arr.findIndex((e) => e.signalValue === entry.signalValue && e.fieldKey === entry.fieldKey) === idx
      );
      if (allEntries.length > 0) {
        setActionMapper(allEntries);
        setMapperReady(true);
      } else {
        toast({ title: "No signal values found for selected fields. Webhook may not have received data yet.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to load field values", variant: "destructive" });
    } finally {
      setLoadingValues(false);
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
    setExchange("");
    setTicker("");
    setExchangeOptions([]);
    setTickerOptions([]);
    setActionMapper([]);
    setAvailableFields([]);
    setAddedFields([]);
    setSelectedField("");
    setSignalsFetched(false);
    setMapperReady(false);
    setLoadingValues(false);
    setStatus("draft");
  };

  const handleEdit = (config: StrategyConfig) => {
    setEditingId(config.id);
    setName(config.name);
    setDescription(config.description || "");
    setWebhookId(config.webhookId || "");
    setExchange(config.exchange || "");
    setTicker(config.ticker || "");
    const parsedMapper = parseJsonSafe<ActionMapperEntry[]>(config.actionMapper, []);
    setActionMapper(parsedMapper);
    const existingFieldKeys = Array.from(new Set(parsedMapper.map((e) => e.fieldKey).filter(Boolean))) as string[];
    setAddedFields(existingFieldKeys);
    setAvailableFields([]);
    setSelectedField("");
    setSignalsFetched(parsedMapper.length > 0);
    setMapperReady(parsedMapper.length > 0);
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
      exchange: exchange || null,
      ticker: ticker || null,
      actionMapper: JSON.stringify(actionMapper.filter((e) => e.signalValue.trim())),
      status,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const updateMapperEntry = (index: number, field: keyof ActionMapperEntry, value: string | null) => {
    setActionMapper((prev) => prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)));
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
            <Select value={webhookId} onValueChange={(val) => { setWebhookId(val); setActionMapper([]); setAvailableFields([]); setAddedFields([]); setSelectedField(""); setSignalsFetched(false); setMapperReady(false); }}>
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
          {webhookId && webhookId !== "none" && (
            <div className="flex items-center gap-4 mt-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Label className="whitespace-nowrap text-xs text-muted-foreground">Exchange</Label>
                <Select value={exchange || "auto"} onValueChange={(v) => setExchange(v === "auto" ? "" : v)}>
                  <SelectTrigger className="w-36" data-testid="select-config-exchange">
                    <SelectValue placeholder="Auto-detect" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    {exchangeOptions.map((ex) => (
                      <SelectItem key={ex} value={ex}>{ex}</SelectItem>
                    ))}
                    {!exchangeOptions.includes("NSE") && <SelectItem value="NSE">NSE</SelectItem>}
                    {!exchangeOptions.includes("BSE") && <SelectItem value="BSE">BSE</SelectItem>}
                    {!exchangeOptions.includes("MCX") && <SelectItem value="MCX">MCX</SelectItem>}
                    {!exchangeOptions.includes("NFO") && <SelectItem value="NFO">NFO</SelectItem>}
                    {!exchangeOptions.includes("BFO") && <SelectItem value="BFO">BFO</SelectItem>}
                    {!exchangeOptions.includes("CDS") && <SelectItem value="CDS">CDS</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label className="whitespace-nowrap text-xs text-muted-foreground">Ticker</Label>
                <Select value={ticker || "auto"} onValueChange={(v) => setTicker(v === "auto" ? "" : v)}>
                  <SelectTrigger className="w-40" data-testid="select-config-ticker">
                    <SelectValue placeholder="Auto-detect" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    {tickerOptions.map((tk) => (
                      <SelectItem key={tk} value={tk}>{tk}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        {signalsFetched && (
          <div className="space-y-3">
            <Label className="mb-2 block">Select Signal Fields</Label>

            <div className="flex items-center gap-2 flex-wrap">
              {availableFields.length > 0 && (
                <>
                  <Select value={selectedField} onValueChange={setSelectedField}>
                    <SelectTrigger className="flex-1 min-w-[200px]" data-testid="select-signal-field">
                      <SelectValue placeholder="Select a signal field to add..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableFields.map((f) => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    onClick={addSignalField}
                    disabled={!selectedField}
                    data-testid="button-add-signal-field"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add
                  </Button>
                </>
              )}
            </div>

            {addedFields.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {addedFields.map((field) => (
                    <Badge key={field} variant="secondary" className="gap-1" data-testid={`badge-field-${field}`}>
                      {field}
                      <button onClick={() => removeAddedField(field)} className="ml-1" data-testid={`button-remove-field-${field}`}>
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                {!mapperReady && (
                  <Button
                    onClick={loadFieldValues}
                    disabled={loadingValues}
                    data-testid="button-next-load-values"
                  >
                    {loadingValues ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Loading...</> : "Next"}
                  </Button>
                )}
              </div>
            )}

            {addedFields.length === 0 && !mapperReady && (
              <p className="text-sm text-muted-foreground">Select signal fields from the dropdown above, then click "Next" to load their values for mapping.</p>
            )}
          </div>
        )}

        {mapperReady && actionMapper.length > 0 && (
          <div className="space-y-3">
            <Label className="mb-2 block">Strategy Action Mapper</Label>
            <div className="border border-border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Signal Name</th>
                    <th className="text-center px-3 py-2 font-medium text-emerald-400" colSpan={1}>Uptrend Action</th>
                    <th className="text-center px-3 py-2 font-medium text-red-400" colSpan={1}>Downtrend Action</th>
                    <th className="text-center px-3 py-2 font-medium text-blue-400" colSpan={1}>Neutral Action</th>
                  </tr>
                </thead>
                <tbody>
                  {actionMapper.map((entry, idx) => (
                    <tr key={`${entry.fieldKey}-${entry.signalValue}`} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs" data-testid={`text-signal-${idx}`}>
                        {editingFieldName === `${idx}` ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={editFieldValue}
                              onChange={(e) => setEditFieldValue(e.target.value)}
                              className="w-32 h-7 text-xs"
                              data-testid={`input-edit-signal-${idx}`}
                            />
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                              const trimmed = editFieldValue.trim();
                              if (!trimmed) { toast({ title: "Signal name cannot be empty", variant: "destructive" }); return; }
                              const isDuplicate = actionMapper.some((e, i) => i !== idx && e.signalValue.trim().toLowerCase() === trimmed.toLowerCase());
                              if (isDuplicate) { toast({ title: "Duplicate signal name. This name already exists.", variant: "destructive" }); return; }
                              updateMapperEntry(idx, "signalValue", trimmed); setEditingFieldName(null);
                            }} data-testid={`button-save-field-${idx}`}>
                              <Save className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingFieldName(null)} data-testid={`button-cancel-field-${idx}`}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <span className="flex items-center gap-1">
                            {entry.signalValue}
                            {isSuperAdmin && (
                              <button onClick={() => { setEditingFieldName(`${idx}`); setEditFieldValue(entry.signalValue); }} className="visibility-hidden group-hover:visibility-visible ml-1 opacity-50 hover:opacity-100" data-testid={`button-edit-field-${idx}`}>
                                <Edit className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Select value={entry.uptrend || "--"} onValueChange={(v) => updateMapperEntry(idx, "uptrend", v === "--" ? null : v)}>
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
                        <Select value={entry.downtrend || "--"} onValueChange={(v) => updateMapperEntry(idx, "downtrend", v === "--" ? null : v)}>
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
                        <Select value={entry.neutral || "--"} onValueChange={(v) => updateMapperEntry(idx, "neutral", v === "--" ? null : v)}>
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
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                const fieldKey = addedFields.length === 1 ? addedFields[0] : (selectedField || addedFields[addedFields.length - 1] || "custom");
                const newIdx = actionMapper.length;
                setActionMapper((prev) => [...prev, { signalValue: "", fieldKey, uptrend: null, downtrend: null, neutral: null }]);
                setEditingFieldName(`${newIdx}`);
                setEditFieldValue("");
              }}
              data-testid="button-add-signal-row"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Signal
            </Button>
          </div>
        )}

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
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="text-muted-foreground">Webhook:</span>
                    <span data-testid={`text-config-webhook-${config.id}`}>{getWebhookName(config.webhookId)}</span>
                    {config.exchange && <Badge variant="outline" data-testid={`badge-exchange-${config.id}`}>{config.exchange}</Badge>}
                    {config.ticker && <Badge variant="outline" data-testid={`badge-ticker-${config.id}`}>{config.ticker}</Badge>}
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
  const [uptrendLegs, setUptrendLegs] = useState<PlanTradeLeg[]>([]);
  const [downtrendLegs, setDowntrendLegs] = useState<PlanTradeLeg[]>([]);
  const [neutralLegs, setNeutralLegs] = useState<PlanTradeLeg[]>([]);
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

  const activeConfigs = configs.filter((c) => c.status === "active" || c.status === "draft");
  const selectedConfig = configs.find((c) => c.id === configId);
  const allLegsFlat = [...uptrendLegs, ...downtrendLegs, ...neutralLegs];
  const hasMISLegs = allLegsFlat.some((l) => l.orderType === "MIS");

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
    setUptrendLegs([]);
    setDowntrendLegs([]);
    setNeutralLegs([]);
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
    const tp = parseJsonSafe<TradeParams>(plan.tradeParams, { legs: [], uptrendLegs: [], downtrendLegs: [], neutralLegs: [] });
    setUptrendLegs(tp.uptrendLegs || tp.legs || []);
    setDowntrendLegs(tp.downtrendLegs || []);
    setNeutralLegs(tp.neutralLegs || []);
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
      tradeParams: JSON.stringify({ legs: [], uptrendLegs, downtrendLegs, neutralLegs, stoploss, profitTarget, trailingSL, timeLogic }),
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
                  { key: "uptrend" as const, label: "UPTREND BLOCK", legs: uptrendLegs, setter: setUptrendLegs, borderColor: "border-emerald-500", textColor: "text-emerald-400" },
                  { key: "downtrend" as const, label: "DOWNTREND BLOCK", legs: downtrendLegs, setter: setDowntrendLegs, borderColor: "border-red-500", textColor: "text-red-400" },
                  { key: "neutral" as const, label: "NEUTRAL BLOCK", legs: neutralLegs, setter: setNeutralLegs, borderColor: "border-blue-500", textColor: "text-blue-400" },
                ] as const).map((block) => (
                  <div key={block.key} className={`border-2 ${block.borderColor} rounded-md p-3 space-y-2`} data-testid={`card-plan-block-${block.key}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h4 className={`font-bold text-xs ${block.textColor}`}>{block.label}</h4>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => block.setter((prev: PlanTradeLeg[]) => [...prev, { type: "CE", action: "BUY", strike: "ATM", lots: 1, orderType: "MIS" }])}
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
                          <Select value={leg.orderType} onValueChange={(v) => block.setter((prev: PlanTradeLeg[]) => prev.map((l, i) => i === idx ? { ...l, orderType: v as PlanTradeLeg["orderType"] } : l))}>
                            <SelectTrigger className="w-20" data-testid={`select-plan-leg-order-${block.key}-${idx}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MIS">MIS</SelectItem>
                              <SelectItem value="NRML">NRML</SelectItem>
                              <SelectItem value="CNC">CNC</SelectItem>
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
                    <span className="text-sm font-medium">Time Logic</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Exit Time (HH:MM)</Label>
                      <Input
                        type="time"
                        value={timeLogic.exitTime}
                        onChange={(e) => setTimeLogic((s) => ({ ...s, exitTime: e.target.value }))}
                        data-testid="input-exit-time"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Exit After Entry + Days</Label>
                      <Input
                        type="number"
                        min={0}
                        value={timeLogic.exitAfterDays || ""}
                        onChange={(e) => setTimeLogic((s) => ({ ...s, exitAfterDays: parseInt(e.target.value) || 0 }))}
                        placeholder="e.g. 3"
                        data-testid="input-exit-after-days"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Label className="text-sm">Exit On Expiry</Label>
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
                  {plan.tradeParams && (() => {
                    const tp = parseJsonSafe<TradeParams>(plan.tradeParams, { legs: [], uptrendLegs: [], downtrendLegs: [], neutralLegs: [] });
                    const allLegs = [
                      ...(tp.uptrendLegs || []).length > 0 ? [{ label: "Uptrend", legs: tp.uptrendLegs!, color: "text-emerald-400" }] : [],
                      ...(tp.downtrendLegs || []).length > 0 ? [{ label: "Downtrend", legs: tp.downtrendLegs!, color: "text-red-400" }] : [],
                      ...(tp.neutralLegs || []).length > 0 ? [{ label: "Neutral", legs: tp.neutralLegs!, color: "text-blue-400" }] : [],
                      ...(tp.legs || []).length > 0 ? [{ label: "Legs", legs: tp.legs, color: "text-muted-foreground" }] : [],
                    ];
                    return allLegs.length > 0 ? (
                      <div className="space-y-1" data-testid={`container-plan-legs-${plan.id}`}>
                        {allLegs.map((group) => (
                          <div key={group.label} className="flex items-center gap-1 flex-wrap">
                            <span className={`text-xs font-medium ${group.color}`}>{group.label}:</span>
                            {group.legs.map((leg, i) => (
                              <Badge key={i} variant="outline" className="text-xs font-mono">
                                {leg.action} {leg.type} {leg.strike} x{leg.lots} ({leg.orderType})
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
                      exitBadges.push({ label: "Exit On Expiry", color: "text-yellow-400" });
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

const DEPLOYMENT_STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Activity }> = {
  draft: { label: "Draft", color: "text-muted-foreground", icon: Clock },
  deployed: { label: "Deployed", color: "text-blue-400", icon: Rocket },
  active: { label: "Active", color: "text-emerald-400", icon: Play },
  paused: { label: "Paused", color: "text-amber-400", icon: Pause },
  squared_off: { label: "Squared Off", color: "text-red-400", icon: Square },
  closed: { label: "Closed", color: "text-muted-foreground", icon: Power },
};

function LivePositionTracker({ plan, brokerConfigs, parentConfig }: { plan: StrategyPlan; brokerConfigs: BrokerConfig[]; parentConfig?: StrategyConfig }) {
  const brokerConfig = brokerConfigs.find((bc) => bc.id === plan.brokerConfigId);
  const isConnected = brokerConfig?.isConnected || false;
  const isDeployed = plan.deploymentStatus && plan.deploymentStatus !== "draft";

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

  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const tradesCount = trades.length;
  useEffect(() => {
    if (tradesCount > 0 || !isLoading) setLastFetched(new Date().toLocaleTimeString());
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

  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mt-3 border-t border-border/50 pt-3" data-testid={`container-live-positions-${plan.id}`}>
      <button
        className="w-full flex items-center justify-between gap-2 mb-2 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
        data-testid={`button-toggle-trades-${plan.id}`}
      >
        <div className="flex items-center gap-2">
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
          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {isExpanded && (
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
            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); refetch(); }} disabled={isLoading} data-testid={`button-refresh-positions-${plan.id}`}>
              <RefreshCw className={`w-3 h-3 mr-1 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
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
                        P&L: {blockPnl >= 0 ? "+" : ""}{blockPnl.toFixed(2)}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border/30">
                            <th className="text-left px-2 py-1 text-muted-foreground">Symbol</th>
                            <th className="text-left px-2 py-1 text-muted-foreground">Action</th>
                            <th className="text-right px-2 py-1 text-muted-foreground">Qty</th>
                            <th className="text-right px-2 py-1 text-muted-foreground">Price</th>
                            <th className="text-right px-2 py-1 text-muted-foreground">LTP</th>
                            <th className="text-right px-2 py-1 text-muted-foreground">P&L</th>
                            <th className="text-left px-2 py-1 text-muted-foreground">Status</th>
                            <th className="text-left px-2 py-1 text-muted-foreground">Leg</th>
                          </tr>
                        </thead>
                        <tbody>
                          {blockTrades.map((trade) => (
                            <tr key={trade.id} className="border-b border-border/20" data-testid={`row-trade-${trade.id}`}>
                              <td className="px-2 py-1.5 font-mono font-medium">{trade.tradingSymbol}</td>
                              <td className="px-2 py-1.5">
                                <Badge variant={trade.action === "BUY" ? "default" : "destructive"} className="text-xs">{trade.action}</Badge>
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono">{trade.quantity}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{(trade.price || 0).toFixed(2)}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{(trade.ltp || 0).toFixed(2)}</td>
                              <td className={`px-2 py-1.5 text-right font-mono ${(trade.pnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {(trade.pnl || 0) >= 0 ? "+" : ""}{(trade.pnl || 0).toFixed(2)}
                              </td>
                              <td className="px-2 py-1.5">
                                <Badge variant="outline" className="text-xs">{trade.status}</Badge>
                              </td>
                              <td className="px-2 py-1.5 text-xs text-muted-foreground font-mono">L{(trade.legIndex || 0) + 1}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
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
    </div>
  );
}

function DailyPnlLogSheet({ plan, isOpen, onOpenChange }: { plan: StrategyPlan; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: rawEntries = [], isLoading } = useQuery<StrategyDailyPnl[]>({
    queryKey: ["/api/strategy-daily-pnl", plan.id],
    enabled: isOpen,
  });

  const entries = [...rawEntries].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const planName = plan.name || `Plan #${plan.id}`;

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-[800px] h-full max-h-screen overflow-hidden flex flex-col" side="right">
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
            <div
              className="overflow-auto flex-1 min-h-0"
              data-testid={`daily-pnl-scroll-container-${plan.id}`}
            >
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
                    <tr
                      key={entry.id}
                      data-testid={`row-daily-pnl-${entry.id}`}
                      className="border-b hover:bg-muted/50"
                    >
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
          )}
        </div>
      </SheetContent>
    </Sheet>
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
  const [confirmAction, setConfirmAction] = useState<{ planId: string; action: string } | null>(null);
  const [deployConfig, setDeployConfig] = useState<Record<string, { lotMultiplier: number; stoploss: number; profitTarget: number; baseStoploss: number; baseProfitTarget: number }>>({});
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
    mutationFn: async ({ id, deploymentStatus, lotMultiplier, deployStoploss, deployProfitTarget }: { id: string; deploymentStatus: string; lotMultiplier?: number; deployStoploss?: number; deployProfitTarget?: number }) => {
      const body: Record<string, unknown> = { deploymentStatus };
      if (lotMultiplier !== undefined) body.lotMultiplier = lotMultiplier;
      if (deployStoploss !== undefined) body.deployStoploss = deployStoploss;
      if (deployProfitTarget !== undefined) body.deployProfitTarget = deployProfitTarget;
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
          { action: "deployed", label: "Redeploy", icon: Rocket, variant: "default" },
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
                  <p className="text-xs text-muted-foreground">Config: {getConfigName(plan.configId)}</p>
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
                      ...(tp.uptrendLegs || []).length > 0 ? [{ label: "Uptrend", legs: tp.uptrendLegs!, color: "text-emerald-400" }] : [],
                      ...(tp.downtrendLegs || []).length > 0 ? [{ label: "Downtrend", legs: tp.downtrendLegs!, color: "text-red-400" }] : [],
                      ...(tp.neutralLegs || []).length > 0 ? [{ label: "Neutral", legs: tp.neutralLegs!, color: "text-blue-400" }] : [],
                      ...(tp.legs || []).length > 0 ? [{ label: "Legs", legs: tp.legs, color: "text-muted-foreground" }] : [],
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

                  {canDeploy && (
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
                          <Label className="text-xs font-semibold block text-muted-foreground">Pre-Deploy Configuration</Label>

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
                              disabled={deploymentMutation.isPending}
                              data-testid={`button-deploy-${plan.id}`}
                            >
                              {deploymentMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
                              Deploy Strategy
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
                {confirmAction.action === "closed" && "Are you sure you want to close this strategy? This will deactivate it completely. You can redeploy it later."}
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
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, Edit, Settings, Loader2, X, Save, Info } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { StrategyConfig, Webhook } from "@shared/schema";
import type { ActionMapperEntry } from "@shared/schema";

const ACTION_OPTIONS = ["--", "ENTRY", "EXIT", "HOLD"] as const;

function parseJsonSafe<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

export function MotherConfigurator() {
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
  const [priceField, setPriceField] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [manualFieldInput, setManualFieldInput] = useState("");

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
      toast({ title: "No fields found for this webhook. Use Configure Manually to add fields.", variant: "destructive" });
      if (isSuperAdmin) {
        setManualMode(true);
        setSignalsFetched(true);
      }
    }
  };

  useEffect(() => {
    if (addedFields.length >= 2) {
      setPriceField(addedFields[1]);
    } else {
      setPriceField("");
    }
  }, [addedFields]);

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
    if (manualMode) {
      setMapperReady(true);
      return;
    }
    setLoadingValues(true);
    try {
      const fieldsToLoad = addedFields.filter(f => f !== priceField);
      const results = await Promise.all(
        fieldsToLoad.map(async (field) => {
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
    setPriceField("");
    setManualMode(false);
    setManualFieldInput("");
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
    if (config.priceField) {
      const withoutPrice = existingFieldKeys.filter(f => f !== config.priceField);
      withoutPrice.splice(1, 0, config.priceField);
      setAddedFields(withoutPrice);
    } else {
      setAddedFields(existingFieldKeys);
    }
    setAvailableFields([]);
    setSelectedField("");
    setSignalsFetched(parsedMapper.length > 0);
    setMapperReady(parsedMapper.length > 0);
    setStatus(config.status);
    setPriceField(config.priceField || "");
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
      priceField: priceField || null,
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
            <Select value={webhookId} onValueChange={(val) => { setWebhookId(val); setActionMapper([]); setAvailableFields([]); setAddedFields([]); setSelectedField(""); setSignalsFetched(false); setMapperReady(false); setManualMode(false); setManualFieldInput(""); }}>
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
              {signalsFetched ? (manualMode ? "Manual Mode" : "Signals Loaded") : "Fetch Signals"}
            </Button>
            {!signalsFetched && isSuperAdmin && webhookId && webhookId !== "none" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-amber-500 hover:text-amber-400"
                onClick={() => { setManualMode(true); setSignalsFetched(true); }}
                data-testid="button-configure-manually"
              >
                Configure Manually
              </Button>
            )}
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
                    {exchangeOptions.map((ex) => {
                      const fullNames: Record<string, string> = { NSE: "National Stock Exchange", BSE: "Bombay Stock Exchange", NFO: "NSE Futures & Options", BFO: "BSE Futures & Options", MCX: "Multi Commodity Exchange", CDS: "Currency Derivatives" };
                      return <SelectItem key={ex} value={ex}>{ex}{fullNames[ex] ? ` (${fullNames[ex]})` : ""}</SelectItem>;
                    })}
                    {!exchangeOptions.includes("NSE") && <SelectItem value="NSE">NSE (National Stock Exchange)</SelectItem>}
                    {!exchangeOptions.includes("BSE") && <SelectItem value="BSE">BSE (Bombay Stock Exchange)</SelectItem>}
                    {!exchangeOptions.includes("MCX") && <SelectItem value="MCX">MCX (Multi Commodity Exchange)</SelectItem>}
                    {!exchangeOptions.includes("NFO") && <SelectItem value="NFO">NFO (NSE Futures & Options)</SelectItem>}
                    {!exchangeOptions.includes("BFO") && <SelectItem value="BFO">BFO (BSE Futures & Options)</SelectItem>}
                    {!exchangeOptions.includes("CDS") && <SelectItem value="CDS">CDS (Currency Derivatives)</SelectItem>}
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

            {manualMode && (
              <p className="text-sm text-amber-500/80" data-testid="text-manual-mode-info">Manual mode — no signals loaded for this webhook. Add fields and signal values manually.</p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {manualMode ? (
                <>
                  <Input
                    value={manualFieldInput}
                    onChange={(e) => setManualFieldInput(e.target.value)}
                    placeholder="Type field name (e.g. action)"
                    className="flex-1 min-w-[200px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const trimmed = manualFieldInput.trim();
                        if (trimmed && !addedFields.includes(trimmed)) {
                          setAddedFields((prev) => [...prev, trimmed]);
                          setManualFieldInput("");
                        }
                      }
                    }}
                    data-testid="input-manual-field"
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      const trimmed = manualFieldInput.trim();
                      if (!trimmed) return;
                      if (addedFields.includes(trimmed)) {
                        toast({ title: "Field already added", variant: "destructive" });
                        return;
                      }
                      setAddedFields((prev) => [...prev, trimmed]);
                      setManualFieldInput("");
                    }}
                    disabled={!manualFieldInput.trim()}
                    data-testid="button-add-manual-field"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add
                  </Button>
                </>
              ) : (
                availableFields.length > 0 && (
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
                )
              )}
            </div>

            {addedFields.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {addedFields.map((field) => (
                    field === priceField ? (
                      <TooltipProvider key={field}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="secondary" className="gap-1 border-amber-500/50" data-testid={`badge-field-${field}`}>
                              <Info className="w-3 h-3 text-amber-500" />
                              {field}
                              <button onClick={() => removeAddedField(field)} className="ml-1" data-testid={`button-remove-field-${field}`}>
                                <X className="w-3 h-3" />
                              </button>
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent data-testid="tooltip-price-field">
                            <p>Price source — will not appear in the Action Mapper</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <Badge key={field} variant="secondary" className="gap-1" data-testid={`badge-field-${field}`}>
                        {field}
                        <button onClick={() => removeAddedField(field)} className="ml-1" data-testid={`button-remove-field-${field}`}>
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    )
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
              <p className="text-sm text-muted-foreground">
                {manualMode
                  ? "Type a field name above and click Add, then click Next to open the mapper."
                  : "Select signal fields from the dropdown above, then click \"Next\" to load their values for mapping."}
              </p>
            )}
          </div>
        )}

        {mapperReady && (actionMapper.length > 0 || manualMode) && (
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
                  {actionMapper.length === 0 && manualMode && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-sm text-muted-foreground" data-testid="text-empty-mapper">
                        No signal rows yet. Click "Add Signal" below to add rows manually.
                      </td>
                    </tr>
                  )}
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

            {priceField && (
              <div className="mt-4 pt-4 border-t border-border" data-testid="section-price-source">
                <p className="text-sm font-medium mb-1">Price Source</p>
                <p className="text-sm text-muted-foreground">
                  Field <span className="font-mono font-semibold text-amber-500">{priceField}</span> — spot price will be taken from the TradingView webhook.
                </p>
              </div>
            )}
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
                  {Array.isArray(config.indicators) && config.indicators.length > 0 && (
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
                      Created: {new Date(config.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}
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

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Home, Plus, Webhook, Trash2, Edit, Copy, Clock, CheckCircle, XCircle, Play, Settings, FileText, ExternalLink, Save, Eye, EyeOff, Activity, Timer, Wrench, Upload, Link2, Unlink, RefreshCw, ChevronDown } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Webhook as WebhookType, InsertWebhook, Strategy, WebhookStatusLog, AppSetting, WebhookData } from "@shared/schema";

type WebhookStats = {
  total: number;
  success: number;
  failed: number;
  successRate: number;
  avgResponseTime: number;
};

export default function Webhooks() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookType | null>(null);
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookType | null>(null);
  const [isDataSheetOpen, setIsDataSheetOpen] = useState(false);
  const [isLogsSheetOpen, setIsLogsSheetOpen] = useState(false);
  const [dataExpandedView, setDataExpandedView] = useState(false);
  const [domainName, setDomainName] = useState("");
  const [tempDomainName, setTempDomainName] = useState("");
  const [showSecretKey, setShowSecretKey] = useState<Record<string, boolean>>({});
  const [formData, setFormData] = useState<Partial<InsertWebhook>>({
    name: "",
    strategyId: "",
    webhookUrl: "",
    secretKey: "",
    isActive: true,
    triggerType: "both",
  });
  const [isFieldConfigOpen, setIsFieldConfigOpen] = useState(false);
  const [configWebhook, setConfigWebhook] = useState<WebhookType | null>(null);
  const [fieldConfigText, setFieldConfigText] = useState("");
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [linkingWebhook, setLinkingWebhook] = useState<WebhookType | null>(null);
  const [linkCode, setLinkCode] = useState("");
  const [linkWebhookId, setLinkWebhookId] = useState("");
  const [linkMode, setLinkMode] = useState<"code" | "id">("code");

  // Determine if we're in production or development environment
  // Production: current host matches configured domain name
  // Development: current host does NOT match configured domain name
  const isProductionEnv = domainName && window.location.host === domainName;
  const envPrefix = isProductionEnv ? "P" : "D";

  // Fetch domain name setting
  const { data: domainSetting } = useQuery<AppSetting>({
    queryKey: ["/api/settings/domain_name"],
  });

  useEffect(() => {
    if (domainSetting?.value) {
      setDomainName(domainSetting.value);
      setTempDomainName(domainSetting.value);
    }
  }, [domainSetting]);

  const { data: webhooks = [], isLoading } = useQuery<WebhookType[]>({
    queryKey: ["/api/webhooks"],
  });

  const { data: strategies = [] } = useQuery<Strategy[]>({
    queryKey: ["/api/strategies"],
  });

  const { data: statusLogs = [] } = useQuery<WebhookStatusLog[]>({
    queryKey: ["/api/webhooks", selectedWebhook?.id, "status-logs"],
    enabled: !!selectedWebhook?.id && isLogsSheetOpen,
  });

  const { data: webhookDataList = [] } = useQuery<WebhookData[]>({
    queryKey: ["/api/webhook-data"],
    refetchInterval: 10000, // Refetch every 10 seconds for real-time data
    refetchOnWindowFocus: true,
  });

  // Fetch data specifically for selected webhook (includes production data for linked webhooks)
  const { data: selectedWebhookData = [] } = useQuery<WebhookData[]>({
    queryKey: ["/api/webhook-data/webhook", selectedWebhook?.id],
    enabled: !!selectedWebhook?.id && isDataSheetOpen,
    refetchInterval: 10000,
  });

  // Fetch webhook registry for looking up production webhook codes
  const { data: webhookRegistry = [] } = useQuery<{ id: string; uniqueCode: string; webhookId: string; webhookName: string }[]>({
    queryKey: ["/api/webhook-registry"],
  });

  // Save domain name
  const saveDomainMutation = useMutation({
    mutationFn: async (value: string) => {
      return apiRequest("POST", "/api/settings/domain_name", { value });
    },
    onSuccess: () => {
      setDomainName(tempDomainName);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/domain_name"] });
      toast({ title: "Domain saved successfully" });
    },
    onError: () => {
      toast({ title: "Failed to save domain", variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<InsertWebhook>) => {
      return apiRequest("POST", "/api/webhooks", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
      setIsDialogOpen(false);
      resetForm();
      toast({ title: "Webhook created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create webhook", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertWebhook> }) => {
      return apiRequest("PATCH", `/api/webhooks/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
      setIsDialogOpen(false);
      setEditingWebhook(null);
      resetForm();
      toast({ title: "Webhook updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update webhook", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/webhooks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
      toast({ title: "Webhook deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete webhook", variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest("PATCH", `/api/webhooks/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/webhooks/${id}/test`);
    },
    onSuccess: (_data, webhookId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks", webhookId, "status-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks", webhookId, "stats"] });
      toast({ title: "Test webhook sent successfully" });
    },
    onError: () => {
      toast({ title: "Test webhook failed", variant: "destructive" });
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: async ({ id, days }: { id: string; days: number }) => {
      return apiRequest("DELETE", `/api/webhooks/${id}/logs/cleanup?days=${days}`);
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks", id, "status-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks", id, "stats"] });
      toast({ title: "Old logs cleaned up successfully" });
    },
    onError: () => {
      toast({ title: "Failed to cleanup logs", variant: "destructive" });
    },
  });

  const clearDataMutation = useMutation({
    mutationFn: async (days: number | "all") => {
      if (days === "all") {
        return apiRequest("DELETE", "/api/webhook-data/cleanup-all");
      }
      return apiRequest("DELETE", `/api/webhook-data/cleanup?days=${days}`);
    },
    onSuccess: (_data, days) => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhook-data"] });
      toast({ title: days === "all" ? "All webhook data cleared" : `Data older than ${days} days cleared` });
    },
    onError: () => {
      toast({ title: "Failed to clear webhook data", variant: "destructive" });
    },
  });

  // Field configuration mutation
  const configureFieldsMutation = useMutation({
    mutationFn: async ({ id, fields }: { id: string; fields: string[] }) => {
      return apiRequest("POST", `/api/webhooks/${id}/configure-fields`, { fields });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
      setIsFieldConfigOpen(false);
      setConfigWebhook(null);
      setFieldConfigText("");
      toast({ title: "Field configuration saved successfully" });
    },
    onError: () => {
      toast({ title: "Failed to configure fields", variant: "destructive" });
    },
  });

  // Link webhook to production data stream by unique code or webhook ID
  const linkMutation = useMutation({
    mutationFn: async ({ id, uniqueCode, webhookId }: { id: string; uniqueCode?: string; webhookId?: string }) => {
      return apiRequest("POST", `/api/webhooks/${id}/link`, { uniqueCode, webhookId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/webhook-data"] });
      setIsLinkDialogOpen(false);
      setLinkingWebhook(null);
      setLinkCode("");
      toast({ title: "Webhook linked successfully" });
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to link webhook";
      toast({ title: message, variant: "destructive" });
    },
  });

  // Unlink webhook from production data stream
  const unlinkMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/webhooks/${id}/link`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/webhook-data"] });
      toast({ title: "Webhook unlinked successfully" });
    },
    onError: () => {
      toast({ title: "Failed to unlink webhook", variant: "destructive" });
    },
  });

  // Sync webhook registry from production
  const syncMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/webhook-registry/sync");
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhook-registry"] });
      toast({ 
        title: "Sync Complete", 
        description: data?.message || `Synced webhooks from production` 
      });
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to sync from production";
      toast({ title: message, variant: "destructive" });
    },
  });

  const handleConfigureFields = (webhook: WebhookType) => {
    setConfigWebhook(webhook);
    // If webhook already has field config, parse and display it
    if (webhook.fieldConfig) {
      try {
        const config = JSON.parse(webhook.fieldConfig);
        setFieldConfigText(config.map((f: { name: string }) => f.name).join(", "));
      } catch {
        setFieldConfigText("");
      }
    } else {
      // Use default 19 fields
      setFieldConfigText("Time Unix, Exchange, Ticker (Indices), Indicator, Action (Alert), Price, Local Time, Mode, Mode Desc, Fast Line, Mid Line, Slow Line, Supertrend (ST), Half Trend (HT), RSI, RSI Scaled, Alert System, Action Binary, Lock State");
    }
    setIsFieldConfigOpen(true);
  };

  const handleSaveFieldConfig = () => {
    if (!configWebhook) return;
    const fields = fieldConfigText.split(",").map(f => f.trim()).filter(f => f.length > 0);
    if (fields.length === 0) {
      toast({ title: "Please enter at least one field name", variant: "destructive" });
      return;
    }
    configureFieldsMutation.mutate({ id: configWebhook.id, fields });
  };

  const resetForm = () => {
    setFormData({
      name: "",
      strategyId: "",
      webhookUrl: "",
      secretKey: "",
      isActive: true,
      triggerType: "both",
    });
  };

  const handleSubmit = () => {
    // Backend auto-generates webhook URL based on domain setting
    // Provide a placeholder URL that will be replaced on the backend
    const dataToSubmit = { 
      ...formData, 
      webhookUrl: editingWebhook?.webhookUrl || "pending" 
    };
    
    if (editingWebhook) {
      updateMutation.mutate({ id: editingWebhook.id, data: dataToSubmit });
    } else {
      createMutation.mutate(dataToSubmit);
    }
  };

  const handleEdit = (webhook: WebhookType) => {
    setEditingWebhook(webhook);
    setFormData({
      name: webhook.name,
      strategyId: webhook.strategyId || "",
      webhookUrl: webhook.webhookUrl,
      secretKey: webhook.secretKey || "",
      isActive: webhook.isActive,
      triggerType: webhook.triggerType,
    });
    setIsDialogOpen(true);
  };

  const handleViewLogs = (webhook: WebhookType) => {
    setSelectedWebhook(webhook);
    setIsLogsSheetOpen(true);
  };

  const handleViewData = (webhook: WebhookType) => {
    setSelectedWebhook(webhook);
    setIsDataSheetOpen(true);
    setDataExpandedView(false);
  };

  const handleLinkWebhook = (webhook: WebhookType) => {
    setLinkingWebhook(webhook);
    setLinkCode("");
    setIsLinkDialogOpen(true);
  };

  const getWebhookData = (webhookId: string) => {
    // Check if this webhook is linked to another webhook
    const webhook = webhooks.find(w => w.id === webhookId);
    const effectiveWebhookId = webhook?.linkedWebhookId || webhookId;
    return webhookDataList.filter(data => data.webhookId === effectiveWebhookId);
  };

  // Get linked webhook info for display (looks up code from registry)
  const getLinkedWebhookInfo = (linkedWebhookId: string | null | undefined) => {
    if (!linkedWebhookId) return null;
    // First check local webhooks
    const localWebhook = webhooks.find(w => w.id === linkedWebhookId);
    if (localWebhook) return { name: localWebhook.name, code: localWebhook.uniqueCode };
    // Then check registry (for production webhooks synced from production)
    const registryEntry = webhookRegistry.find(r => r.webhookId === linkedWebhookId);
    if (registryEntry) return { name: registryEntry.webhookName, code: registryEntry.uniqueCode };
    // Fallback
    return { name: "Production", code: linkedWebhookId.slice(0, 6).toUpperCase() };
  };

  // Default field configuration (19 fields)
  const DEFAULT_FIELD_CONFIG = [
    { name: "Time Unix", key: "timeUnix", type: "timestamp", order: 0 },
    { name: "Exchange", key: "exchange", type: "text", order: 1 },
    { name: "Ticker (Indices)", key: "indices", type: "text", order: 2 },
    { name: "Indicator", key: "indicator", type: "text", order: 3 },
    { name: "Action (Alert)", key: "alert", type: "text", order: 4 },
    { name: "Price", key: "price", type: "number", order: 5 },
    { name: "Local Time", key: "localTime", type: "text", order: 6 },
    { name: "Mode", key: "mode", type: "text", order: 7 },
    { name: "Mode Desc", key: "modeDesc", type: "text", order: 8 },
    { name: "Fast Line", key: "firstLine", type: "number", order: 9 },
    { name: "Mid Line", key: "midLine", type: "number", order: 10 },
    { name: "Slow Line", key: "slowLine", type: "number", order: 11 },
    { name: "Supertrend (ST)", key: "st", type: "number", order: 12 },
    { name: "Half Trend (HT)", key: "ht", type: "number", order: 13 },
    { name: "RSI", key: "rsi", type: "number", order: 14 },
    { name: "RSI Scaled", key: "rsiScaled", type: "number", order: 15 },
    { name: "Alert System", key: "alertSystem", type: "text", order: 16 },
    { name: "Action Binary", key: "actionBinary", type: "number", order: 17 },
    { name: "Lock State", key: "lockState", type: "text", order: 18 }
  ];

  // Get field config for a webhook (parse from fieldConfig string or use default)
  // For data display, always use default config because data is stored with standard field names
  const getFieldConfig = (webhook: WebhookType | null, forDataDisplay: boolean = false) => {
    // When displaying data, always use default config for consistency
    // Data is stored with standard field names (timeUnix, exchange, indices, etc.)
    if (forDataDisplay) {
      return DEFAULT_FIELD_CONFIG;
    }
    if (!webhook?.fieldConfig) return DEFAULT_FIELD_CONFIG;
    try {
      return JSON.parse(webhook.fieldConfig);
    } catch {
      return DEFAULT_FIELD_CONFIG;
    }
  };

  // Get value from data object by key
  const getDataValue = (data: WebhookData, key: string): string | number | null => {
    const keyMap: Record<string, keyof WebhookData> = {
      timeUnix: 'timeUnix', time_unix: 'timeUnix',
      exchange: 'exchange',
      indices: 'indices', ticker: 'indices', ticker_indices: 'indices',
      indicator: 'indicator',
      alert: 'alert', action: 'alert', action_alert: 'alert',
      price: 'price',
      localTime: 'localTime', local_time: 'localTime',
      mode: 'mode',
      modeDesc: 'modeDesc', mode_desc: 'modeDesc',
      firstLine: 'firstLine', first_line: 'firstLine', fast_line: 'firstLine',
      midLine: 'midLine', mid_line: 'midLine',
      slowLine: 'slowLine', slow_line: 'slowLine',
      st: 'st', supertrend: 'st', supertrend_st: 'st',
      ht: 'ht', halftrend: 'ht', half_trend: 'ht', half_trend_ht: 'ht',
      rsi: 'rsi',
      rsiScaled: 'rsiScaled', rsi_scaled: 'rsiScaled',
      alertSystem: 'alertSystem', alert_system: 'alertSystem',
      actionBinary: 'actionBinary', action_binary: 'actionBinary',
      lockState: 'lockState', lock_state: 'lockState'
    };
    const mappedKey = keyMap[key] || key;
    const value = data[mappedKey as keyof WebhookData];
    return value as string | number | null;
  };

  // Render cell value with special formatting for Action (Alert) field
  const renderCellValue = (data: WebhookData, field: { key: string; name: string }) => {
    const value = getDataValue(data, field.key);
    
    // Special handling for alert/action field
    if (field.key === 'alert' || field.name.toLowerCase().includes('alert') || field.name.toLowerCase().includes('action')) {
      if (value && typeof value === 'string') {
        return (
          <Badge 
            variant="default" 
            className={`font-mono text-xs tracking-wide px-1 py-0 ${
              value.toUpperCase().includes("SELL") 
                ? "bg-red-600 text-white" 
                : value.toUpperCase().includes("BUY") 
                  ? "bg-emerald-600 text-white" 
                  : "bg-slate-600 text-white"
            }`}
          >
            {value}
          </Badge>
        );
      }
    }
    
    return value != null ? String(value) : "-";
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const generateSecretKey = () => {
    const key = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    setFormData({ ...formData, secretKey: key });
  };

  const getWebhookUrl = (webhook: WebhookType) => {
    if (domainName) {
      return `https://${domainName}/api/webhook/${webhook.id}`;
    }
    return webhook.webhookUrl;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-webhooks-title">Webhooks</h1>
              <p className="text-muted-foreground text-sm">Configure trading webhooks for TradingView alerts</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Link href="/">
                <Button variant="outline" size="sm" data-testid="button-home">
                  <Home className="w-4 h-4 mr-2" />
                  Home
                </Button>
              </Link>
              <Button 
                variant="outline" 
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                data-testid="button-sync-production"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                {syncMutation.isPending ? "Syncing..." : "Sync from Production"}
              </Button>
              <Dialog open={isDialogOpen} onOpenChange={(open) => {
                setIsDialogOpen(open);
                if (!open) {
                  setEditingWebhook(null);
                  resetForm();
                }
              }}>
                <DialogTrigger asChild>
                  <Button data-testid="button-new-webhook">
                    <Plus className="w-4 h-4 mr-2" />
                    New Webhook
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>{editingWebhook ? "Edit Webhook" : "Create New Webhook"}</DialogTitle>
                    <DialogDescription>
                      Configure webhook settings for automated trading
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div>
                      <Label>Webhook Name</Label>
                      <Input
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="TradingView Alert"
                        data-testid="input-webhook-name"
                      />
                    </div>

                    <div>
                      <Label>Strategy (Optional)</Label>
                      <Select
                        value={formData.strategyId || "none"}
                        onValueChange={(value) => setFormData({ ...formData, strategyId: value === "none" ? "" : value })}
                      >
                        <SelectTrigger data-testid="select-webhook-strategy">
                          <SelectValue placeholder="Select a strategy" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No Strategy</SelectItem>
                          {strategies.map((strategy) => (
                            <SelectItem key={strategy.id} value={strategy.id}>
                              {strategy.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Trigger Type</Label>
                      <Select
                        value={formData.triggerType}
                        onValueChange={(value) => setFormData({ ...formData, triggerType: value })}
                      >
                        <SelectTrigger data-testid="select-trigger-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="entry">Entry Only</SelectItem>
                          <SelectItem value="exit">Exit Only</SelectItem>
                          <SelectItem value="both">Both</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Secret Key</Label>
                      <div className="flex gap-2">
                        <Input
                          value={formData.secretKey || ""}
                          onChange={(e) => setFormData({ ...formData, secretKey: e.target.value })}
                          placeholder="Your secret key"
                          data-testid="input-secret-key"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={generateSecretKey}
                          data-testid="button-generate-key"
                        >
                          Generate
                        </Button>
                      </div>
                    </div>

                    <Button
                      onClick={handleSubmit}
                      disabled={!formData.name || createMutation.isPending || updateMutation.isPending}
                      data-testid="button-save-webhook"
                    >
                      {createMutation.isPending || updateMutation.isPending ? "Saving..." : (editingWebhook ? "Update Webhook" : "Create Webhook")}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Domain Configuration */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Domain Configuration
            </CardTitle>
            <CardDescription>
              Set your domain name to auto-generate webhook URLs for TradingView
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label>Domain Name</Label>
                <Input
                  value={tempDomainName}
                  onChange={(e) => setTempDomainName(e.target.value)}
                  placeholder="your-app.replit.app"
                  data-testid="input-domain-name"
                />
              </div>
              <Button
                onClick={() => saveDomainMutation.mutate(tempDomainName)}
                disabled={saveDomainMutation.isPending || !tempDomainName}
                data-testid="button-save-domain"
              >
                <Save className="w-4 h-4 mr-2" />
                {saveDomainMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
            {domainName && (
              <p className="text-sm text-muted-foreground mt-2">
                Webhook URLs will be generated as: <code className="bg-muted px-1 rounded">https://{domainName}/api/webhook/[id]</code>
              </p>
            )}
          </CardContent>
        </Card>

        <Tabs 
          defaultValue="webhooks" 
          className="space-y-4"
        >
          <TabsList className="bg-card border border-border" data-testid="tabs-webhooks">
            <TabsTrigger value="webhooks">Webhooks ({webhooks.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="webhooks">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : webhooks.length === 0 ? (
              <Card className="text-center py-12">
                <CardContent>
                  <Webhook className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No Webhooks Yet</h3>
                  <p className="text-muted-foreground mb-4">Create your first webhook to receive trading signals</p>
                  <Button onClick={() => setIsDialogOpen(true)} data-testid="button-create-first-webhook">
                    <Plus className="w-4 h-4 mr-2" />
                    Create Webhook
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {webhooks.map((webhook) => (
                  <Card key={webhook.id} data-testid={`card-webhook-${webhook.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start gap-4 flex-wrap">
                        <div>
                          <CardTitle className="flex items-center gap-2 flex-wrap">
                            {webhook.name}
                            <Badge 
                              variant="secondary" 
                              className="font-mono text-xs flex items-center gap-1"
                              data-testid={`badge-code-${webhook.id}`}
                            >
                              <span>{envPrefix}-{webhook.uniqueCode}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 p-0 hover:bg-transparent"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(`${envPrefix}-${webhook.uniqueCode}`);
                                  toast({ title: "Short code copied!" });
                                }}
                                title="Copy short code"
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                              <span className="text-muted-foreground">|</span>
                              <span className="truncate max-w-[180px]">{webhook.id}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 p-0 hover:bg-transparent"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(webhook.id);
                                  toast({ title: "Webhook ID copied!" });
                                }}
                                title="Copy full ID"
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </Badge>
                            <Badge variant={webhook.isActive ? "default" : "secondary"}>
                              {webhook.isActive ? "Active" : "Inactive"}
                            </Badge>
                            <Badge variant="outline">{webhook.triggerType}</Badge>
                            {webhook.linkedWebhookId && (
                              <Badge variant="outline" className="flex items-center gap-1 text-primary border-primary">
                                <Link2 className="w-3 h-3" />
                                Linked: P-{getLinkedWebhookInfo(webhook.linkedWebhookId)?.code}
                              </Badge>
                            )}
                            {webhook.linkedByWebhooks && webhook.linkedByWebhooks.length > 0 && (
                              <Badge 
                                variant="outline" 
                                className="flex items-center gap-1 text-emerald-500 border-emerald-500"
                                data-testid={`badge-linked-by-${webhook.id}`}
                              >
                                <Link2 className="w-3 h-3" />
                                Linked by: {webhook.linkedByWebhooks.map(code => `D-${code}`).join(", ")}
                              </Badge>
                            )}
                          </CardTitle>
                          <CardDescription className="flex items-center gap-2 mt-1">
                            <span className="truncate max-w-md font-mono text-xs">{getWebhookUrl(webhook)}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => copyToClipboard(getWebhookUrl(webhook))}
                              data-testid={`button-copy-url-${webhook.id}`}
                            >
                              <Copy className="w-3 h-3" />
                            </Button>
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => testMutation.mutate(webhook.id)}
                            disabled={testMutation.isPending}
                            data-testid={`button-test-webhook-${webhook.id}`}
                          >
                            <Play className="w-4 h-4 mr-1" />
                            Test
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewData(webhook)}
                            data-testid={`button-view-data-${webhook.id}`}
                          >
                            <Activity className="w-4 h-4 mr-1" />
                            Data ({getWebhookData(webhook.id).length})
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewLogs(webhook)}
                            data-testid={`button-view-logs-${webhook.id}`}
                          >
                            <FileText className="w-4 h-4 mr-1" />
                            Logs
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyToClipboard(getWebhookUrl(webhook))}
                            data-testid={`button-copy-url-${webhook.id}`}
                          >
                            <Copy className="w-4 h-4 mr-1" />
                            Copy URL
                          </Button>
                          <Switch
                            checked={webhook.isActive}
                            onCheckedChange={(checked) => toggleMutation.mutate({ id: webhook.id, isActive: checked })}
                            data-testid={`switch-webhook-${webhook.id}`}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleConfigureFields(webhook)}
                            title="Configure Fields"
                            data-testid={`button-configure-fields-${webhook.id}`}
                          >
                            <Wrench className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => webhook.linkedWebhookId ? unlinkMutation.mutate(webhook.id) : handleLinkWebhook(webhook)}
                            title={webhook.linkedWebhookId ? "Unlink from Production" : "Link to Production"}
                            data-testid={`button-link-webhook-${webhook.id}`}
                          >
                            {webhook.linkedWebhookId ? (
                              <Unlink className="w-4 h-4 text-primary" />
                            ) : (
                              <Link2 className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(webhook)}
                            data-testid={`button-edit-webhook-${webhook.id}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(webhook.id)}
                            data-testid={`button-delete-webhook-${webhook.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Total Triggers</p>
                          <p className="font-medium">{webhook.totalTriggers || 0}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Last Triggered</p>
                          <p className="font-medium text-xs">{webhook.lastTriggered ? new Date(webhook.lastTriggered).toLocaleString() : "Never"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Secret Key</p>
                          <div className="flex items-center gap-1">
                            <p className="font-medium font-mono text-xs truncate max-w-[120px]">
                              {webhook.secretKey 
                                ? (showSecretKey[webhook.id] ? webhook.secretKey : "••••••••••••")
                                : "Not set"}
                            </p>
                            {webhook.secretKey && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => setShowSecretKey(prev => ({ ...prev, [webhook.id]: !prev[webhook.id] }))}
                                  data-testid={`button-toggle-secret-${webhook.id}`}
                                >
                                  {showSecretKey[webhook.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => copyToClipboard(webhook.secretKey!)}
                                  data-testid={`button-copy-secret-${webhook.id}`}
                                >
                                  <Copy className="w-3 h-3" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                        <WebhookStatsDisplay webhookId={webhook.id} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

        </Tabs>
      </div>

      <Sheet open={isDataSheetOpen} onOpenChange={setIsDataSheetOpen}>
        <SheetContent className={dataExpandedView ? "w-full sm:max-w-full" : "w-[600px] sm:w-[800px]"} side="right">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <div>
                <SheetTitle>Webhook Data: {selectedWebhook?.name}</SheetTitle>
                <SheetDescription>
                  {getFieldConfig(selectedWebhook, true).length} fields from incoming webhook data
                </SheetDescription>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => selectedWebhook && handleConfigureFields(selectedWebhook)}
                  data-testid="button-configure-from-panel"
                  title="Configure fields"
                >
                  <Wrench className="w-4 h-4" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={clearDataMutation.isPending || selectedWebhookData.length === 0}
                      data-testid="button-clear-webhook-data"
                      title="Clear data"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => clearDataMutation.mutate(1)} data-testid="clear-data-1-day">
                      Older than 1 day
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => clearDataMutation.mutate(7)} data-testid="clear-data-7-days">
                      Older than 7 days
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => clearDataMutation.mutate(30)} data-testid="clear-data-30-days">
                      Older than 30 days
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => clearDataMutation.mutate("all")} data-testid="clear-data-all" className="text-destructive">
                      Clear All Data
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setDataExpandedView(!dataExpandedView)}
                  data-testid="button-expand-data"
                  title={dataExpandedView ? "Collapse" : "Expand"}
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </SheetHeader>
          <div className="mt-6 overflow-x-auto">
            {selectedWebhookData.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No data received yet for this webhook.</p>
            ) : (
              <>
                {/* Warning banner for empty payloads */}
                {selectedWebhookData.some(d => d.rawPayload === '{}' || d.rawPayload === '') && (
                  <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-md">
                    <p className="text-amber-500 text-sm font-medium flex items-center gap-2">
                      <XCircle className="w-4 h-4" />
                      Empty payloads detected - Check your make.com/TradingView configuration
                    </p>
                    <p className="text-amber-400/80 text-xs mt-1">
                      Some webhook calls received empty JSON bodies. Ensure your alert message contains the required fields.
                    </p>
                  </div>
                )}
                <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    {getFieldConfig(selectedWebhook, true).map((field: { name: string; key: string }) => (
                      <TableHead 
                        key={field.key} 
                        className="whitespace-nowrap px-1 py-1"
                      >
                        {field.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedWebhookData.map((data) => (
                    <TableRow key={data.id} data-testid={`row-data-panel-${data.id}`}>
                      {getFieldConfig(selectedWebhook, true).map((field: { name: string; key: string }) => (
                        <TableCell 
                          key={field.key} 
                          className="whitespace-nowrap px-1 py-1"
                        >
                          {renderCellValue(data, field)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
                </Table>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Status Logs Sheet */}
      <Sheet open={isLogsSheetOpen} onOpenChange={setIsLogsSheetOpen}>
        <SheetContent className="w-[500px] sm:w-[600px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Webhook Logs: {selectedWebhook?.name}</SheetTitle>
            <SheetDescription>
              Test and status logs for this webhook
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            {selectedWebhook && (
              <div className="flex gap-2">
                <Button
                  onClick={() => testMutation.mutate(selectedWebhook.id)}
                  disabled={testMutation.isPending}
                  data-testid="button-test-webhook-sheet"
                >
                  <Play className="w-4 h-4 mr-2" />
                  {testMutation.isPending ? "Testing..." : "Send Test"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => copyToClipboard(getWebhookUrl(selectedWebhook))}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy URL
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Status Logs</h4>
                {statusLogs.length > 0 && selectedWebhook && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => cleanupMutation.mutate({ id: selectedWebhook.id, days: 30 })}
                    disabled={cleanupMutation.isPending}
                    data-testid="button-cleanup-logs"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Clean Old Logs
                  </Button>
                )}
              </div>
              {statusLogs.length === 0 ? (
                <p className="text-muted-foreground text-sm">No status logs yet</p>
              ) : (
                <div className="space-y-2">
                  {statusLogs.map((log) => (
                    <Card key={log.id} className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            {log.status === "success" ? (
                              <CheckCircle className="w-4 h-4 text-primary" />
                            ) : (
                              <XCircle className="w-4 h-4 text-destructive" />
                            )}
                            <span className="font-medium text-sm">{log.status === "success" ? "Success" : "Failed"}</span>
                            {log.statusCode && (
                              <Badge variant="outline" className="text-xs">{log.statusCode}</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <span>{new Date(log.testedAt).toLocaleString()}</span>
                            {log.responseTime && (
                              <span className="flex items-center gap-1">
                                <Timer className="w-3 h-3" />
                                {log.responseTime}ms
                              </span>
                            )}
                          </div>
                          {log.responseMessage && (
                            <p className="text-xs mt-1">{log.responseMessage}</p>
                          )}
                          {log.errorMessage && (
                            <p className="text-xs text-destructive mt-1">{log.errorMessage}</p>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Field Configuration Dialog */}
      <Dialog open={isFieldConfigOpen} onOpenChange={(open) => {
        setIsFieldConfigOpen(open);
        if (!open) {
          setConfigWebhook(null);
          setFieldConfigText("");
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configure Webhook Fields</DialogTitle>
            <DialogDescription>
              Define the field names for webhook data. Enter comma-separated field names in the order they should appear.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label className="mb-2 block">Webhook: {configWebhook?.name}</Label>
              <Textarea
                value={fieldConfigText}
                onChange={(e) => setFieldConfigText(e.target.value)}
                placeholder="Time Unix, Exchange, Ticker (Indices), Indicator, Action (Alert), Price..."
                className="min-h-[120px] font-mono text-sm"
                data-testid="textarea-field-config"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Enter field names separated by commas. These will be used as column headers in the data table.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setFieldConfigText("Time Unix, Exchange, Ticker (Indices), Indicator, Action (Alert), Price, Local Time, Mode, Mode Desc, Fast Line, Mid Line, Slow Line, Supertrend (ST), Half Trend (HT), RSI, RSI Scaled, Alert System, Action Binary, Lock State")}
                data-testid="button-use-default-fields"
              >
                Use Default 19 Fields
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setFieldConfigText("")}
                data-testid="button-clear-fields"
              >
                Clear
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button 
              variant="outline" 
              onClick={() => setIsFieldConfigOpen(false)}
              data-testid="button-cancel-field-config"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSaveFieldConfig}
              disabled={configureFieldsMutation.isPending}
              data-testid="button-save-field-config"
            >
              {configureFieldsMutation.isPending ? "Saving..." : "Save Configuration"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Link Webhook Dialog */}
      <Dialog open={isLinkDialogOpen} onOpenChange={(open) => {
        setIsLinkDialogOpen(open);
        if (!open) {
          setLinkingWebhook(null);
          setLinkCode("");
          setLinkWebhookId("");
          setLinkMode("code");
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link to Production Webhook</DialogTitle>
            <DialogDescription>
              Link this webhook to a production webhook to view its data stream. This allows development webhooks to access live production data.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label className="mb-2 block">Current Webhook: {linkingWebhook?.name}</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Code: <code className="bg-muted px-1 rounded font-mono">{envPrefix}-{linkingWebhook?.uniqueCode}</code>
              </p>
            </div>
            
            <div className="flex gap-2 mb-2">
              <Button
                variant={linkMode === "code" ? "default" : "outline"}
                size="sm"
                onClick={() => setLinkMode("code")}
                data-testid="button-link-mode-code"
              >
                By Code
              </Button>
              <Button
                variant={linkMode === "id" ? "default" : "outline"}
                size="sm"
                onClick={() => setLinkMode("id")}
                data-testid="button-link-mode-id"
              >
                By Webhook ID
              </Button>
            </div>
            
            {linkMode === "code" ? (
              <div>
                <Label className="mb-2 block">Enter Production Webhook Code (e.g., P-JZGLZS)</Label>
                <Input
                  value={linkCode}
                  onChange={(e) => setLinkCode(e.target.value.toUpperCase())}
                  placeholder="e.g., P-JZGLZS"
                  className="font-mono uppercase"
                  maxLength={10}
                  data-testid="input-link-code"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Enter the 6-character unique code of the production webhook.
                  Use this when both environments share the same database.
                </p>
              </div>
            ) : (
              <div>
                <Label className="mb-2 block">Enter Production Webhook ID</Label>
                <Input
                  value={linkWebhookId}
                  onChange={(e) => setLinkWebhookId(e.target.value)}
                  placeholder="e.g., abc123de-f456-7890-abcd-ef1234567890"
                  className="font-mono text-xs"
                  data-testid="input-link-webhook-id"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Enter the full webhook ID (UUID) from the production webhook URL.
                  Use this when production has a separate database.
                </p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button 
              variant="outline" 
              onClick={() => setIsLinkDialogOpen(false)}
              data-testid="button-cancel-link"
            >
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (linkingWebhook) {
                  if (linkMode === "code" && linkCode.trim()) {
                    linkMutation.mutate({ id: linkingWebhook.id, uniqueCode: linkCode.trim() });
                  } else if (linkMode === "id" && linkWebhookId.trim()) {
                    linkMutation.mutate({ id: linkingWebhook.id, webhookId: linkWebhookId.trim() });
                  }
                }
              }}
              disabled={(linkMode === "code" ? !linkCode.trim() : !linkWebhookId.trim()) || linkMutation.isPending}
              data-testid="button-save-link"
            >
              {linkMutation.isPending ? "Linking..." : "Link Webhook"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WebhookStatsDisplay({ webhookId }: { webhookId: string }) {
  const { data: stats } = useQuery<WebhookStats>({
    queryKey: ["/api/webhooks", webhookId, "stats"],
    queryFn: async () => {
      const res = await fetch(`/api/webhooks/${webhookId}/stats`);
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  if (!stats || stats.total === 0) {
    return (
      <div>
        <p className="text-muted-foreground">Stats</p>
        <p className="font-medium text-xs text-muted-foreground">No tests yet</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-muted-foreground">Stats</p>
      <div className="flex items-center gap-2">
        <Badge variant={stats.successRate >= 80 ? "default" : stats.successRate >= 50 ? "secondary" : "destructive"} className="text-xs">
          {stats.successRate}% success
        </Badge>
        {stats.avgResponseTime > 0 && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Timer className="w-3 h-3" />
            {stats.avgResponseTime}ms
          </span>
        )}
      </div>
    </div>
  );
}

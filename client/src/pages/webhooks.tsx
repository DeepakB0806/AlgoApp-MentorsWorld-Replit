import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Home, Plus, Webhook, Trash2, Edit, Copy, Clock, CheckCircle, XCircle, Play, Settings, FileText, ExternalLink, Save, Eye, EyeOff, Activity, Timer } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Webhook as WebhookType, WebhookLog, InsertWebhook, Strategy, WebhookStatusLog, AppSetting } from "@shared/schema";

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
  const [isLogsSheetOpen, setIsLogsSheetOpen] = useState(false);
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

  const { data: webhookLogs = [] } = useQuery<WebhookLog[]>({
    queryKey: ["/api/webhook-logs"],
  });

  const { data: strategies = [] } = useQuery<Strategy[]>({
    queryKey: ["/api/strategies"],
  });

  const { data: statusLogs = [] } = useQuery<WebhookStatusLog[]>({
    queryKey: ["/api/webhooks", selectedWebhook?.id, "status-logs"],
    enabled: !!selectedWebhook,
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

        <Tabs defaultValue="webhooks" className="space-y-4">
          <TabsList className="bg-card border border-border" data-testid="tabs-webhooks">
            <TabsTrigger value="webhooks">Webhooks ({webhooks.length})</TabsTrigger>
            <TabsTrigger value="logs">Logs ({webhookLogs.length})</TabsTrigger>
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
                          <CardTitle className="flex items-center gap-2">
                            {webhook.name}
                            <Badge variant={webhook.isActive ? "default" : "secondary"}>
                              {webhook.isActive ? "Active" : "Inactive"}
                            </Badge>
                            <Badge variant="outline">{webhook.triggerType}</Badge>
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

          <TabsContent value="logs">
            <Card>
              <CardHeader>
                <CardTitle>Webhook Logs</CardTitle>
                <CardDescription>Recent webhook trigger history with TradingView data</CardDescription>
              </CardHeader>
              <CardContent>
                {webhookLogs.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8" data-testid="text-no-logs">No webhook logs yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Exchange</TableHead>
                        <TableHead>Indicator</TableHead>
                        <TableHead>Alert</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Execution</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {webhookLogs.map((log) => (
                        <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                          <TableCell className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs">{new Date(log.timestamp).toLocaleString()}</span>
                          </TableCell>
                          <TableCell>
                            {log.status === "success" ? (
                              <Badge variant="default" className="flex items-center gap-1 w-fit">
                                <CheckCircle className="w-3 h-3" />
                                OK
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                                <XCircle className="w-3 h-3" />
                                Fail
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{log.exchange || "-"}</TableCell>
                          <TableCell>{log.indicator || "-"}</TableCell>
                          <TableCell className="max-w-xs truncate">{log.alert || "-"}</TableCell>
                          <TableCell>{log.price ? log.price.toFixed(2) : "-"}</TableCell>
                          <TableCell>
                            {log.actionBinary === 1 ? (
                              <Badge variant="default">BUY</Badge>
                            ) : log.actionBinary === 0 ? (
                              <Badge variant="destructive">SELL</Badge>
                            ) : "-"}
                          </TableCell>
                          <TableCell>{log.executionTime}ms</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

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
              <h4 className="font-medium">Status Logs</h4>
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

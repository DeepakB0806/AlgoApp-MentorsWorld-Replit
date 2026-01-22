import { useState } from "react";
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
import { Home, Plus, Webhook, Trash2, Edit, Copy, Clock, CheckCircle, XCircle } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Webhook as WebhookType, WebhookLog, InsertWebhook, Strategy } from "@shared/schema";

export default function Webhooks() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookType | null>(null);
  const [formData, setFormData] = useState<Partial<InsertWebhook>>({
    name: "",
    strategyId: "",
    webhookUrl: "",
    secretKey: "",
    isActive: true,
    triggerType: "both",
  });

  const { data: webhooks = [], isLoading } = useQuery<WebhookType[]>({
    queryKey: ["/api/webhooks"],
  });

  const { data: webhookLogs = [] } = useQuery<WebhookLog[]>({
    queryKey: ["/api/webhook-logs"],
  });

  const { data: strategies = [] } = useQuery<Strategy[]>({
    queryKey: ["/api/strategies"],
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
    if (editingWebhook) {
      updateMutation.mutate({ id: editingWebhook.id, data: formData });
    } else {
      createMutation.mutate(formData);
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
                      <Label>Webhook URL</Label>
                      <Input
                        value={formData.webhookUrl}
                        onChange={(e) => setFormData({ ...formData, webhookUrl: e.target.value })}
                        placeholder="https://your-domain.com/webhook"
                        data-testid="input-webhook-url"
                      />
                    </div>

                    <div>
                      <Label>Secret Key</Label>
                      <div className="flex gap-2">
                        <Input
                          value={formData.secretKey}
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
                      disabled={!formData.name || !formData.webhookUrl || createMutation.isPending || updateMutation.isPending}
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
                            <span className="truncate max-w-md">{webhook.webhookUrl}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => copyToClipboard(webhook.webhookUrl)}
                            >
                              <Copy className="w-3 h-3" />
                            </Button>
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
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
                      <div className="grid md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Total Triggers</p>
                          <p className="font-medium">{webhook.totalTriggers || 0}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Last Triggered</p>
                          <p className="font-medium">{webhook.lastTriggered || "Never"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Secret Key</p>
                          <p className="font-medium font-mono text-xs truncate">{webhook.secretKey ? "••••••••" : "Not set"}</p>
                        </div>
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
                <CardDescription>Recent webhook trigger history</CardDescription>
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
                        <TableHead>Execution Time</TableHead>
                        <TableHead>Response</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {webhookLogs.map((log) => (
                        <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                          <TableCell className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-muted-foreground" />
                            {log.timestamp}
                          </TableCell>
                          <TableCell>
                            {log.status === "success" ? (
                              <Badge variant="default" className="flex items-center gap-1 w-fit">
                                <CheckCircle className="w-3 h-3" />
                                Success
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                                <XCircle className="w-3 h-3" />
                                Failed
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{log.executionTime}ms</TableCell>
                          <TableCell className="max-w-xs truncate">{log.response}</TableCell>
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
    </div>
  );
}

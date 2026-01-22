import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Home, Plus, Key, Trash2, Edit, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BrokerConfig, InsertBrokerConfig } from "@shared/schema";

export default function BrokerApi() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<BrokerConfig | null>(null);
  const [formData, setFormData] = useState<Partial<InsertBrokerConfig>>({
    brokerName: "kotak_neo",
    consumerKey: "",
    consumerSecret: "",
    mobileNumber: "",
  });

  const { data: brokerConfigs = [], isLoading } = useQuery<BrokerConfig[]>({
    queryKey: ["/api/broker-configs"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<InsertBrokerConfig>) => {
      return apiRequest("POST", "/api/broker-configs", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
      setIsDialogOpen(false);
      resetForm();
      toast({ title: "Broker configuration saved successfully" });
    },
    onError: () => {
      toast({ title: "Failed to save broker configuration", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertBrokerConfig> }) => {
      return apiRequest("PATCH", `/api/broker-configs/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
      setIsDialogOpen(false);
      setEditingConfig(null);
      resetForm();
      toast({ title: "Broker configuration updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update broker configuration", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/broker-configs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
      toast({ title: "Broker configuration deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete broker configuration", variant: "destructive" });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/broker-configs/${id}/test`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
      toast({ title: "Connection test successful" });
    },
    onError: () => {
      toast({ title: "Connection test failed", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      brokerName: "kotak_neo",
      consumerKey: "",
      consumerSecret: "",
      mobileNumber: "",
    });
  };

  const handleSubmit = () => {
    if (editingConfig) {
      updateMutation.mutate({ id: editingConfig.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (config: BrokerConfig) => {
    setEditingConfig(config);
    setFormData({
      brokerName: config.brokerName,
      consumerKey: config.consumerKey || "",
      consumerSecret: config.consumerSecret || "",
      mobileNumber: config.mobileNumber || "",
    });
    setIsDialogOpen(true);
  };

  const getBrokerDisplayName = (brokerName: string) => {
    const names: Record<string, string> = {
      kotak_neo: "Kotak Neo",
      zerodha: "Zerodha Kite",
      angel: "Angel Broking",
      upstox: "Upstox",
      fyers: "Fyers",
    };
    return names[brokerName] || brokerName;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-broker-title">Broker & Exchange API</h1>
              <p className="text-muted-foreground text-sm">Manage your broker API credentials</p>
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
                  setEditingConfig(null);
                  resetForm();
                }
              }}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-broker">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Broker
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>{editingConfig ? "Edit Broker Configuration" : "Add Broker Configuration"}</DialogTitle>
                    <DialogDescription>
                      Enter your broker API credentials for automated trading
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div>
                      <Label>Broker</Label>
                      <Select
                        value={formData.brokerName}
                        onValueChange={(value) => setFormData({ ...formData, brokerName: value })}
                      >
                        <SelectTrigger data-testid="select-broker">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="kotak_neo">Kotak Neo</SelectItem>
                          <SelectItem value="zerodha">Zerodha Kite</SelectItem>
                          <SelectItem value="angel">Angel Broking</SelectItem>
                          <SelectItem value="upstox">Upstox</SelectItem>
                          <SelectItem value="fyers">Fyers</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Consumer Key / API Key</Label>
                      <Input
                        value={formData.consumerKey}
                        onChange={(e) => setFormData({ ...formData, consumerKey: e.target.value })}
                        placeholder="Enter your API key"
                        data-testid="input-consumer-key"
                      />
                    </div>

                    <div>
                      <Label>Consumer Secret / API Secret</Label>
                      <Input
                        type="password"
                        value={formData.consumerSecret}
                        onChange={(e) => setFormData({ ...formData, consumerSecret: e.target.value })}
                        placeholder="Enter your API secret"
                        data-testid="input-consumer-secret"
                      />
                    </div>

                    <div>
                      <Label>Mobile Number (for Kotak Neo)</Label>
                      <Input
                        value={formData.mobileNumber}
                        onChange={(e) => setFormData({ ...formData, mobileNumber: e.target.value })}
                        placeholder="Enter registered mobile number"
                        data-testid="input-mobile-number"
                      />
                    </div>

                    <div className="bg-muted/50 p-4 rounded-md">
                      <p className="text-sm text-muted-foreground">
                        <strong>Note:</strong> Your credentials are stored securely and used only to connect to your broker account for automated trading.
                      </p>
                    </div>

                    <Button
                      onClick={handleSubmit}
                      disabled={!formData.consumerKey || !formData.consumerSecret || createMutation.isPending || updateMutation.isPending}
                      data-testid="button-save-broker"
                    >
                      {createMutation.isPending || updateMutation.isPending ? "Saving..." : (editingConfig ? "Update Configuration" : "Save Configuration")}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : brokerConfigs.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <Key className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">No Broker Configurations</h3>
              <p className="text-muted-foreground mb-4">Add your broker API credentials to enable automated trading</p>
              <Button onClick={() => setIsDialogOpen(true)} data-testid="button-add-first-broker">
                <Plus className="w-4 h-4 mr-2" />
                Add Broker
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {brokerConfigs.map((config) => (
              <Card key={config.id} data-testid={`card-broker-${config.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {getBrokerDisplayName(config.brokerName)}
                      </CardTitle>
                      <CardDescription>
                        {config.isConnected ? (
                          <span className="flex items-center gap-1 text-primary">
                            <CheckCircle className="w-4 h-4" />
                            Connected
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <XCircle className="w-4 h-4" />
                            Not Connected
                          </span>
                        )}
                      </CardDescription>
                    </div>
                    <Badge variant={config.isConnected ? "default" : "secondary"}>
                      {config.isConnected ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">API Key</span>
                      <span className="font-mono">••••••••{config.consumerKey?.slice(-4) || "****"}</span>
                    </div>
                    {config.mobileNumber && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Mobile</span>
                        <span>••••••{config.mobileNumber.slice(-4)}</span>
                      </div>
                    )}
                    {config.lastConnected && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last Connected</span>
                        <span>{config.lastConnected}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => testConnectionMutation.mutate(config.id)}
                      disabled={testConnectionMutation.isPending}
                      data-testid={`button-test-${config.id}`}
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${testConnectionMutation.isPending ? "animate-spin" : ""}`} />
                      Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(config)}
                      data-testid={`button-edit-broker-${config.id}`}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteMutation.mutate(config.id)}
                      data-testid={`button-delete-broker-${config.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Supported Brokers</CardTitle>
            <CardDescription>Connect to your preferred broker for automated trading</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-4">
              {[
                { name: "Kotak Neo", status: "Supported", primary: true },
                { name: "Zerodha Kite", status: "Coming Soon" },
                { name: "Angel Broking", status: "Coming Soon" },
                { name: "Upstox", status: "Coming Soon" },
                { name: "Fyers", status: "Coming Soon" },
              ].map((broker) => (
                <div
                  key={broker.name}
                  className={`p-4 rounded-md border text-center ${
                    broker.primary ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <p className="font-medium">{broker.name}</p>
                  <Badge variant={broker.primary ? "default" : "secondary"} className="mt-2">
                    {broker.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

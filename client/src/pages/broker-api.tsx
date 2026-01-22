import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Home, Plus, Key, Trash2, Edit, CheckCircle, XCircle, RefreshCw, AlertTriangle, LogIn } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BrokerConfig, InsertBrokerConfig } from "@shared/schema";

interface TestResult {
  success: boolean;
  message: string;
  error?: string;
}

export default function BrokerApi() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const [authConfigId, setAuthConfigId] = useState<string | null>(null);
  const [totp, setTotp] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [editingConfig, setEditingConfig] = useState<BrokerConfig | null>(null);
  const [formData, setFormData] = useState<Partial<InsertBrokerConfig>>({
    brokerName: "kotak_neo",
    consumerKey: "",
    mobileNumber: "",
    ucc: "",
    mpin: "",
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
      const response = await apiRequest("POST", `/api/broker-configs/${id}/test`);
      return response.json();
    },
    onSuccess: (data: TestResult) => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
      setTestResult(data);
      if (data.success) {
        toast({ title: data.message || "Connection test successful" });
      } else {
        toast({ title: data.message || "Connection test failed", description: data.error, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      setTestResult({ success: false, message: "Connection test failed", error: error.message });
      toast({ title: "Connection test failed", variant: "destructive" });
    },
  });

  const authenticateMutation = useMutation({
    mutationFn: async ({ id, totp }: { id: string; totp: string }) => {
      const response = await apiRequest("POST", `/api/broker-configs/${id}/authenticate`, { totp });
      return response.json();
    },
    onSuccess: (data: TestResult) => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
      setIsAuthDialogOpen(false);
      setTotp("");
      setAuthConfigId(null);
      if (data.success) {
        toast({ title: "Authentication successful! Trading session is now active." });
      } else {
        toast({ title: "Authentication failed", description: data.error, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Authentication failed", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      brokerName: "kotak_neo",
      consumerKey: "",
      mobileNumber: "",
      ucc: "",
      mpin: "",
    });
    setTestResult(null);
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
      mobileNumber: config.mobileNumber || "",
      ucc: config.ucc || "",
      mpin: config.mpin || "",
    });
    setIsDialogOpen(true);
  };

  const handleAuthenticate = (configId: string) => {
    setAuthConfigId(configId);
    setIsAuthDialogOpen(true);
  };

  const handleAuthSubmit = () => {
    if (authConfigId && totp) {
      authenticateMutation.mutate({ id: authConfigId, totp });
    }
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
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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

                    {formData.brokerName === "kotak_neo" && (
                      <>
                        <div>
                          <Label>Consumer Key (API Token)</Label>
                          <Input
                            value={formData.consumerKey || ""}
                            onChange={(e) => setFormData({ ...formData, consumerKey: e.target.value })}
                            placeholder="Get this from Neo Dashboard > Invest > Trade API"
                            data-testid="input-consumer-key"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Login to neo.kotaksecurities.com, go to Invest → Trade API → Create Application
                          </p>
                        </div>

                        <div>
                          <Label>Mobile Number (with country code)</Label>
                          <Input
                            value={formData.mobileNumber || ""}
                            onChange={(e) => setFormData({ ...formData, mobileNumber: e.target.value })}
                            placeholder="+919876543210"
                            data-testid="input-mobile-number"
                          />
                        </div>

                        <div>
                          <Label>UCC (Unique Client Code)</Label>
                          <Input
                            value={formData.ucc || ""}
                            onChange={(e) => setFormData({ ...formData, ucc: e.target.value })}
                            placeholder="Your unique client code from Kotak"
                            data-testid="input-ucc"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Find this in your Neo profile or account statement
                          </p>
                        </div>

                        <div>
                          <Label>MPIN (6-digit)</Label>
                          <Input
                            type="password"
                            maxLength={6}
                            value={formData.mpin || ""}
                            onChange={(e) => setFormData({ ...formData, mpin: e.target.value })}
                            placeholder="Your 6-digit MPIN"
                            data-testid="input-mpin"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Set your MPIN in Neo web: Click initials → Account Details → MPIN
                          </p>
                        </div>

                        <Alert>
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription className="text-sm">
                            <strong>TOTP Required:</strong> You'll need to register TOTP using Google/Microsoft Authenticator. 
                            Visit kotaksecurities.com/platform/kotak-neo-trade-api/ to register.
                          </AlertDescription>
                        </Alert>
                      </>
                    )}

                    {formData.brokerName !== "kotak_neo" && (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          {getBrokerDisplayName(formData.brokerName || "")} integration is coming soon. 
                          Currently only Kotak Neo is fully supported.
                        </AlertDescription>
                      </Alert>
                    )}

                    <Button
                      onClick={handleSubmit}
                      disabled={formData.brokerName === "kotak_neo" && !formData.consumerKey || createMutation.isPending || updateMutation.isPending}
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

      <Dialog open={isAuthDialogOpen} onOpenChange={(open) => {
        setIsAuthDialogOpen(open);
        if (!open) {
          setTotp("");
          setAuthConfigId(null);
        }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enter TOTP</DialogTitle>
            <DialogDescription>
              Enter the 6-digit code from your authenticator app (Google/Microsoft Authenticator)
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label>TOTP Code</Label>
              <Input
                type="text"
                maxLength={6}
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="text-center text-2xl font-mono tracking-widest"
                data-testid="input-totp"
              />
            </div>
            <Button
              onClick={handleAuthSubmit}
              disabled={totp.length !== 6 || authenticateMutation.isPending}
              data-testid="button-submit-totp"
            >
              {authenticateMutation.isPending ? "Authenticating..." : "Authenticate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="container mx-auto px-4 py-6">
        {testResult && (
          <Alert className={`mb-4 ${testResult.success ? "border-primary" : "border-destructive"}`}>
            {testResult.success ? (
              <CheckCircle className="h-4 w-4 text-primary" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive" />
            )}
            <AlertDescription>
              <strong>{testResult.message}</strong>
              {testResult.error && <p className="text-sm mt-1">{testResult.error}</p>}
            </AlertDescription>
          </Alert>
        )}

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
                      <span className="font-mono">{config.consumerKey ? "••••" + config.consumerKey.slice(-4) : "Not set"}</span>
                    </div>
                    {config.mobileNumber && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Mobile</span>
                        <span>••••••{config.mobileNumber.slice(-4)}</span>
                      </div>
                    )}
                    {config.ucc && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">UCC</span>
                        <span>{config.ucc}</span>
                      </div>
                    )}
                    {config.lastConnected && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last Connected</span>
                        <span>{config.lastConnected}</span>
                      </div>
                    )}
                    {config.connectionError && (
                      <div className="text-destructive text-xs mt-2">
                        Error: {config.connectionError}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 flex-wrap">
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
                    {config.brokerName === "kotak_neo" && config.consumerKey && (
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleAuthenticate(config.id)}
                        disabled={authenticateMutation.isPending}
                        data-testid={`button-auth-${config.id}`}
                      >
                        <LogIn className="w-4 h-4 mr-2" />
                        Login
                      </Button>
                    )}
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
            <CardTitle>Kotak Neo API Setup Guide</CardTitle>
            <CardDescription>Follow these steps to connect your Kotak Neo account</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">1</div>
                <div>
                  <h4 className="font-medium">Get API Token (Consumer Key)</h4>
                  <p className="text-sm text-muted-foreground">
                    Login to <a href="https://neo.kotaksecurities.com" target="_blank" rel="noopener" className="text-primary underline">neo.kotaksecurities.com</a>, 
                    navigate to Invest → Trade API → Create Application, and copy your Token.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">2</div>
                <div>
                  <h4 className="font-medium">Register TOTP</h4>
                  <p className="text-sm text-muted-foreground">
                    Visit <a href="https://www.kotaksecurities.com/platform/kotak-neo-trade-api/totp-registration/" target="_blank" rel="noopener" className="text-primary underline">TOTP Registration</a>, 
                    scan the QR code with Google/Microsoft Authenticator.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">3</div>
                <div>
                  <h4 className="font-medium">Set MPIN</h4>
                  <p className="text-sm text-muted-foreground">
                    In Neo web, click your initials (top-right) → Account Details → Scroll to MPIN section → Create 6-digit MPIN.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">4</div>
                <div>
                  <h4 className="font-medium">Add Configuration & Login</h4>
                  <p className="text-sm text-muted-foreground">
                    Add your credentials above, click "Test" to verify connectivity, then "Login" with your TOTP to start trading.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
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

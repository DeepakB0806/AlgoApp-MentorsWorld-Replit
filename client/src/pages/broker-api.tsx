import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Home, Save, CheckCircle, XCircle, RefreshCw, AlertTriangle, LogIn, Key } from "lucide-react";
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
  const [totp, setTotp] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
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

  // Get the first Kotak Neo config (or undefined)
  const kotakConfig = brokerConfigs.find(c => c.brokerName === "kotak_neo");

  // Pre-fill form when config loads
  useEffect(() => {
    if (kotakConfig) {
      setFormData({
        brokerName: "kotak_neo",
        consumerKey: kotakConfig.consumerKey || "",
        mobileNumber: kotakConfig.mobileNumber || "",
        ucc: kotakConfig.ucc || "",
        mpin: kotakConfig.mpin || "",
      });
    }
  }, [kotakConfig]);

  const createMutation = useMutation({
    mutationFn: async (data: Partial<InsertBrokerConfig>) => {
      return apiRequest("POST", "/api/broker-configs", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
      toast({ title: "Credentials saved successfully" });
    },
    onError: () => {
      toast({ title: "Failed to save credentials", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertBrokerConfig> }) => {
      return apiRequest("PATCH", `/api/broker-configs/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
      toast({ title: "Credentials updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update credentials", variant: "destructive" });
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
      queryClient.invalidateQueries({ queryKey: ["/api/broker-session-status"] });
      setTotp("");
      if (data.success) {
        toast({ title: "Login successful! Trading session is now active." });
      } else {
        toast({ title: "Login failed", description: data.error, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
    },
  });

  const handleSaveCredentials = () => {
    if (kotakConfig) {
      updateMutation.mutate({ id: kotakConfig.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleLogin = () => {
    if (kotakConfig && totp.length === 6) {
      authenticateMutation.mutate({ id: kotakConfig.id, totp });
    }
  };

  const handleSaveAndLogin = async () => {
    // First save, then login
    if (totp.length !== 6) {
      toast({ title: "Please enter 6-digit TOTP", variant: "destructive" });
      return;
    }

    if (kotakConfig) {
      // Update existing config then login
      try {
        await apiRequest("PATCH", `/api/broker-configs/${kotakConfig.id}`, formData);
        queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
        authenticateMutation.mutate({ id: kotakConfig.id, totp });
      } catch {
        toast({ title: "Failed to save credentials", variant: "destructive" });
      }
    } else {
      // Create new config then login
      try {
        const response = await apiRequest("POST", "/api/broker-configs", formData);
        const newConfig = await response.json();
        queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
        authenticateMutation.mutate({ id: newConfig.id, totp });
      } catch {
        toast({ title: "Failed to save credentials", variant: "destructive" });
      }
    }
  };

  const isFormValid = formData.consumerKey && formData.mobileNumber && formData.ucc && formData.mpin;
  const canLogin = isFormValid && totp.length === 6;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-broker-title">Broker & Exchange API</h1>
              <p className="text-muted-foreground text-sm">Manage your Kotak Neo credentials</p>
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

      <div className="container mx-auto px-4 py-6 max-w-2xl">
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
        ) : (
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start gap-4 flex-wrap">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="w-5 h-5" />
                    Kotak Neo Credentials
                  </CardTitle>
                  <CardDescription>
                    {kotakConfig ? (
                      kotakConfig.isConnected ? (
                        <span className="flex items-center gap-1 text-primary mt-1">
                          <CheckCircle className="w-4 h-4" />
                          Connected - Session Active
                        </span>
                      ) : (
                        <span className="text-muted-foreground mt-1">
                          Credentials saved - Enter TOTP to login
                        </span>
                      )
                    ) : (
                      "Enter your credentials to connect"
                    )}
                  </CardDescription>
                </div>
                {kotakConfig && (
                  <Badge variant={kotakConfig.isConnected ? "default" : "secondary"}>
                    {kotakConfig.isConnected ? "Active" : "Saved"}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4">
                <div>
                  <Label>Consumer Key (API Token)</Label>
                  <Input
                    value={formData.consumerKey || ""}
                    onChange={(e) => setFormData({ ...formData, consumerKey: e.target.value })}
                    placeholder="Get this from Neo Dashboard > Invest > Trade API"
                    data-testid="input-consumer-key"
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label>Mobile Number</Label>
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
                      placeholder="Your client code"
                      data-testid="input-ucc"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
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
                  </div>

                  <div>
                    <Label>TOTP (from Authenticator App)</Label>
                    <Input
                      type="text"
                      maxLength={6}
                      value={totp}
                      onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                      placeholder="123456"
                      className="font-mono tracking-widest"
                      data-testid="input-totp"
                    />
                  </div>
                </div>

                {kotakConfig?.lastConnected && (
                  <p className="text-xs text-muted-foreground">
                    Last connected: {kotakConfig.lastConnected}
                  </p>
                )}

                {kotakConfig?.connectionError && (
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>{kotakConfig.connectionError}</AlertDescription>
                  </Alert>
                )}
              </div>

              <div className="flex gap-2 pt-4 flex-wrap">
                <Button
                  variant="outline"
                  onClick={handleSaveCredentials}
                  disabled={!isFormValid || isSaving}
                  data-testid="button-save"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {isSaving ? "Saving..." : "Save Credentials"}
                </Button>

                {kotakConfig && (
                  <Button
                    variant="outline"
                    onClick={() => testConnectionMutation.mutate(kotakConfig.id)}
                    disabled={testConnectionMutation.isPending}
                    data-testid="button-test"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${testConnectionMutation.isPending ? "animate-spin" : ""}`} />
                    Test Connection
                  </Button>
                )}

                <Button
                  onClick={handleSaveAndLogin}
                  disabled={!canLogin || authenticateMutation.isPending || isSaving}
                  className="flex-1 min-w-[200px]"
                  data-testid="button-save-and-login"
                >
                  <LogIn className="w-4 h-4 mr-2" />
                  {authenticateMutation.isPending ? "Logging in..." : "Save & Login with TOTP"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Setup Guide</CardTitle>
            <CardDescription>How to get your Kotak Neo API credentials</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm">
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">1</div>
                <div>
                  <strong>Get API Token</strong>
                  <p className="text-muted-foreground">
                    Login to <a href="https://neo.kotaksecurities.com" target="_blank" rel="noopener" className="text-primary underline">neo.kotaksecurities.com</a> → Invest → Trade API → Create Application
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">2</div>
                <div>
                  <strong>Register TOTP</strong>
                  <p className="text-muted-foreground">
                    Visit <a href="https://www.kotaksecurities.com/platform/kotak-neo-trade-api/totp-registration/" target="_blank" rel="noopener" className="text-primary underline">TOTP Registration</a> and scan QR with Google/Microsoft Authenticator
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">3</div>
                <div>
                  <strong>Set MPIN</strong>
                  <p className="text-muted-foreground">
                    In Neo web → Click initials (top-right) → Account Details → MPIN section
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">4</div>
                <div>
                  <strong>Login Daily</strong>
                  <p className="text-muted-foreground">
                    Your credentials are saved permanently. Just enter your TOTP each day to start a trading session.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Alert className="mt-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Security Note:</strong> Your credentials are stored securely in the database and never shared. 
            TOTP codes expire every 30 seconds and must be entered fresh each login.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}

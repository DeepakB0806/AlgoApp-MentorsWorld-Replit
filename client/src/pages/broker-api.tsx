import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Home, Save, CheckCircle, XCircle, RefreshCw, AlertTriangle, LogIn, Key, Clock, Activity, Database, ChevronDown, ChevronRight, BookOpen, Send, Search, BarChart3, ShieldCheck, ArrowRightLeft, FileText, DollarSign, Briefcase, TrendingUp, Loader2, Timer, ExternalLink, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BrokerConfig, InsertBrokerConfig, BrokerTestLog, BrokerSessionLog } from "@shared/schema";

interface TestResult {
  success: boolean;
  message: string;
  error?: string;
}

function ApiFieldsReference() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const sections = [
    {
      key: "auth",
      title: "Authentication",
      icon: ShieldCheck,
      subsections: [
        {
          title: "TOTP Login (Step 1)",
          endpoint: "POST /login/1.0/tradeApiLogin",
          fields: [
            { field: "mobileNumber", type: "string", desc: "Registered mobile number" },
            { field: "ucc", type: "string", desc: "Unique Client Code" },
            { field: "totp", type: "string", desc: "6-digit TOTP from authenticator app" },
          ],
          returns: "token (viewToken), sid (sidView)",
        },
        {
          title: "MPIN Validate (Step 2)",
          endpoint: "POST /login/1.0/tradeApiValidate",
          fields: [
            { field: "mpin", type: "string", desc: "6-digit MPIN" },
          ],
          returns: "token (sessionToken), sid (sidSession), baseUrl",
        },
      ],
    },
    {
      key: "order_place",
      title: "Order Placement",
      icon: Send,
      subsections: [
        {
          title: "Place Order",
          endpoint: "POST {baseUrl}/quick/order/rule/ms/place",
          fields: [
            { field: "ts", type: "string", desc: "Trading Symbol (e.g., TCS-EQ)" },
            { field: "es", type: "string", desc: "Exchange (nse_cm, bse_cm, nse_fo)" },
            { field: "tt", type: "B | S", desc: "Transaction Type - Buy or Sell" },
            { field: "qt", type: "number", desc: "Order quantity" },
            { field: "pr", type: "number", desc: "Order price" },
            { field: "pt", type: "string", desc: "Order Type (L, MKT, SL, SL-M)" },
            { field: "pc", type: "string", desc: "Product (CNC, NRML, MIS, CO, BO)" },
            { field: "rt", type: "string", desc: "Validity (DAY, IOC, GTD)" },
            { field: "tp", type: "number", desc: "Trigger Price (for SL orders)" },
            { field: "dq", type: "number", desc: "Disclosed Quantity" },
            { field: "am", type: "YES | NO", desc: "After Market Order flag" },
            { field: "mp", type: "string", desc: "Market Protection (default: 0)" },
            { field: "pf", type: "string", desc: "Price Fill (default: N)" },
          ],
          returns: "nOrdNo (Order Number)",
        },
      ],
    },
    {
      key: "order_modify",
      title: "Order Modify",
      icon: ArrowRightLeft,
      subsections: [
        {
          title: "Modify Order",
          endpoint: "POST {baseUrl}/quick/order/vr/modify",
          fields: [
            { field: "no", type: "string", desc: "Order Number to modify" },
            { field: "ts", type: "string", desc: "Trading Symbol" },
            { field: "es", type: "string", desc: "Exchange" },
            { field: "tt", type: "B | S", desc: "Transaction Type" },
            { field: "qt", type: "number", desc: "Quantity" },
            { field: "pr", type: "number", desc: "Price" },
            { field: "pt", type: "string", desc: "Order Type" },
            { field: "pc", type: "string", desc: "Product Type" },
            { field: "vd", type: "string", desc: "Validity (uses vd instead of rt)" },
            { field: "tp", type: "number", desc: "Trigger Price" },
            { field: "dq", type: "number", desc: "Disclosed Quantity" },
            { field: "am", type: "YES | NO", desc: "After Market Order" },
          ],
          returns: "nOrdNo (Modified Order Number)",
        },
      ],
    },
    {
      key: "order_cancel",
      title: "Order Cancel & Exit",
      icon: XCircle,
      subsections: [
        {
          title: "Cancel Order",
          endpoint: "POST {baseUrl}/quick/order/cancel",
          fields: [
            { field: "on", type: "string", desc: "Order Number to cancel" },
            { field: "am", type: "YES | NO", desc: "After Market Order" },
          ],
        },
        {
          title: "Exit Cover Order",
          endpoint: "POST {baseUrl}/quick/order/co/exit",
          fields: [
            { field: "on", type: "string", desc: "Cover Order Number" },
          ],
        },
        {
          title: "Exit Bracket Order",
          endpoint: "POST {baseUrl}/quick/order/bo/exit",
          fields: [
            { field: "on", type: "string", desc: "Bracket Order Number" },
          ],
        },
      ],
    },
    {
      key: "data_get",
      title: "Data Endpoints (GET)",
      icon: BarChart3,
      subsections: [
        {
          title: "Order Book",
          endpoint: "GET {baseUrl}/quick/user/orders",
          fields: [
            { field: "order_id", type: "string", desc: "Order ID" },
            { field: "trading_symbol", type: "string", desc: "Trading Symbol" },
            { field: "transaction_type", type: "B | S", desc: "Buy or Sell" },
            { field: "quantity", type: "number", desc: "Order quantity" },
            { field: "price", type: "number", desc: "Order price" },
            { field: "status", type: "string", desc: "PENDING, COMPLETE, REJECTED, CANCELLED" },
            { field: "order_type", type: "string", desc: "Order type" },
            { field: "exchange", type: "string", desc: "Exchange" },
            { field: "timestamp", type: "string", desc: "Order timestamp" },
          ],
        },
        {
          title: "Trade Book",
          endpoint: "GET {baseUrl}/quick/user/trades",
          fields: [],
          returns: "Array of executed trades",
        },
      ],
    },
    {
      key: "positions",
      title: "Positions",
      icon: TrendingUp,
      subsections: [
        {
          title: "Get Positions",
          endpoint: "GET {baseUrl}/quick/user/positions",
          fields: [
            { field: "trading_symbol", type: "string", desc: "Trading Symbol" },
            { field: "exchange", type: "string", desc: "Exchange" },
            { field: "quantity", type: "number", desc: "Net quantity" },
            { field: "buy_avg", type: "number", desc: "Buy average price" },
            { field: "sell_avg", type: "number", desc: "Sell average price" },
            { field: "pnl", type: "number", desc: "Profit/Loss" },
            { field: "ltp", type: "number", desc: "Last Traded Price" },
            { field: "product_type", type: "string", desc: "NRML, MIS, CNC" },
            { field: "option_type", type: "string", desc: "CALL, PUT (optional)" },
            { field: "strike_price", type: "number", desc: "Strike price (optional)" },
            { field: "expiry", type: "string", desc: "Expiry date (optional)" },
            { field: "realised_pnl", type: "number", desc: "Realised P&L (optional)" },
            { field: "unrealised_pnl", type: "number", desc: "Unrealised P&L (optional)" },
          ],
        },
      ],
    },
    {
      key: "holdings",
      title: "Holdings",
      icon: Briefcase,
      subsections: [
        {
          title: "Get Holdings",
          endpoint: "GET {baseUrl}/portfolio/v1/holdings",
          fields: [
            { field: "trading_symbol", type: "string", desc: "Trading Symbol" },
            { field: "quantity", type: "number", desc: "Holding quantity" },
            { field: "average_price", type: "number", desc: "Average cost" },
            { field: "current_price", type: "number", desc: "LTP (Last Traded Price)" },
            { field: "invested_value", type: "number", desc: "qty x average_price" },
            { field: "current_value", type: "number", desc: "qty x current_price" },
            { field: "pnl", type: "number", desc: "Profit/Loss amount" },
            { field: "pnl_percent", type: "number", desc: "Profit/Loss %" },
            { field: "today_pnl", type: "number", desc: "Today's P&L amount" },
            { field: "today_pnl_percent", type: "number", desc: "Today's P&L %" },
            { field: "prev_close", type: "number", desc: "Previous close (optional)" },
          ],
        },
      ],
    },
    {
      key: "margin",
      title: "Check Margin",
      icon: DollarSign,
      subsections: [
        {
          title: "Check Margin",
          endpoint: "POST {baseUrl}/quick/user/check-margin",
          fields: [
            { field: "exSeg", type: "string", desc: "Exchange segment (e.g., nse_cm)" },
            { field: "prc", type: "number", desc: "Price" },
            { field: "prcTp", type: "string", desc: "Price Type (L or MKT)" },
            { field: "prod", type: "string", desc: "Product type" },
            { field: "qty", type: "number", desc: "Quantity" },
            { field: "tok", type: "string", desc: "Symbol/Token ID" },
            { field: "trnsTp", type: "B | S", desc: "Transaction Type" },
          ],
        },
      ],
    },
    {
      key: "limits",
      title: "Limits & Funds",
      icon: DollarSign,
      subsections: [
        {
          title: "Get Limits (Available Funds)",
          endpoint: "POST {baseUrl}/quick/user/limits",
          fields: [
            { field: "exch", type: "string", desc: "Exchange (default: ALL)" },
            { field: "seg", type: "string", desc: "Segment (default: ALL)" },
            { field: "prod", type: "string", desc: "Product (default: ALL)" },
          ],
        },
      ],
    },
    {
      key: "quotes",
      title: "Quotes & Scrip Master",
      icon: Search,
      subsections: [
        {
          title: "Get Quotes",
          endpoint: "GET {baseUrl}/script-details/1.0/quotes/neosymbol/{exchange}|{token}/all",
          fields: [
            { field: "exchange", type: "string", desc: "Exchange code (URL param)" },
            { field: "token", type: "string", desc: "Symbol/Token ID (URL param)" },
          ],
        },
        {
          title: "Get Scrip Master File Paths",
          endpoint: "GET /script-details/1.0/masterscrip/file-paths",
          fields: [],
          returns: "Scrip master file download URLs",
        },
      ],
    },
    {
      key: "order_history",
      title: "Order History",
      icon: FileText,
      subsections: [
        {
          title: "Get Order History",
          endpoint: "POST {baseUrl}/quick/order/history",
          fields: [
            { field: "nOrdNo", type: "string", desc: "Order Number to look up" },
          ],
          returns: "Array of order state changes",
        },
      ],
    },
  ];

  return (
    <Card data-testid="card-api-fields-reference">
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
        data-testid="button-toggle-api-reference"
      >
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-lg">
            <BookOpen className="w-5 h-5" />
            API Fields Reference
          </span>
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          )}
        </CardTitle>
        <CardDescription>
          Complete list of all Kotak Neo API fields supported by this platform
        </CardDescription>
      </CardHeader>
      {isExpanded && (
        <CardContent className="space-y-2" data-testid="content-api-reference">
          {sections.map((section) => (
            <div key={section.key} className="border border-border rounded-md overflow-hidden">
              <button
                onClick={() => toggleSection(section.key)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover-elevate transition-colors"
                data-testid={`button-section-${section.key}`}
              >
                <span className="flex items-center gap-2">
                  <section.icon className="w-4 h-4 text-primary" />
                  {section.title}
                  <Badge variant="secondary" className="text-xs ml-1">
                    {section.subsections.reduce((acc, s) => acc + s.fields.length, 0)} fields
                  </Badge>
                </span>
                {expandedSections[section.key] ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
              {expandedSections[section.key] && (
                <div className="px-4 pb-4 space-y-4">
                  {section.subsections.map((sub, idx) => (
                    <div key={idx} className="space-y-2">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-sm">{sub.title}</span>
                        <code className="text-xs text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded-md w-fit">
                          {sub.endpoint}
                        </code>
                      </div>
                      {sub.fields.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-border">
                                <th className="text-left py-1.5 px-2 text-muted-foreground font-medium text-xs w-[120px]">Field</th>
                                <th className="text-left py-1.5 px-2 text-muted-foreground font-medium text-xs w-[100px]">Type</th>
                                <th className="text-left py-1.5 px-2 text-muted-foreground font-medium text-xs">Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sub.fields.map((f, fIdx) => (
                                <tr key={fIdx} className="border-b border-border/50 last:border-0">
                                  <td className="py-1.5 px-2 font-mono text-xs text-primary">{f.field}</td>
                                  <td className="py-1.5 px-2">
                                    <Badge variant="outline" className="text-xs font-mono">{f.type}</Badge>
                                  </td>
                                  <td className="py-1.5 px-2 text-xs text-muted-foreground">{f.desc}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {sub.returns && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Returns:</span>
                          <code className="font-mono bg-muted/50 px-2 py-0.5 rounded text-primary">{sub.returns}</code>
                        </div>
                      )}
                      {idx < section.subsections.length - 1 && (
                        <div className="border-t border-border/30 mt-2" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

export default function BrokerApi() {
  const { toast } = useToast();
  const [totp, setTotp] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTestLogSheetOpen, setIsTestLogSheetOpen] = useState(false);
  const [isSessionLogSheetOpen, setIsSessionLogSheetOpen] = useState(false);
  const [sessionExpandedView, setSessionExpandedView] = useState(false);
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

  const kotakConfig = brokerConfigs.find(c => c.brokerName === "kotak_neo");

  const { data: testLogs = [], isLoading: isLoadingTestLogs } = useQuery<BrokerTestLog[]>({
    queryKey: [`/api/broker-configs/${kotakConfig?.id}/test-logs`],
    enabled: !!kotakConfig,
  });

  const { data: sessionLogs = [], isLoading: isLoadingSessionLogs } = useQuery<BrokerSessionLog[]>({
    queryKey: [`/api/broker-configs/${kotakConfig?.id}/session-logs`],
    enabled: !!kotakConfig,
  });

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
      if (kotakConfig) {
        queryClient.invalidateQueries({ queryKey: [`/api/broker-configs/${kotakConfig.id}/test-logs`] });
      }
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

  const clearSessionLogsMutation = useMutation({
    mutationFn: async (brokerConfigId: string) => {
      return apiRequest("DELETE", `/api/broker-configs/${brokerConfigId}/session-logs`);
    },
    onSuccess: () => {
      if (kotakConfig) {
        queryClient.invalidateQueries({ queryKey: [`/api/broker-configs/${kotakConfig.id}/session-logs`] });
      }
      toast({ title: "All session data cleared" });
    },
    onError: () => {
      toast({ title: "Failed to clear session data", variant: "destructive" });
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
      if (kotakConfig) {
        queryClient.invalidateQueries({ queryKey: [`/api/broker-configs/${kotakConfig.id}/session-logs`] });
      }
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

  const handleSaveAndLogin = async () => {
    if (totp.length !== 6) {
      toast({ title: "Please enter 6-digit TOTP", variant: "destructive" });
      return;
    }

    if (kotakConfig) {
      try {
        await apiRequest("PATCH", `/api/broker-configs/${kotakConfig.id}`, formData);
        queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
        authenticateMutation.mutate({ id: kotakConfig.id, totp });
      } catch {
        toast({ title: "Failed to save credentials", variant: "destructive" });
      }
    } else {
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

      <div className="container mx-auto px-4 py-6 max-w-3xl">
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
          <>
            <Card>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start gap-4 flex-wrap">
                  <div>
                    <CardTitle className="flex items-center gap-2 flex-wrap">
                      <Key className="w-5 h-5" />
                      Kotak Neo Credentials
                      {kotakConfig && (
                        <Badge variant={kotakConfig.isConnected ? "default" : "secondary"}>
                          {kotakConfig.isConnected ? "Active" : "Saved"}
                        </Badge>
                      )}
                      {kotakConfig?.accessToken && (() => {
                        try {
                          const parts = kotakConfig.accessToken!.split('.');
                          if (parts.length === 3) {
                            const payload = JSON.parse(atob(parts[1]));
                            if (payload.exp) {
                              const expiryDate = new Date(payload.exp * 1000);
                              const now = new Date();
                              const isExpired = expiryDate <= now;
                              const diffMs = expiryDate.getTime() - now.getTime();
                              const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
                              const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                              return (
                                <Badge
                                  variant={isExpired ? "destructive" : "default"}
                                  className="text-xs font-bold"
                                  data-testid="badge-session-expiry-header"
                                >
                                  <Clock className="w-3 h-3 mr-1" />
                                  {isExpired
                                    ? "SESSION EXPIRED"
                                    : `Expires in ${diffHrs}h ${diffMins}m`}
                                </Badge>
                              );
                            }
                          }
                        } catch { /* JWT parsing failed */ }
                        return null;
                      })()}
                    </CardTitle>
                    <CardDescription>
                      {kotakConfig ? (
                        kotakConfig.isConnected ? (
                          <span className="flex flex-col gap-0.5 mt-1">
                            <span className="flex items-center gap-1 text-primary">
                              <CheckCircle className="w-4 h-4" />
                              Connected - Session Active
                            </span>
                            {kotakConfig.accessToken && (() => {
                              try {
                                const parts = kotakConfig.accessToken!.split('.');
                                if (parts.length === 3) {
                                  const payload = JSON.parse(atob(parts[1]));
                                  if (payload.exp) {
                                    const expiryDate = new Date(payload.exp * 1000);
                                    return (
                                      <span className="text-xs font-mono text-muted-foreground">
                                        Expires: {expiryDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" })} IST
                                      </span>
                                    );
                                  }
                                }
                              } catch { /* JWT parsing failed */ }
                              return null;
                            })()}
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
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsTestLogSheetOpen(true)}
                        data-testid="button-view-test-logs"
                      >
                        <RefreshCw className="w-4 h-4 mr-1" />
                        Tests ({testLogs.length})
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsSessionLogSheetOpen(true)}
                        data-testid="button-view-session-logs"
                      >
                        <LogIn className="w-4 h-4 mr-1" />
                        Sessions ({sessionLogs.length})
                      </Button>
                    </div>
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


            <div className="mt-6">
              <ApiFieldsReference />
            </div>
          </>
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

      <Sheet open={isTestLogSheetOpen} onOpenChange={setIsTestLogSheetOpen}>
        <SheetContent className="w-full max-w-[600px] h-full max-h-screen overflow-hidden flex flex-col">
          <SheetHeader>
            <SheetTitle>Test Connection Log</SheetTitle>
            <SheetDescription>
              History of all API connectivity test results
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4 flex-1 overflow-hidden flex flex-col">
            {kotakConfig && (
              <div className="flex gap-2">
                <Button
                  onClick={() => testConnectionMutation.mutate(kotakConfig.id)}
                  disabled={testConnectionMutation.isPending}
                  data-testid="button-test-connection-sheet"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${testConnectionMutation.isPending ? "animate-spin" : ""}`} />
                  {testConnectionMutation.isPending ? "Testing..." : "Test Connection"}
                </Button>
              </div>
            )}
            {kotakConfig && (
              <div className="flex-shrink-0 border border-border rounded-md p-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground block">Total Tests</span>
                    <span className="font-mono font-medium" data-testid="text-total-tests">{kotakConfig.totalTests || 0}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Successful</span>
                    <span className="font-mono font-medium text-primary" data-testid="text-successful-tests">{kotakConfig.successfulTests || 0}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Last Test</span>
                    <span className="font-mono font-medium" data-testid="text-last-test-time">{kotakConfig.lastTestTime || "Never"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Last Result</span>
                    <Badge variant={kotakConfig.lastTestResult === "success" ? "default" : "secondary"} className="text-xs" data-testid="badge-last-test-result">
                      {kotakConfig.lastTestResult || "N/A"}
                    </Badge>
                  </div>
                </div>
              </div>
            )}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              <div className="flex items-center justify-between flex-shrink-0 gap-2 flex-wrap">
                <h4 className="font-medium">Test Results</h4>
                <Badge variant="secondary" className="text-xs">{testLogs.length} entries</Badge>
              </div>
              {isLoadingTestLogs ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading test logs...</span>
                </div>
              ) : testLogs.length === 0 ? (
                <p className="text-muted-foreground text-sm mt-2">No test logs yet. Click "Test Connection" to run your first test.</p>
              ) : (
                <div
                  className="overflow-auto max-h-[calc(100vh-280px)] mt-2"
                  data-testid="test-logs-scroll-container"
                >
                  <div className="space-y-2 pr-2">
                    {testLogs.map((log) => (
                      <Card key={log.id} className="p-3" data-testid={`card-test-log-${log.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2 flex-nowrap">
                              {log.status === "success" ? (
                                <CheckCircle className="w-4 h-4 text-primary flex-shrink-0" />
                              ) : (
                                <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                              )}
                              <span className="font-medium text-sm">{log.status === "success" ? "Success" : "Failed"}</span>
                              {log.responseTime && (
                                <Badge variant="outline" className="text-xs flex-shrink-0">
                                  <Timer className="w-3 h-3 mr-1" />
                                  {log.responseTime}ms
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-nowrap">
                              <span className="flex-shrink-0">{log.testedAt}</span>
                            </div>
                            {log.message && (
                              <p className="text-xs mt-1 text-muted-foreground">{log.message}</p>
                            )}
                            {log.errorMessage && (
                              <p className="text-xs text-destructive mt-1">{log.errorMessage}</p>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={isSessionLogSheetOpen} onOpenChange={setIsSessionLogSheetOpen}>
        <SheetContent className={`${sessionExpandedView ? "w-full sm:max-w-full" : "w-full max-w-[800px]"} h-full max-h-screen overflow-hidden flex flex-col`} side="right">
          <SheetHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <SheetTitle>Session Data: Kotak Neo</SheetTitle>
                <SheetDescription>
                  {sessionLogs.length} session records from login history
                </SheetDescription>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setSessionExpandedView(!sessionExpandedView)}
                  data-testid="button-expand-session-data"
                  title={sessionExpandedView ? "Collapse" : "Expand"}
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </SheetHeader>
          <div className="mt-6 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between flex-shrink-0 gap-2 flex-wrap mb-3">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-sm">Session Logs</h4>
                <Badge variant="secondary" className="text-xs">{sessionLogs.length} entries</Badge>
              </div>
              {kotakConfig && sessionLogs.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="button-clear-session-data"
                      disabled={clearSessionLogsMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Clear
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => clearSessionLogsMutation.mutate(kotakConfig.id)}
                      data-testid="clear-session-data-all"
                      className="text-destructive"
                    >
                      Clear all session data
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {isLoadingSessionLogs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading session data...</span>
              </div>
            ) : sessionLogs.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No session data yet. Use "Save & Login with TOTP" to start your first session.</p>
            ) : (
              <div
                className="overflow-auto flex-1 min-h-0"
                data-testid="session-logs-scroll-container"
              >
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 z-20 bg-card">
                    <tr className="border-b">
                      <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">#</th>
                      <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Login Status</th>
                      <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Last TOTP Time</th>
                      <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">TOTP Used</th>
                      <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Session Status</th>
                      <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Session Expiry</th>
                      <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Active Session ID</th>
                      <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Server URL</th>
                      <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Message</th>
                      <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionLogs.map((log, index) => {
                      const isExpired = log.sessionExpiry ? new Date(log.sessionExpiry) <= new Date() : true;
                      return (
                        <tr
                          key={log.id}
                          data-testid={`row-session-log-${log.id}`}
                          className="border-b hover:bg-muted/50"
                        >
                          <td className="whitespace-nowrap px-2 py-2 font-mono text-muted-foreground">{sessionLogs.length - index}</td>
                          <td className="whitespace-nowrap px-2 py-2">
                            <div className="flex items-center gap-1">
                              {log.status === "success" ? (
                                <CheckCircle className="w-3 h-3 text-primary flex-shrink-0" />
                              ) : (
                                <XCircle className="w-3 h-3 text-destructive flex-shrink-0" />
                              )}
                              <span className={log.status === "success" ? "text-primary font-medium" : "text-destructive font-medium"}>
                                {log.status === "success" ? "Success" : "Failed"}
                              </span>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono">{log.loginAt}</td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono">{log.totpUsed || "—"}</td>
                          <td className="whitespace-nowrap px-2 py-2">
                            {log.sessionExpiry ? (
                              <Badge
                                variant={isExpired ? "destructive" : "default"}
                                className="text-xs font-bold"
                                data-testid={`badge-session-expiry-${log.id}`}
                              >
                                {isExpired ? "EXPIRED" : "ACTIVE"}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono">{log.sessionExpiry || "—"}</td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono" title={log.sessionId || ""}>{log.sessionId ? `${log.sessionId.slice(0, 12)}...` : "—"}</td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono">{log.baseUrl || "—"}</td>
                          <td className="px-2 py-2 max-w-[200px] truncate" title={log.message || ""}>{log.message || "—"}</td>
                          <td className="px-2 py-2 max-w-[200px] truncate text-destructive" title={log.errorMessage || ""}>{log.errorMessage || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

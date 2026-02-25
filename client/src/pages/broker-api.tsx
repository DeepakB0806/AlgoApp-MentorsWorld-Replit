import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Home, Save, CheckCircle, XCircle, RefreshCw, AlertTriangle, LogIn, Key, Clock, Activity, Database, ChevronDown, ChevronRight, BookOpen, Send, Search, BarChart3, ShieldCheck, ArrowRightLeft, FileText, DollarSign, Briefcase, TrendingUp, Loader2, Timer, ExternalLink, Trash2, Info, ArrowDown, Plus, Pencil, Check, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import type { BrokerConfig, InsertBrokerConfig, BrokerTestLog, BrokerSessionLog, BrokerFieldMapping } from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TestResult {
  success: boolean;
  message: string;
  error?: string;
}

type EngineStep = { label: string; status: "waiting" | "running" | "done" | "error"; detail?: string };

function ApiFieldsReference() {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [engineSteps, setEngineSteps] = useState<EngineStep[] | null>(null);
  const [editingField, setEditingField] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<{ universalFieldName: string; matchStatus: string }>({ universalFieldName: "", matchStatus: "" });

  const brokerName = "kotak_neo_v3";

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const statsQuery = useQuery<{ matched: number; pending: number; gap: number; not_applicable: number; total: number }>({
    queryKey: ["/api/broker-field-mappings", brokerName, "stats"],
    queryFn: async () => {
      const res = await fetch(`/api/broker-field-mappings/${brokerName}/stats`);
      return res.json();
    },
  });

  const mappingsQuery = useQuery<BrokerFieldMapping[]>({
    queryKey: ["/api/broker-field-mappings", brokerName],
    queryFn: async () => {
      const res = await fetch(`/api/broker-field-mappings/${brokerName}`);
      return res.json();
    },
    enabled: (statsQuery.data?.total ?? 0) > 0,
  });

  const dbMappings = mappingsQuery.data || [];
  const hasMappings = (statsQuery.data?.total ?? 0) > 0;

  const getMappingForField = (fieldCode: string, category: string, endpoint: string): BrokerFieldMapping | undefined => {
    const cleanEndpoint = endpoint.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/, "");
    return dbMappings.find(m => m.fieldCode === fieldCode && m.category === category && m.endpoint === cleanEndpoint);
  };

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { universalFieldName?: string; matchStatus?: string } }) => {
      return apiRequest("PATCH", `/api/broker-field-mappings/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker-field-mappings", brokerName] });
      queryClient.invalidateQueries({ queryKey: ["/api/broker-field-mappings", brokerName, "stats"] });
      setEditingField(null);
      toast({ title: "Mapping updated" });
    },
  });

  const runEngine = async () => {
    const steps: EngineStep[] = [
      { label: "Building database table", status: "waiting" },
      { label: "Seeding broker fields", status: "waiting" },
      { label: "Auto-mapping Universal Layer", status: "waiting" },
      { label: "Verifying completeness", status: "waiting" },
    ];
    setEngineSteps([...steps]);

    try {
      steps[0].status = "running";
      setEngineSteps([...steps]);
      await new Promise(r => setTimeout(r, 400));
      steps[0].status = "done";
      steps[0].detail = "Table ready";

      steps[1].status = "running";
      setEngineSteps([...steps]);
      await new Promise(r => setTimeout(r, 300));

      const totalFields = sections.reduce((acc, s) => acc + s.subsections.reduce((a2, sub) => a2 + sub.fields.length, 0), 0);
      steps[1].status = "done";
      steps[1].detail = `${totalFields} fields found`;

      steps[2].status = "running";
      setEngineSteps([...steps]);

      const response = await apiRequest("POST", "/api/broker-field-mappings/build", {
        brokerName,
        sections,
      });
      const result = await response.json();

      steps[2].status = "done";
      steps[2].detail = `${result.stats.matched} matched`;

      steps[3].status = "running";
      setEngineSteps([...steps]);
      await new Promise(r => setTimeout(r, 300));
      steps[3].status = "done";
      steps[3].detail = `${result.stats.total} total • ${result.stats.gap} gaps`;
      setEngineSteps([...steps]);

      queryClient.invalidateQueries({ queryKey: ["/api/broker-field-mappings", brokerName] });
      queryClient.invalidateQueries({ queryKey: ["/api/broker-field-mappings", brokerName, "stats"] });

      toast({
        title: "Mapping engine complete",
        description: `${result.stats.matched}/${result.stats.total} fields mapped to Universal Layer`,
      });
    } catch (err) {
      const failedIdx = steps.findIndex(s => s.status === "running");
      if (failedIdx >= 0) {
        steps[failedIdx].status = "error";
        steps[failedIdx].detail = "Failed";
      }
      setEngineSteps([...steps]);
      toast({ title: "Engine failed", description: String(err), variant: "destructive" });
    }
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

  const totalFields = sections.reduce((acc, s) => acc + s.subsections.reduce((a2, sub) => a2 + sub.fields.length, 0), 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "matched": return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]" data-testid="badge-status-matched">Matched</Badge>;
      case "pending": return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]" data-testid="badge-status-pending">Pending</Badge>;
      case "gap": return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]" data-testid="badge-status-gap">Gap</Badge>;
      case "not_applicable": return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30 text-[10px]" data-testid="badge-status-na">N/A</Badge>;
      default: return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
    }
  };

  const getStepIcon = (status: EngineStep["status"]) => {
    switch (status) {
      case "waiting": return <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />;
      case "running": return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
      case "done": return <CheckCircle className="w-4 h-4 text-emerald-400" />;
      case "error": return <XCircle className="w-4 h-4 text-red-400" />;
    }
  };

  const getCategoryMatchCount = (categoryKey: string): number => {
    return dbMappings.filter(m => m.category === categoryKey && m.matchStatus === "matched").length;
  };

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
          <div className="flex items-center gap-2">
            {hasMappings && statsQuery.data && (
              <Badge variant="outline" className="text-xs">
                {statsQuery.data.matched}/{statsQuery.data.total} mapped
              </Badge>
            )}
            {isExpanded ? (
              <ChevronDown className="w-5 h-5 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
        </CardTitle>
        <CardDescription>
          Kotak Neo V3 API fields with Universal Layer mapping
        </CardDescription>
      </CardHeader>
      {isExpanded && (
        <CardContent className="space-y-3" data-testid="content-api-reference">
          {hasMappings && statsQuery.data ? (
            <div className="flex items-center gap-3 p-3 rounded-md bg-muted/30 border border-border" data-testid="mapping-summary-bar">
              <Database className="w-4 h-4 text-primary" />
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Matched: <strong>{statsQuery.data.matched}</strong>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  Pending: <strong>{statsQuery.data.pending}</strong>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  Gaps: <strong>{statsQuery.data.gap}</strong>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  N/A: <strong>{statsQuery.data.not_applicable}</strong>
                </span>
                <span className="text-muted-foreground">Total: {statsQuery.data.total}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto text-xs h-7"
                onClick={(e) => { e.stopPropagation(); runEngine(); }}
                data-testid="button-resync-mapping"
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Re-sync
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 p-6 rounded-md bg-muted/20 border border-dashed border-border" data-testid="mapping-cta">
              <Database className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">
                {totalFields} API fields identified across {sections.length} categories.
                <br />Map them to the Universal Layer to enable the Translation Layer.
              </p>
              <Button
                onClick={(e) => { e.stopPropagation(); runEngine(); }}
                className="bg-emerald-600 hover:bg-emerald-700"
                data-testid="button-map-universal-layer"
              >
                <Database className="w-4 h-4 mr-2" />
                Map to Universal Layer
              </Button>
            </div>
          )}

          {engineSteps && (
            <div className="p-3 rounded-md bg-slate-900/50 border border-border space-y-2" data-testid="engine-progress">
              <span className="text-xs font-medium text-muted-foreground">Mapping Engine</span>
              {engineSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {getStepIcon(step.status)}
                  <span className={step.status === "done" ? "text-foreground" : step.status === "error" ? "text-red-400" : "text-muted-foreground"}>
                    {step.label}
                  </span>
                  {step.detail && (
                    <span className="text-xs text-muted-foreground ml-auto">{step.detail}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {sections.map((section) => {
            const sectionFieldCount = section.subsections.reduce((acc, s) => acc + s.fields.length, 0);
            const matchCount = hasMappings ? getCategoryMatchCount(section.key) : 0;

            return (
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
                      {sectionFieldCount} fields
                    </Badge>
                    {hasMappings && sectionFieldCount > 0 && (
                      <Badge className={`text-[10px] ${matchCount === sectionFieldCount ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30"}`}>
                        {matchCount}/{sectionFieldCount} mapped
                      </Badge>
                    )}
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
                                  <th className="text-left py-1.5 px-2 text-muted-foreground font-medium text-xs w-[100px]">Field</th>
                                  <th className="text-left py-1.5 px-2 text-muted-foreground font-medium text-xs w-[80px]">Type</th>
                                  <th className="text-left py-1.5 px-2 text-muted-foreground font-medium text-xs">Description</th>
                                  {hasMappings && (
                                    <>
                                      <th className="text-left py-1.5 px-2 text-muted-foreground font-medium text-xs w-[140px]">Universal Field</th>
                                      <th className="text-left py-1.5 px-2 text-muted-foreground font-medium text-xs w-[80px]">Status</th>
                                    </>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {sub.fields.map((f, fIdx) => {
                                  const mapping = hasMappings ? getMappingForField(f.field, section.key, sub.endpoint) : undefined;
                                  const isEditing = mapping && editingField === mapping.id;

                                  return (
                                    <tr key={fIdx} className="border-b border-border/50 last:border-0 group">
                                      <td className="py-1.5 px-2 font-mono text-xs text-primary">{f.field}</td>
                                      <td className="py-1.5 px-2">
                                        <Badge variant="outline" className="text-xs font-mono">{f.type}</Badge>
                                      </td>
                                      <td className="py-1.5 px-2 text-xs text-muted-foreground">{f.desc}</td>
                                      {hasMappings && mapping && (
                                        <>
                                          <td className="py-1.5 px-2">
                                            {isEditing ? (
                                              <Input
                                                value={editValues.universalFieldName}
                                                onChange={(e) => setEditValues(v => ({ ...v, universalFieldName: e.target.value }))}
                                                className="h-6 text-xs font-mono px-1"
                                                data-testid={`input-universal-field-${mapping.id}`}
                                              />
                                            ) : (
                                              <span className="font-mono text-xs text-foreground">
                                                {mapping.universalFieldName || <span className="text-muted-foreground italic">unmapped</span>}
                                              </span>
                                            )}
                                          </td>
                                          <td className="py-1.5 px-2">
                                            <div className="flex items-center gap-1">
                                              {isEditing ? (
                                                <Select value={editValues.matchStatus} onValueChange={(v) => setEditValues(ev => ({ ...ev, matchStatus: v }))}>
                                                  <SelectTrigger className="h-6 text-[10px] w-[90px]" data-testid={`select-status-${mapping.id}`}>
                                                    <SelectValue />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    <SelectItem value="matched">Matched</SelectItem>
                                                    <SelectItem value="pending">Pending</SelectItem>
                                                    <SelectItem value="gap">Gap</SelectItem>
                                                    <SelectItem value="not_applicable">N/A</SelectItem>
                                                  </SelectContent>
                                                </Select>
                                              ) : (
                                                getStatusBadge(mapping.matchStatus)
                                              )}
                                              {isEditing ? (
                                                <div className="flex gap-0.5">
                                                  <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-5 w-5 p-0"
                                                    onClick={() => updateMutation.mutate({ id: mapping.id, data: { universalFieldName: editValues.universalFieldName, matchStatus: editValues.matchStatus } })}
                                                    data-testid={`button-save-${mapping.id}`}
                                                  >
                                                    <Check className="w-3 h-3 text-emerald-400" />
                                                  </Button>
                                                  <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-5 w-5 p-0"
                                                    onClick={() => setEditingField(null)}
                                                    data-testid={`button-cancel-${mapping.id}`}
                                                  >
                                                    <X className="w-3 h-3 text-muted-foreground" />
                                                  </Button>
                                                </div>
                                              ) : (
                                                <Button
                                                  size="sm"
                                                  variant="ghost"
                                                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                                  onClick={() => {
                                                    setEditingField(mapping.id);
                                                    setEditValues({ universalFieldName: mapping.universalFieldName || "", matchStatus: mapping.matchStatus });
                                                  }}
                                                  data-testid={`button-edit-${mapping.id}`}
                                                >
                                                  <Pencil className="w-3 h-3 text-muted-foreground" />
                                                </Button>
                                              )}
                                            </div>
                                          </td>
                                        </>
                                      )}
                                      {hasMappings && !mapping && (
                                        <>
                                          <td className="py-1.5 px-2 text-xs text-muted-foreground italic">—</td>
                                          <td className="py-1.5 px-2">—</td>
                                        </>
                                      )}
                                    </tr>
                                  );
                                })}
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
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}

function BrokerConfigCard({ config, onDeleted }: { config: BrokerConfig | null; onDeleted?: () => void }) {
  const { toast } = useToast();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [totp, setTotp] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTestLogSheetOpen, setIsTestLogSheetOpen] = useState(false);
  const [testExpandedView, setTestExpandedView] = useState(false);
  const [isSessionLogSheetOpen, setIsSessionLogSheetOpen] = useState(false);
  const [sessionExpandedView, setSessionExpandedView] = useState(false);
  const [showCredentials, setShowCredentials] = useState(!config);
  const [isEditingName, setIsEditingName] = useState(false);
  const brokerName = config?.brokerName || "kotak_neo";
  const isBinance = brokerName === "binance";
  const isPaperTrade = brokerName === "paper_trade";
  const defaultName = isPaperTrade ? "Paper Trade" : isBinance ? "Binance Credentials" : "Kotak Neo Credentials";
  const [editName, setEditName] = useState(config?.name || defaultName);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [formData, setFormData] = useState<Partial<InsertBrokerConfig>>({
    name: config?.name || defaultName,
    brokerName: brokerName,
    consumerKey: config?.consumerKey || "",
    consumerSecret: config?.consumerSecret || "",
    mobileNumber: config?.mobileNumber || "",
    ucc: config?.ucc || "",
    mpin: config?.mpin || "",
    environment: config?.environment || (isBinance ? "uat" : "prod"),
  });

  const { data: testLogs = [], isLoading: isLoadingTestLogs } = useQuery<BrokerTestLog[]>({
    queryKey: ["/api/broker-configs", config?.id, "test-logs"],
    queryFn: async () => {
      if (!config) return [];
      const res = await fetch(`/api/broker-configs/${config.id}/test-logs`);
      if (!res.ok) throw new Error("Failed to fetch test logs");
      return res.json();
    },
    enabled: !!config,
  });

  const { data: sessionLogs = [], isLoading: isLoadingSessionLogs } = useQuery<BrokerSessionLog[]>({
    queryKey: ["/api/broker-configs", config?.id, "session-logs"],
    queryFn: async () => {
      if (!config) return [];
      const res = await fetch(`/api/broker-configs/${config.id}/session-logs`);
      if (!res.ok) throw new Error("Failed to fetch session logs");
      return res.json();
    },
    enabled: !!config,
  });

  useEffect(() => {
    if (config) {
      setFormData({
        name: config.name || defaultName,
        brokerName: config.brokerName || "kotak_neo",
        consumerKey: config.consumerKey || "",
        consumerSecret: config.consumerSecret || "",
        mobileNumber: config.mobileNumber || "",
        ucc: config.ucc || "",
        mpin: config.mpin || "",
        environment: config.environment || (isBinance ? "uat" : "prod"),
      });
      setEditName(config.name || defaultName);
      setShowCredentials(false);
    }
  }, [config]);

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/broker-configs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
      toast({ title: "Broker configuration deleted" });
      onDeleted?.();
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
      if (config) {
        queryClient.invalidateQueries({ queryKey: ["/api/broker-configs", config.id, "test-logs"] });
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

  const clearTestLogsMutation = useMutation({
    mutationFn: async (days: number | "all") => {
      if (!config) return;
      if (days === "all") {
        return apiRequest("DELETE", `/api/broker-configs/${config.id}/test-logs`);
      }
      return apiRequest("DELETE", `/api/broker-configs/${config.id}/test-logs?days=${days}`);
    },
    onSuccess: (_data, days) => {
      if (config) {
        queryClient.invalidateQueries({ queryKey: ["/api/broker-configs", config.id, "test-logs"] });
      }
      toast({ title: days === "all" ? "All test data cleared" : `Test data older than ${days} days cleared` });
    },
    onError: () => {
      toast({ title: "Failed to clear test data", variant: "destructive" });
    },
  });

  const clearSessionLogsMutation = useMutation({
    mutationFn: async (days: number | "all") => {
      if (!config) return;
      if (days === "all") {
        return apiRequest("DELETE", `/api/broker-configs/${config.id}/session-logs`);
      }
      return apiRequest("DELETE", `/api/broker-configs/${config.id}/session-logs?days=${days}`);
    },
    onSuccess: (_data, days) => {
      if (config) {
        queryClient.invalidateQueries({ queryKey: ["/api/broker-configs", config.id, "session-logs"] });
      }
      toast({ title: days === "all" ? "All session data cleared" : `Session data older than ${days} days cleared` });
    },
    onError: () => {
      toast({ title: "Failed to clear session data", variant: "destructive" });
    },
  });

  const authenticateMutation = useMutation({
    mutationFn: async ({ id, totp: t }: { id: string; totp: string }) => {
      const response = await apiRequest("POST", `/api/broker-configs/${id}/authenticate`, { totp: t });
      return response.json();
    },
    onSuccess: (data: TestResult) => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/broker-session-status"] });
      if (config) {
        queryClient.invalidateQueries({ queryKey: ["/api/broker-configs", config.id, "session-logs"] });
      }
      setTotp("");
      if (data.success) {
        toast({ title: isBinance ? "Authentication successful! API key validated." : "Login successful! Trading session is now active." });
      } else {
        toast({ title: isBinance ? "Authentication failed" : "Login failed", description: data.error, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
    },
  });

  const handleSaveCredentials = () => {
    if (config) {
      updateMutation.mutate({ id: config.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleSaveAndLogin = async () => {
    if (!isBinance && totp.length !== 6) {
      toast({ title: "Please enter 6-digit TOTP", variant: "destructive" });
      return;
    }

    if (config) {
      try {
        await apiRequest("PATCH", `/api/broker-configs/${config.id}`, formData);
        queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
        authenticateMutation.mutate({ id: config.id, totp: isBinance ? "" : totp });
      } catch {
        toast({ title: "Failed to save credentials", variant: "destructive" });
      }
    } else {
      try {
        const response = await apiRequest("POST", "/api/broker-configs", formData);
        const newConfig = await response.json();
        queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
        authenticateMutation.mutate({ id: newConfig.id, totp: isBinance ? "" : totp });
      } catch {
        toast({ title: "Failed to save credentials", variant: "destructive" });
      }
    }
  };

  const handleSaveName = () => {
    if (!config || !editName.trim()) return;
    updateMutation.mutate({ id: config.id, data: { name: editName.trim() } });
    setIsEditingName(false);
  };

  const handleCancelEditName = () => {
    setEditName(config?.name || defaultName);
    setIsEditingName(false);
  };

  const isFormValid = isBinance 
    ? !!(formData.consumerKey && formData.consumerSecret)
    : !!(formData.consumerKey && formData.mobileNumber && formData.ucc && formData.mpin);
  const canLogin = isBinance ? isFormValid : (isFormValid && totp.length === 6);
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const displayName = config?.name || formData.name || defaultName;

  return (
    <>
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

      <Card data-testid={`card-broker-config-${config?.id || "new"}`}>
        <CardHeader className="pb-2">
          <div className="flex justify-between items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <CardTitle className="flex items-center gap-2 flex-wrap">
                <Key className="w-5 h-5 flex-shrink-0" />
                {isEditingName ? (
                  <div className="flex items-center gap-1">
                    <Input
                      ref={nameInputRef}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveName();
                        if (e.key === "Escape") handleCancelEditName();
                      }}
                      className="h-7 text-base font-semibold w-64"
                      data-testid="input-broker-name"
                    />
                    <Button size="icon" variant="ghost" onClick={handleSaveName} data-testid="button-save-name">
                      <Check className="w-4 h-4 text-primary" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={handleCancelEditName} data-testid="button-cancel-name">
                      <X className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <span data-testid="text-broker-config-name">{displayName}</span>
                    {config && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setIsEditingName(true)}
                        data-testid="button-edit-name"
                      >
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </>
                )}
                {config && (
                  <>
                    <Badge variant="outline" className="text-xs">
                      {config.brokerName === "paper_trade" ? "Paper Trade" : config.brokerName === "binance" ? "Binance" : "Kotak Neo"}
                    </Badge>
                    <Badge variant={config.isConnected ? "default" : "secondary"}>
                      {config.isConnected ? "Active" : "Saved"}
                    </Badge>
                    {config?.accessToken && config.brokerName !== "binance" && (() => {
                      try {
                        const parts = config.accessToken!.split('.');
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
                  </>
                )}
              </CardTitle>
              <CardDescription>
                {config ? (
                  config.isConnected ? (
                    <span className="flex flex-col gap-0.5 mt-1">
                      <span className="flex items-center gap-1 text-primary">
                        <CheckCircle className="w-4 h-4" />
                        {isPaperTrade ? "Always Connected — Simulated Trading Engine" : isBinance ? "Authenticated - API Key Validated" : "Connected - Session Active"}
                      </span>
                      {!isBinance && config.accessToken && (() => {
                        try {
                          const parts = config.accessToken!.split('.');
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
                      {isBinance ? "Credentials saved - Click Authenticate to validate" : "Credentials saved - Enter TOTP to login"}
                    </span>
                  )
                ) : (
                  "Enter your credentials to connect"
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {config && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsTestLogSheetOpen(true)}
                    data-testid={`button-view-test-logs-${config.id}`}
                  >
                    <RefreshCw className="w-4 h-4 mr-1" />
                    Tests ({testLogs.length})
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsSessionLogSheetOpen(true)}
                    data-testid={`button-view-session-logs-${config.id}`}
                  >
                    <LogIn className="w-4 h-4 mr-1" />
                    Sessions ({sessionLogs.length})
                  </Button>
                  {!confirmDelete ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setConfirmDelete(true)}
                      data-testid={`button-delete-broker-${config.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteMutation.mutate(config.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-confirm-delete-${config.id}`}
                      >
                        {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Trash2 className="w-3 h-3 mr-1" />}
                        Delete
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete(false)}
                        data-testid={`button-cancel-delete-${config.id}`}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isPaperTrade && config ? (
            <div className="space-y-3">
              <Alert className="border-emerald-500/30 bg-emerald-500/5">
                <CheckCircle className="h-4 w-4 text-emerald-400" />
                <AlertDescription className="text-sm">
                  <strong className="text-emerald-400">Paper Trade Engine Active</strong>
                  <p className="text-muted-foreground mt-1">
                    No API credentials needed. This broker simulates trades locally using webhook signal data.
                  </p>
                </AlertDescription>
              </Alert>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card className="bg-muted/30">
                  <CardContent className="p-3 text-center">
                    <div className="text-xs text-muted-foreground mb-1">How it works</div>
                    <div className="text-sm font-medium">Webhook signals trigger simulated BUY/SELL trades</div>
                  </CardContent>
                </Card>
                <Card className="bg-muted/30">
                  <CardContent className="p-3 text-center">
                    <div className="text-xs text-muted-foreground mb-1">P&L Tracking</div>
                    <div className="text-sm font-medium">Entry/exit prices from webhook data calculate P&L</div>
                  </CardContent>
                </Card>
                <Card className="bg-muted/30">
                  <CardContent className="p-3 text-center">
                    <div className="text-xs text-muted-foreground mb-1">Risk</div>
                    <div className="text-sm font-medium">Zero risk — no real orders placed</div>
                  </CardContent>
                </Card>
              </div>
              <div className="text-xs text-muted-foreground">
                Link a strategy plan to this Paper Trade broker in the Strategy Management page, then deploy and activate it. Incoming webhook signals will automatically create simulated trades with P&L.
              </div>
            </div>
          ) : (
          <div className="grid gap-3">
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Environment</Label>
              <div className="flex items-center gap-3 flex-wrap" data-testid={`container-environment-toggle-${config?.id || "new"}`}>
                <div className="flex items-center rounded-md border border-border overflow-visible">
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      formData.environment === "uat"
                        ? "bg-amber-600 text-white"
                        : "text-muted-foreground hover-elevate"
                    }`}
                    onClick={() => setFormData({ ...formData, environment: "uat" })}
                    data-testid={`button-env-uat-${config?.id || "new"}`}
                  >
                    {isBinance ? "Testnet" : "UAT / Sandbox"}
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      formData.environment === "prod"
                        ? "bg-emerald-600 text-white"
                        : "text-muted-foreground hover-elevate"
                    }`}
                    onClick={() => setFormData({ ...formData, environment: "prod" })}
                    data-testid={`button-env-prod-${config?.id || "new"}`}
                  >
                    Production
                  </button>
                </div>
                <Badge
                  variant="outline"
                  className={`text-xs font-bold ${formData.environment === "uat" ? "text-amber-400 border-amber-500/50" : "text-emerald-400 border-emerald-500/50"}`}
                  data-testid={`badge-broker-environment-${config?.id || "new"}`}
                >
                  {formData.environment === "uat" ? "UAT" : "PROD"}
                </Badge>
                <span className={`text-xs font-medium ${formData.environment === "uat" ? "text-amber-400" : "text-emerald-400"}`} data-testid={`text-env-label-${config?.id || "new"}`}>
                  {formData.environment === "uat" 
                    ? (isBinance ? "Testnet mode — orders use virtual funds" : "Paper trading mode — orders are simulated") 
                    : "Live trading — real orders will be placed"}
                </span>
              </div>
            </div>

            {config && (
              <button
                type="button"
                className="flex items-center gap-2 text-sm text-muted-foreground hover-elevate rounded-md px-2 py-1.5 -mx-2 w-fit"
                onClick={() => setShowCredentials(!showCredentials)}
                data-testid={`button-toggle-credentials-${config.id}`}
              >
                {showCredentials ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                {showCredentials ? "Hide Credentials" : "Show / Edit Credentials"}
              </button>
            )}

            {(!config || showCredentials) && (
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                <div className="space-y-3">
                  {isBinance ? (
                    <>
                      <div>
                        <div className="flex items-center gap-1 mb-1">
                          <Label className="mb-0">API Key</Label>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              {formData.environment === "uat"
                                ? "Get your testnet API key from testnet.binance.vision (login with GitHub)"
                                : "Get your API key from Binance > Account > API Management"}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <Input
                          value={formData.consumerKey || ""}
                          onChange={(e) => setFormData({ ...formData, consumerKey: e.target.value })}
                          placeholder={formData.environment === "uat" ? "Testnet API Key" : "Binance API Key"}
                          data-testid={`input-api-key-${config?.id || "new"}`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-1 mb-1">
                          <Label className="mb-0">Secret Key</Label>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              Your secret key is only shown once when created. Keep it safe and never share it.
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <Input
                          type="password"
                          value={formData.consumerSecret || ""}
                          onChange={(e) => setFormData({ ...formData, consumerSecret: e.target.value })}
                          placeholder="Secret Key"
                          data-testid={`input-secret-key-${config?.id || "new"}`}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <Label>Consumer Key (API Token)</Label>
                        <Input
                          value={formData.consumerKey || ""}
                          onChange={(e) => setFormData({ ...formData, consumerKey: e.target.value })}
                          placeholder="From Neo Dashboard > Invest > Trade API"
                          data-testid={`input-consumer-key-${config?.id || "new"}`}
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <div className="flex items-center gap-1 mb-1">
                            <Label className="mb-0">Mobile #</Label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                Add mobile number with country code. Eg. +91
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Input
                            value={formData.mobileNumber || ""}
                            onChange={(e) => setFormData({ ...formData, mobileNumber: e.target.value })}
                            placeholder="+919876543210"
                            data-testid={`input-mobile-number-${config?.id || "new"}`}
                          />
                        </div>
                        <div>
                          <div className="flex items-center gap-1 mb-1">
                            <Label className="mb-0">UCC</Label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                Unique Client Code — Your trading account identifier provided by the broker
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Input
                            value={formData.ucc || ""}
                            onChange={(e) => setFormData({ ...formData, ucc: e.target.value })}
                            placeholder="Client code"
                            data-testid={`input-ucc-${config?.id || "new"}`}
                          />
                        </div>
                        <div>
                          <div className="flex items-center gap-1 mb-1">
                            <Label className="mb-0">MPIN</Label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                The Mobile PIN you use to log in to the mobile app of the broker
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Input
                            type="password"
                            maxLength={6}
                            value={formData.mpin || ""}
                            onChange={(e) => setFormData({ ...formData, mpin: e.target.value })}
                            placeholder="6-digit"
                            data-testid={`input-mpin-${config?.id || "new"}`}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="hidden md:flex flex-col items-center justify-end gap-1">
                  <Button
                    variant="outline"
                    onClick={handleSaveCredentials}
                    disabled={!isFormValid || isSaving}
                    className="w-full"
                    data-testid={`button-save-${config?.id || "new"}`}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {isSaving ? "Saving..." : "Save Credentials"}
                  </Button>
                  {config && (
                    <>
                      <ArrowDown className="w-4 h-4 text-muted-foreground" />
                      <Button
                        variant="outline"
                        onClick={() => testConnectionMutation.mutate(config.id)}
                        disabled={testConnectionMutation.isPending}
                        className="w-full"
                        data-testid={`button-test-${config.id}`}
                      >
                        <RefreshCw className={`w-4 h-4 mr-2 ${testConnectionMutation.isPending ? "animate-spin" : ""}`} />
                        Test Connection
                      </Button>
                    </>
                  )}
                </div>

                <div className="flex flex-col gap-2 md:hidden">
                  <Button
                    variant="outline"
                    onClick={handleSaveCredentials}
                    disabled={!isFormValid || isSaving}
                    data-testid={`button-save-mobile-${config?.id || "new"}`}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {isSaving ? "Saving..." : "Save Credentials"}
                  </Button>
                  {config && (
                    <Button
                      variant="outline"
                      onClick={() => testConnectionMutation.mutate(config.id)}
                      disabled={testConnectionMutation.isPending}
                      data-testid={`button-test-mobile-${config.id}`}
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${testConnectionMutation.isPending ? "animate-spin" : ""}`} />
                      Test Connection
                    </Button>
                  )}
                </div>
              </div>
            )}

            {isBinance ? (
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleSaveAndLogin}
                  disabled={!canLogin || authenticateMutation.isPending || isSaving}
                  data-testid={`button-authenticate-binance-${config?.id || "new"}`}
                >
                  <LogIn className="w-4 h-4 mr-2" />
                  {authenticateMutation.isPending ? "Authenticating..." : "Save & Authenticate"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Validates your API key and secret against the Binance {formData.environment === "uat" ? "Testnet" : "Production"} API
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Label className="mb-0">TOTP (from Authenticator App)</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-xs">
                        Your credentials are stored securely in the database and never shared. TOTP codes expire every 30 seconds and must be entered fresh each login.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input
                    type="text"
                    maxLength={6}
                    value={totp}
                    onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    className="font-mono tracking-widest"
                    data-testid={`input-totp-${config?.id || "new"}`}
                  />
                </div>
                <Button
                  onClick={handleSaveAndLogin}
                  disabled={!canLogin || authenticateMutation.isPending || isSaving}
                  data-testid={`button-save-and-login-${config?.id || "new"}`}
                >
                  <LogIn className="w-4 h-4 mr-2" />
                  {authenticateMutation.isPending ? "Logging in..." : "Save & Login with TOTP"}
                </Button>
              </div>
            )}

            {config?.connectionError && (
              config.connectionError.includes("geo-restricted") ? (
                <Alert variant="default" className="border-amber-500/50 bg-amber-500/10">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <AlertDescription>
                    <span className="font-medium text-amber-500">Binance API Geo-Restricted</span>
                    <span className="block mt-1 text-sm text-muted-foreground">
                      Binance blocks API access from this server's region (US). Your credentials are saved and will work when:
                    </span>
                    <ul className="mt-1.5 ml-4 list-disc text-xs text-muted-foreground space-y-0.5">
                      <li>A <code className="text-xs bg-muted px-1 rounded">BINANCE_PROXY_URL</code> environment variable is configured with a non-US proxy</li>
                      <li>The app is deployed to a server in a supported region (e.g., Singapore, Europe)</li>
                    </ul>
                    {config.lastTestResult === "success" && (
                      <span className="block mt-1.5 text-xs text-emerald-500">
                        Connectivity test passed — public API endpoints are reachable.
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>{config.connectionError}</AlertDescription>
                </Alert>
              )
            )}
          </div>
        )}
        </CardContent>
      </Card>

      {config && (
        <>
          <Sheet open={isTestLogSheetOpen} onOpenChange={setIsTestLogSheetOpen}>
            <SheetContent className={`${testExpandedView ? "w-full sm:max-w-full" : "w-full max-w-[800px]"} h-full max-h-screen overflow-hidden flex flex-col`} side="right">
              <SheetHeader>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <SheetTitle>Test Connection Data: {displayName}</SheetTitle>
                    <SheetDescription>
                      History of all API connectivity test results
                    </SheetDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => testConnectionMutation.mutate(config.id)}
                      disabled={testConnectionMutation.isPending}
                      size="sm"
                      data-testid="button-test-connection-sheet"
                    >
                      <RefreshCw className={`w-4 h-4 mr-1 ${testConnectionMutation.isPending ? "animate-spin" : ""}`} />
                      {testConnectionMutation.isPending ? "Testing..." : "Test Connection"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setTestExpandedView(!testExpandedView)}
                      data-testid="button-expand-test-data"
                      title={testExpandedView ? "Collapse" : "Expand"}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </SheetHeader>
              <div className="mt-6 flex-1 min-h-0 flex flex-col">
                <div className="flex items-center justify-between flex-shrink-0 gap-2 flex-wrap mb-3">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-sm">Test Logs</h4>
                    <Badge variant="secondary" className="text-xs">{testLogs.length} entries</Badge>
                  </div>
                  {testLogs.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid="button-clear-test-data"
                          disabled={clearTestLogsMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          Clear
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => clearTestLogsMutation.mutate(1)} data-testid="clear-test-data-1-day">
                          Older than 1 day
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => clearTestLogsMutation.mutate(7)} data-testid="clear-test-data-7-days">
                          Older than 7 days
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => clearTestLogsMutation.mutate(30)} data-testid="clear-test-data-30-days">
                          Older than 30 days
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => clearTestLogsMutation.mutate("all")} data-testid="clear-test-data-all" className="text-destructive">
                          Clear All Data
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {isLoadingTestLogs ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading test logs...</span>
                  </div>
                ) : testLogs.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No test logs yet. Click "Test Connection" to run your first test.</p>
                ) : (
                  <div
                    className="overflow-auto flex-1 min-h-0"
                    data-testid="test-logs-scroll-container"
                  >
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 z-20 bg-card">
                        <tr className="border-b">
                          <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">#</th>
                          <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Status</th>
                          <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Tested At</th>
                          <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Response Time</th>
                          <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Message</th>
                          <th className="sticky top-0 z-20 bg-card whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testLogs.map((log, index) => (
                          <tr
                            key={log.id}
                            data-testid={`row-test-log-${log.id}`}
                            className="border-b hover:bg-muted/50"
                          >
                            <td className="whitespace-nowrap px-2 py-2 font-mono text-muted-foreground">{testLogs.length - index}</td>
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
                            <td className="whitespace-nowrap px-2 py-2 font-mono">{log.testedAt}</td>
                            <td className="whitespace-nowrap px-2 py-2 font-mono">{log.responseTime ? `${log.responseTime}ms` : "—"}</td>
                            <td className="px-2 py-2 max-w-[200px] truncate" title={log.message || ""}>{log.message || "—"}</td>
                            <td className="px-2 py-2 max-w-[200px] truncate text-destructive" title={log.errorMessage || ""}>{log.errorMessage || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={isSessionLogSheetOpen} onOpenChange={setIsSessionLogSheetOpen}>
            <SheetContent className={`${sessionExpandedView ? "w-full sm:max-w-full" : "w-full max-w-[800px]"} h-full max-h-screen overflow-hidden flex flex-col`} side="right">
              <SheetHeader>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <SheetTitle>Session Data: {displayName}</SheetTitle>
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
                  {sessionLogs.length > 0 && (
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
                        <DropdownMenuItem onClick={() => clearSessionLogsMutation.mutate(1)} data-testid="clear-session-data-1-day">
                          Older than 1 day
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => clearSessionLogsMutation.mutate(7)} data-testid="clear-session-data-7-days">
                          Older than 7 days
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => clearSessionLogsMutation.mutate(30)} data-testid="clear-session-data-30-days">
                          Older than 30 days
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => clearSessionLogsMutation.mutate("all")} data-testid="clear-session-data-all" className="text-destructive">
                          Clear All Data
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
        </>
      )}
    </>
  );
}

export default function BrokerApi() {
  const [showSetupGuide, setShowSetupGuide] = useState(false);

  const { data: brokerConfigs = [], isLoading } = useQuery<BrokerConfig[]>({
    queryKey: ["/api/broker-configs"],
  });

  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async (data: Partial<InsertBrokerConfig>) => {
      return apiRequest("POST", "/api/broker-configs", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker-configs"] });
      toast({ title: "New broker configuration created" });
    },
    onError: () => {
      toast({ title: "Failed to create broker configuration", variant: "destructive" });
    },
  });

  const handleAddBrokerConfig = (broker: "kotak_neo" | "binance" | "paper_trade" = "kotak_neo") => {
    const existingCount = brokerConfigs.filter(c => c.brokerName === broker).length;

    if (broker === "paper_trade") {
      const existingPaper = brokerConfigs.filter(c => c.brokerName === "paper_trade").length;
      if (existingPaper > 0) {
        toast({ title: "Paper Trade broker already exists", variant: "destructive" });
        return;
      }
      createMutation.mutate({
        name: "Paper Trade",
        brokerName: "paper_trade",
        environment: "uat",
        isConnected: true,
      });
      setTimeout(() => {
        const configs = queryClient.getQueryData<BrokerConfig[]>(["/api/broker-configs"]);
        const paperConfig = configs?.find(c => c.brokerName === "paper_trade");
        if (paperConfig) {
          apiRequest("POST", `/api/broker-configs/${paperConfig.id}/authenticate`, {}).catch(() => {});
        }
      }, 1000);
      return;
    }

    if (broker === "binance") {
      const defaultName = existingCount === 0 ? "Binance - Testnet" : `Binance Config ${existingCount + 1}`;
      createMutation.mutate({
        name: defaultName,
        brokerName: "binance",
        environment: "uat",
      });
      return;
    }

    let defaultName = "Kotak Neo Credentials";
    let defaultEnv = "prod";

    if (existingCount === 0) {
      defaultName = "Kotak Neo - Production";
      defaultEnv = "prod";
    } else if (existingCount === 1) {
      const existing = brokerConfigs.find(c => c.brokerName === "kotak_neo");
      const existingEnv = existing?.environment || "prod";
      if (existingEnv === "prod") {
        defaultName = "Kotak Neo - Sandbox";
        defaultEnv = "uat";
      } else {
        defaultName = "Kotak Neo - Production";
        defaultEnv = "prod";
      }
    } else {
      defaultName = `Kotak Neo Config ${existingCount + 1}`;
    }

    createMutation.mutate({
      name: defaultName,
      brokerName: "kotak_neo",
      environment: defaultEnv,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-broker-title">Broker & Exchange API</h1>
              <p className="text-muted-foreground text-sm">Manage your broker credentials and configurations</p>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={createMutation.isPending}
                    data-testid="button-add-broker-config"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {createMutation.isPending ? "Creating..." : "Add Broker Config"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleAddBrokerConfig("kotak_neo")} data-testid="menu-add-kotak-neo">
                    Kotak Neo
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAddBrokerConfig("binance")} data-testid="menu-add-binance">
                    Binance
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAddBrokerConfig("paper_trade")} data-testid="menu-add-paper-trade">
                    Paper Trade
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="mt-2">
            <PageBreadcrumbs items={[{ label: "Broker API" }]} />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-3xl">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : brokerConfigs.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <Key className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Broker Configurations</h3>
              <p className="text-muted-foreground mb-4">Add your first broker configuration to get started</p>
              <Button
                onClick={handleAddBrokerConfig}
                disabled={createMutation.isPending}
                data-testid="button-add-first-broker"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Broker Config
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {brokerConfigs.map((config) => (
              <BrokerConfigCard key={config.id} config={config} />
            ))}
          </div>
        )}

        {brokerConfigs.some(c => c.brokerName === "kotak_neo") && (
          <div className="mt-6">
            <ApiFieldsReference />
          </div>
        )}

        {brokerConfigs.some(c => c.brokerName === "kotak_neo") && (
          <Card className="mt-6">
            <CardHeader
              className="cursor-pointer select-none"
              onClick={() => setShowSetupGuide(!showSetupGuide)}
              data-testid="button-toggle-setup-guide"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>Kotak Neo Setup Guide</CardTitle>
                  <CardDescription>How to get your Kotak Neo API credentials</CardDescription>
                </div>
                {showSetupGuide ? <ChevronDown className="w-5 h-5 text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
              </div>
            </CardHeader>
            {showSetupGuide && (
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
            )}
          </Card>
        )}

        <Alert className="mt-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Security Note:</strong> Your credentials are stored securely in the database and never shared.
            {brokerConfigs.some(c => c.brokerName === "kotak_neo") && " TOTP codes are time-sensitive and expire every 30 seconds."}
            {brokerConfigs.some(c => c.brokerName === "binance") && " Binance API keys can be revoked from your Binance account at any time."}
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}

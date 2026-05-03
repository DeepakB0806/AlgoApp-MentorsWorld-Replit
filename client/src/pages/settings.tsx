import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  ArrowLeft, Mail, Key, CheckCircle, XCircle, 
  Eye, EyeOff, AlertTriangle, FileText, Settings as SettingsIcon, Database,
  ShieldAlert, Trash2, Plus, ToggleLeft, ToggleRight, CalendarDays, Upload, Save, RefreshCw, Loader2, CalendarCheck
} from "lucide-react";
import { Link } from "wouter";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import mwLogo from "@/assets/images/mw-logo.png";
import type { BrokerConfig, ErrorRouting, ExchangeSetting, IndexExpirySetting, MarketHoliday, StrategyPlan } from "@shared/schema";
import { PageFooter } from "@/components/page-footer";

function getBrokerInitial(brokerName?: string | null): string {
  const map: Record<string, string> = { kotak_neo: "KN", binance: "B", zerodha: "Z", angel: "A", paper_trade: "PT" };
  if (!brokerName) return "";
  return map[brokerName] ?? brokerName.slice(0, 2).toUpperCase();
}

interface MailSettings {
  apiKeyConfigured: boolean;
  apiKeyLength: number;
  secretKeyConfigured: boolean;
  secretKeyLength: number;
  fromEmail: string;
  fromName: string;
}

type SettingsSection = "general" | "mail" | "templates" | "retention" | "error-routing" | "market-calendar";

function MailApiSettings() {
  const [showApiKey, setShowApiKey] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const { toast } = useToast();

  const { data: mailSettings, isLoading } = useQuery<MailSettings>({
    queryKey: ["/api/settings/mail"],
  });

  const testEmailMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/test-email");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: data.success ? "Test Email Sent" : "Test Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Test Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getKeyStatus = (configured: boolean, length: number, expectedLength: number) => {
    if (!configured) {
      return { status: "missing", color: "destructive" as const };
    }
    if (length !== expectedLength) {
      return { status: "invalid", color: "destructive" as const };
    }
    return { status: "valid", color: "default" as const };
  };

  const apiKeyStatus = mailSettings 
    ? getKeyStatus(mailSettings.apiKeyConfigured, mailSettings.apiKeyLength, 32)
    : null;
  
  const secretKeyStatus = mailSettings
    ? getKeyStatus(mailSettings.secretKeyConfigured, mailSettings.secretKeyLength, 32)
    : null;

  return (
    <Card data-testid="card-mail-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="w-5 h-5" />
          Mail API Settings (Mailjet)
        </CardTitle>
        <CardDescription>
          Configure Mailjet API credentials for sending emails. API keys are stored securely in environment secrets.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    API Key (MAILJET_API_KEY)
                  </span>
                  {apiKeyStatus && (
                    <div className="flex items-center gap-2">
                      <Badge variant={apiKeyStatus.color} className="text-xs">
                        {mailSettings?.apiKeyConfigured ? (
                          <>
                            {mailSettings.apiKeyLength} characters
                            {mailSettings.apiKeyLength !== 32 && (
                              <AlertTriangle className="w-3 h-3 ml-1" />
                            )}
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3 mr-1" />
                            Not Configured
                          </>
                        )}
                      </Badge>
                      {mailSettings?.apiKeyLength === 32 && (
                        <CheckCircle className="w-4 h-4 text-primary" />
                      )}
                    </div>
                  )}
                </Label>
                <div className="relative">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    value={mailSettings?.apiKeyConfigured ? "••••••••••••••••••••••••••••••••" : ""}
                    placeholder="Not configured - Set in Replit Secrets"
                    disabled
                    className="pr-10 font-mono"
                    data-testid="input-api-key"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowApiKey(!showApiKey)}
                    disabled={!mailSettings?.apiKeyConfigured}
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Expected: 32 characters. Current: {mailSettings?.apiKeyLength || 0} characters
                  {mailSettings?.apiKeyLength !== 32 && mailSettings?.apiKeyConfigured && (
                    <span className="text-destructive ml-2">
                      (Mismatch - check for extra characters or spaces)
                    </span>
                  )}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    Secret Key (MAILJET_SECRET_KEY)
                  </span>
                  {secretKeyStatus && (
                    <div className="flex items-center gap-2">
                      <Badge variant={secretKeyStatus.color} className="text-xs">
                        {mailSettings?.secretKeyConfigured ? (
                          <>
                            {mailSettings.secretKeyLength} characters
                            {mailSettings.secretKeyLength !== 32 && (
                              <AlertTriangle className="w-3 h-3 ml-1" />
                            )}
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3 mr-1" />
                            Not Configured
                          </>
                        )}
                      </Badge>
                      {mailSettings?.secretKeyLength === 32 && (
                        <CheckCircle className="w-4 h-4 text-primary" />
                      )}
                    </div>
                  )}
                </Label>
                <div className="relative">
                  <Input
                    type={showSecretKey ? "text" : "password"}
                    value={mailSettings?.secretKeyConfigured ? "••••••••••••••••••••••••••••••••" : ""}
                    placeholder="Not configured - Set in Replit Secrets"
                    disabled
                    className="pr-10 font-mono"
                    data-testid="input-secret-key"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowSecretKey(!showSecretKey)}
                    disabled={!mailSettings?.secretKeyConfigured}
                  >
                    {showSecretKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Expected: 32 characters. Current: {mailSettings?.secretKeyLength || 0} characters
                  {mailSettings?.secretKeyLength !== 32 && mailSettings?.secretKeyConfigured && (
                    <span className="text-destructive ml-2">
                      (Mismatch - check for extra characters or spaces)
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-sm text-muted-foreground mb-4">
                To configure or update API keys, go to <strong>Secrets</strong> in the Replit panel and set:
              </p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1 mb-4">
                <li><code className="bg-muted px-1 rounded">MAILJET_API_KEY</code> - Your Mailjet API Key</li>
                <li><code className="bg-muted px-1 rounded">MAILJET_SECRET_KEY</code> - Your Mailjet Secret Key</li>
              </ul>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={() => testEmailMutation.mutate()}
                disabled={testEmailMutation.isPending || !mailSettings?.apiKeyConfigured || !mailSettings?.secretKeyConfigured}
                data-testid="button-test-email"
              >
                {testEmailMutation.isPending ? "Sending..." : "Send Test Email"}
              </Button>
              {(!mailSettings?.apiKeyConfigured || !mailSettings?.secretKeyConfigured) && (
                <p className="text-sm text-muted-foreground flex items-center">
                  <AlertTriangle className="w-4 h-4 mr-2 text-yellow-500" />
                  Configure both keys to enable testing
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
function EmailTemplates() {
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);

  const templates = [
    {
      id: "verification",
      name: "Email Verification",
      description: "Sent to new customers during sign-up to verify their email address",
      subject: "Verify your email - AlgoTrading Platform",
      variables: ["{{name}}", "{{verificationUrl}}"],
      htmlPreview: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">AlgoTrading Platform</h1>
        </div>
        <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
          <h2 style="color: #1e293b; margin-top: 0;">Verify Your Email</h2>
          <p>Hi {{name}},</p>
          <p>Welcome to AlgoTrading Platform! To complete your registration, please verify your email address by clicking the button below:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="#" style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Verify Email Address</a>
          </div>
          <p style="color: #64748b; font-size: 14px;">This link will expire in 24 hours.</p>
          <p style="color: #64748b; font-size: 14px;">If you did not create an account, please ignore this email.</p>
        </div>
      </div>`,
    },
    {
      id: "team-invitation",
      name: "Team Invitation",
      description: "Sent when a team member is invited to join the platform",
      subject: "You are invited to AlgoTrading Platform",
      variables: ["{{inviterName}}", "{{registerUrl}}"],
      htmlPreview: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">AlgoTrading Platform</h1>
        </div>
        <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
          <h2 style="color: #1e293b; margin-top: 0;">You are Invited!</h2>
          <p><strong>{{inviterName}}</strong> has invited you to join AlgoTrading Platform as a team member.</p>
          <p>As a team member, you will be able to:</p>
          <ul style="color: #475569;"><li>Access trading strategies and webhooks</li><li>Monitor trading positions and orders</li><li>Configure broker API connections</li></ul>
          <div style="text-align: center; margin: 30px 0;">
            <a href="#" style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Accept Invitation</a>
          </div>
          <p style="color: #64748b; font-size: 14px;">This invitation will expire in 7 days.</p>
        </div>
      </div>`,
    },
    {
      id: "test-email",
      name: "Test Email",
      description: "Sent from Mail API Settings to verify Mailjet configuration is working",
      subject: "AlgoTrading Platform - Test Email",
      variables: [],
      htmlPreview: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">AlgoTrading Platform</h1>
        </div>
        <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
          <h2 style="color: #1e293b; margin-top: 0;">Test Email</h2>
          <p>This is a test email from AlgoTrading Platform.</p>
          <p>If you received this, the Mailjet SMTP configuration is working correctly.</p>
        </div>
      </div>`,
    },
  ];

  return (
    <Card data-testid="card-templates">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Email Templates
        </CardTitle>
        <CardDescription>
          Preview all email templates used by the platform. These templates are sent via Mailjet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {templates.map((template) => (
          <div key={template.id} className="border border-border rounded-md" data-testid={`template-${template.id}`}>
            <button
              type="button"
              onClick={() => setExpandedTemplate(expandedTemplate === template.id ? null : template.id)}
              className="w-full flex items-center justify-between p-4 text-left hover-elevate rounded-md"
              data-testid={`button-toggle-template-${template.id}`}
            >
              <div className="space-y-0.5">
                <div className="text-sm font-medium text-foreground">{template.name}</div>
                <div className="text-xs text-muted-foreground">{template.description}</div>
              </div>
              <Badge variant="outline" className="ml-3 shrink-0">{expandedTemplate === template.id ? "Collapse" : "Preview"}</Badge>
            </button>
            {expandedTemplate === template.id && (
              <div className="border-t border-border p-4 space-y-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Subject</div>
                  <div className="text-sm font-medium text-foreground" data-testid={`text-template-subject-${template.id}`}>{template.subject}</div>
                </div>
                {template.variables.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Variables</div>
                    <div className="flex gap-2 flex-wrap">
                      {template.variables.map((v) => (
                        <Badge key={v} variant="secondary" className="text-xs font-mono">{v}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Preview</div>
                  <div
                    className="border border-border rounded-md overflow-hidden bg-white p-4"
                    dangerouslySetInnerHTML={{ __html: template.htmlPreview }}
                    data-testid={`preview-template-${template.id}`}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function CapitalGatingStatus() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuperAdmin = (user as any)?.role === "super_admin" || (user as any)?.isSuperAdmin === true;

  const { data: plans = [], isLoading } = useQuery<StrategyPlan[]>({
    queryKey: ["/api/strategy-plans"],
  });
  const { data: brokerConfigs = [] } = useQuery<BrokerConfig[]>({
    queryKey: ["/api/broker-configs"],
  });
  const { data: scripStatus } = useQuery<{ lastSyncDateIST: string; lastSyncTimeIST: string; isStale: boolean; todayIST: string }>({
    queryKey: ["/api/broker/kotak/scrip-status"],
    refetchInterval: 5 * 60 * 1000,
  });

  const brokerById = new Map(brokerConfigs.map(bc => [bc.id, bc]));
  const liveKotakBrokers = brokerConfigs.filter(bc => bc.isConnected && bc.brokerName === "kotak_neo");

  const activePlans = plans.filter(p =>
    p.deploymentStatus === "active" || p.deploymentStatus === "deployed"
  ).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

  const [recalcPending, setRecalcPending] = useState(false);

  async function handleRecalculateAll() {
    if (liveKotakBrokers.length === 0) {
      toast({ title: "No connected Kotak Neo brokers", variant: "destructive" });
      return;
    }
    setRecalcPending(true);
    try {
      await Promise.all(
        liveKotakBrokers.map(bc =>
          apiRequest("POST", `/api/broker-configs/${bc.id}/calculate-margins`)
        )
      );
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-plans"] });
      toast({ title: "Margins recalculated for all active plans" });
    } catch {
      toast({ title: "Failed to recalculate margins", variant: "destructive" });
    } finally {
      setRecalcPending(false);
    }
  }

  return (
    <Card data-testid="card-capital-gating-status" className="mt-4">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="w-4 h-4" />
              Capital Gating Status
            </CardTitle>
            <CardDescription className="mt-1">
              Active and deployed plans sorted by priority rank. Margin estimates are updated after each Scrip Master sync.
            </CardDescription>
          </div>
          {isSuperAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRecalculateAll}
              disabled={recalcPending || liveKotakBrokers.length === 0}
              data-testid="button-recalculate-all-margins"
              className="shrink-0 text-xs"
            >
              {recalcPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              Recalculate All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {scripStatus?.isStale && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-muted/40 border border-border/30 text-xs text-muted-foreground" data-testid="banner-scrip-stale">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              Scrip Master is from <span className="font-mono text-foreground/70">{scripStatus.lastSyncDateIST}</span> — margins may be outdated.
              Use Resync in Broker API to refresh.
            </span>
          </div>
        )}
        {isLoading ? (
          <div className="text-center py-4 text-muted-foreground text-sm">Loading...</div>
        ) : activePlans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active or deployed plans.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left px-2 py-1.5 text-muted-foreground">Rank</th>
                  <th className="text-left px-2 py-1.5 text-muted-foreground">Plan</th>
                  <th className="text-left px-2 py-1.5 text-muted-foreground">Status</th>
                  <th className="text-left px-2 py-1.5 text-muted-foreground">Auto Resume</th>
                  <th className="text-right px-2 py-1.5 text-muted-foreground">Est. Margin</th>
                  <th className="text-right px-2 py-1.5 text-muted-foreground">Calc. At</th>
                </tr>
              </thead>
              <tbody>
                {activePlans.map(plan => (
                  <tr key={plan.id} className="border-b border-border/20 hover:bg-muted/20" data-testid={`row-capital-gating-${plan.id}`}>
                    <td className="px-2 py-1.5 font-mono text-muted-foreground">
                      {plan.rank != null
                        ? `${getBrokerInitial(brokerById.get(plan.brokerConfigId ?? "")?.brokerName)}${plan.rank}`
                        : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-2 py-1.5 font-medium">{plan.name}</td>
                    <td className="px-2 py-1.5">
                      <Badge variant="outline" className="text-[10px]">{plan.deploymentStatus}</Badge>
                    </td>
                    <td className="px-2 py-1.5">
                      {plan.autoResume !== false ? (
                        <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-400/30">ON</Badge>
                      ) : (
                        <Badge className="text-[10px] bg-red-500/20 text-red-400 border-red-400/30">OFF</Badge>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {plan.estimatedMargin ? (
                        <span className="text-foreground">₹{Number(plan.estimatedMargin).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
                      ) : scripStatus?.isStale ? (
                        <span className="text-muted-foreground/50 flex items-center justify-end gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          N/A
                        </span>
                      ) : (
                        <span className="text-amber-400 flex items-center justify-end gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          N/A
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground">
                      {plan.marginCalculatedAt
                        ? new Date(plan.marginCalculatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).replace(",", "")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GeneralTradingSettings() {
  const [intervalValue, setIntervalValue] = useState<string>("");
  const [shortfallRetryCount, setShortfallRetryCount] = useState<string>("");
  const [rollbackRetryCount, setRollbackRetryCount] = useState<string>("");
  const [maxCloseRetryCount, setMaxCloseRetryCount] = useState<string>("");
  const [bufferPoints, setBufferPoints] = useState<string>("");
  const [orderDelayMs, setOrderDelayMs] = useState<string>("");
  const [syncClockValue, setSyncClockValue] = useState<string>("09:10");
  const [intradayIntervalValue, setIntradayIntervalValue] = useState<string>("0");
  const [spanRateValue, setSpanRateValue] = useState<string>("5.0");
  const [expiryMultiplierValue, setExpiryMultiplierValue] = useState<string>("1.5");
  const { toast } = useToast();

  const { data: setting, isLoading } = useQuery<{ key: string; value: string | null }>({
    queryKey: ["/api/settings/squareoff_retry_interval_ms"],
  });

  const { data: shortfallSetting, isLoading: shortfallLoading } = useQuery<{ key: string; value: string | null }>({
    queryKey: ["/api/settings/margin_shortfall_retry_count"],
  });

  const { data: rollbackSetting, isLoading: rollbackLoading } = useQuery<{ key: string; value: string | null }>({
    queryKey: ["/api/settings/rollback_api_retry_count"],
  });

  const { data: maxCloseRetrySetting, isLoading: maxCloseRetryLoading } = useQuery<{ key: string; value: string | null }>({
    queryKey: ["/api/settings/max_close_retry_count"],
  });

  const { data: bufferSetting, isLoading: bufferLoading } = useQuery<{ key: string; value: string | null }>({
    queryKey: ["/api/settings/limit_order_buffer_points"],
  });

  const { data: orderDelaySetting, isLoading: orderDelayLoading } = useQuery<{ key: string; value: string | null }>({
    queryKey: ["/api/settings/order_execution_delay_ms"],
  });

  const { data: syncClockSetting, isLoading: syncClockLoading } = useQuery<{ key: string; value: string | null }>({
    queryKey: ["/api/settings/scrip_master_sync_time"],
  });

  const { data: intradayIntervalSetting, isLoading: intradayIntervalLoading } = useQuery<{ key: string; value: string | null }>({
    queryKey: ["/api/settings/scrip_master_intraday_interval_mins"],
  });

  const { data: spanRateSetting, isLoading: spanRateLoading } = useQuery<{ key: string; value: string | null }>({
    queryKey: ["/api/settings/span_rate_percent"],
  });

  const { data: expiryMultiplierSetting, isLoading: expiryMultiplierLoading } = useQuery<{ key: string; value: string | null }>({
    queryKey: ["/api/settings/expiry_day_span_multiplier"],
  });

  useEffect(() => {
    if (setting?.value !== undefined && setting?.value !== null) {
      setIntervalValue(setting.value);
    } else if (!isLoading) {
      setIntervalValue("0");
    }
  }, [setting, isLoading]);

  useEffect(() => {
    if (shortfallSetting?.value !== undefined && shortfallSetting?.value !== null) {
      setShortfallRetryCount(shortfallSetting.value);
    } else if (!shortfallLoading) {
      setShortfallRetryCount("0");
    }
  }, [shortfallSetting, shortfallLoading]);

  useEffect(() => {
    if (rollbackSetting?.value !== undefined && rollbackSetting?.value !== null) {
      setRollbackRetryCount(rollbackSetting.value);
    } else if (!rollbackLoading) {
      setRollbackRetryCount("5");
    }
  }, [rollbackSetting, rollbackLoading]);

  useEffect(() => {
    if (maxCloseRetrySetting?.value !== undefined && maxCloseRetrySetting?.value !== null) {
      setMaxCloseRetryCount(maxCloseRetrySetting.value);
    } else if (!maxCloseRetryLoading) {
      setMaxCloseRetryCount("0");
    }
  }, [maxCloseRetrySetting, maxCloseRetryLoading]);

  useEffect(() => {
    if (bufferSetting?.value !== undefined && bufferSetting?.value !== null) {
      setBufferPoints(bufferSetting.value);
    } else if (!bufferLoading) {
      setBufferPoints("1");
    }
  }, [bufferSetting, bufferLoading]);

  useEffect(() => {
    if (orderDelaySetting?.value !== undefined && orderDelaySetting?.value !== null) {
      setOrderDelayMs(orderDelaySetting.value);
    }
  }, [orderDelaySetting, orderDelayLoading]);

  useEffect(() => {
    if (syncClockSetting?.value) {
      setSyncClockValue(syncClockSetting.value);
    } else if (!syncClockLoading) {
      setSyncClockValue("09:10");
    }
  }, [syncClockSetting, syncClockLoading]);

  useEffect(() => {
    if (intradayIntervalSetting?.value !== undefined && intradayIntervalSetting?.value !== null) {
      setIntradayIntervalValue(intradayIntervalSetting.value);
    } else if (!intradayIntervalLoading) {
      setIntradayIntervalValue("0");
    }
  }, [intradayIntervalSetting, intradayIntervalLoading]);

  useEffect(() => {
    if (spanRateSetting?.value !== undefined && spanRateSetting?.value !== null) {
      setSpanRateValue(spanRateSetting.value);
    } else if (!spanRateLoading) {
      setSpanRateValue("5.0");
    }
  }, [spanRateSetting, spanRateLoading]);

  useEffect(() => {
    if (expiryMultiplierSetting?.value !== undefined && expiryMultiplierSetting?.value !== null) {
      setExpiryMultiplierValue(expiryMultiplierSetting.value);
    } else if (!expiryMultiplierLoading) {
      setExpiryMultiplierValue("1.5");
    }
  }, [expiryMultiplierSetting, expiryMultiplierLoading]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const ms = parseInt(intervalValue, 10);
      if (isNaN(ms) || ms < 0) throw new Error("Enter a valid non-negative number");
      const res = await apiRequest("POST", "/api/settings/squareoff_retry_interval_ms", { value: String(ms) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/squareoff_retry_interval_ms"] });
      toast({ title: "Saved", description: "Square-off retry interval updated." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveShortfallMutation = useMutation({
    mutationFn: async () => {
      const count = parseInt(shortfallRetryCount, 10);
      if (isNaN(count) || count < 0) throw new Error("Enter a valid non-negative number");
      const res = await apiRequest("POST", "/api/settings/margin_shortfall_retry_count", { value: String(count) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/margin_shortfall_retry_count"] });
      toast({ title: "Saved", description: "Margin shortfall retry count updated." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveRollbackMutation = useMutation({
    mutationFn: async () => {
      const count = parseInt(rollbackRetryCount, 10);
      if (isNaN(count) || count < 0) throw new Error("Enter a valid non-negative number");
      const res = await apiRequest("POST", "/api/settings/rollback_api_retry_count", { value: String(count) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/rollback_api_retry_count"] });
      toast({ title: "Saved", description: "Rollback retry count updated." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveMaxCloseRetryMutation = useMutation({
    mutationFn: async () => {
      const count = parseInt(maxCloseRetryCount, 10);
      if (isNaN(count) || count < 0) throw new Error("Enter a valid non-negative number");
      const res = await apiRequest("POST", "/api/settings/max_close_retry_count", { value: String(count) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/max_close_retry_count"] });
      toast({ title: "Saved", description: "Max exit retry count updated." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveBufferMutation = useMutation({
    mutationFn: async () => {
      const pts = parseFloat(bufferPoints);
      if (isNaN(pts) || pts < 0) throw new Error("Enter a valid non-negative number");
      const res = await apiRequest("POST", "/api/settings/limit_order_buffer_points", { value: String(pts) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/limit_order_buffer_points"] });
      toast({ title: "Saved", description: "Limit order buffer updated." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveOrderDelayMutation = useMutation({
    mutationFn: async () => {
      const ms = parseInt(orderDelayMs, 10);
      if (isNaN(ms) || ms < 0) throw new Error("Enter a valid non-negative number");
      const res = await apiRequest("POST", "/api/settings/order_execution_delay_ms", { value: String(ms) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/order_execution_delay_ms"] });
      toast({ title: "Saved", description: "Inter-leg execution delay updated." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveSyncClockMutation = useMutation({
    mutationFn: async () => {
      if (!syncClockValue) throw new Error("Enter a valid time");
      const res = await apiRequest("POST", "/api/settings/scrip_master_sync_time", { value: syncClockValue });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/scrip_master_sync_time"] });
      toast({ title: "Saved", description: "Scrip master sync time updated. New schedule is active immediately." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveIntradayIntervalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/scrip_master_intraday_interval_mins", { value: intradayIntervalValue });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/scrip_master_intraday_interval_mins"] });
      const label = intradayIntervalValue === "0" ? "disabled" : `every ${intradayIntervalValue} minutes during market hours`;
      toast({ title: "Saved", description: `Intraday scrip refresh ${label}.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveSpanRateMutation = useMutation({
    mutationFn: async () => {
      const val = parseFloat(spanRateValue);
      if (isNaN(val) || val <= 0 || val > 100) throw new Error("Enter a valid percentage between 0 and 100");
      const res = await apiRequest("POST", "/api/settings/span_rate_percent", { value: String(val) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/span_rate_percent"] });
      toast({ title: "Saved", description: "SPAN rate updated." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveExpiryMultiplierMutation = useMutation({
    mutationFn: async () => {
      const val = parseFloat(expiryMultiplierValue);
      if (isNaN(val) || val < 1) throw new Error("Enter a multiplier ≥ 1.0");
      const res = await apiRequest("POST", "/api/settings/expiry_day_span_multiplier", { value: String(val) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/expiry_day_span_multiplier"] });
      toast({ title: "Saved", description: "Expiry day SPAN multiplier updated." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="card-general-trading-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon className="w-5 h-5" />
          Trading Execution
        </CardTitle>
        <CardDescription>
          Controls the delay between retry attempts for all persistent loops — entry, exit, and square-off.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading || shortfallLoading || rollbackLoading || maxCloseRetryLoading || bufferLoading || orderDelayLoading || syncClockLoading || intradayIntervalLoading || spanRateLoading || expiryMultiplierLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : (
          <>
            <div className="space-y-3">
              <Label htmlFor="input-squareoff-interval">
                Retry Interval (ms)
              </Label>
              <p className="text-sm text-muted-foreground">
                Delay between retry attempts after a failed exit order. Set to 0 for immediate retry — the broker API response time is the natural throttle. Increase only if the broker rejects rapid repeated orders.
              </p>
              <div className="flex items-center gap-3 max-w-xs">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">Kotak Neo</span>
                <Input
                  id="input-squareoff-interval"
                  data-testid="input-squareoff-interval"
                  type="number"
                  min="0"
                  step="50"
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(e.target.value)}
                  placeholder="2000"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">ms</span>
              </div>
              <p className="text-xs text-muted-foreground">Kotak Neo's RMS registers in 400–800ms.</p>
              <Button
                data-testid="button-save-squareoff-interval"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>

            <div className="space-y-3 pt-2 border-t">
              <Label htmlFor="input-shortfall-retry-count">
                Retry in case Margin Shortfall
              </Label>
              <p className="text-sm text-muted-foreground">
                Number of times to retry the entire basket at a reduced lot multiplier when Kotak rejects an order due to margin shortfall. Each retry steps the multiplier down by 1x. Set to 0 to disable automatic retry.
              </p>
              <div className="flex items-center gap-3 max-w-xs">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">Kotak Neo</span>
                <Input
                  id="input-shortfall-retry-count"
                  data-testid="input-shortfall-retry-count"
                  type="number"
                  min="0"
                  step="1"
                  value={shortfallRetryCount}
                  onChange={(e) => setShortfallRetryCount(e.target.value)}
                  placeholder="0"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">retries</span>
              </div>
              <p className="text-xs text-muted-foreground">e.g. set to 2 at 3x: tries 3x → 2x → 1x before giving up.</p>
              <Button
                data-testid="button-save-shortfall-retry-count"
                onClick={() => saveShortfallMutation.mutate()}
                disabled={saveShortfallMutation.isPending}
              >
                {saveShortfallMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>

            <div className="space-y-3 pt-2 border-t">
              <Label htmlFor="input-rollback-retry-count">
                Retry API Crashes During ATOMIC ROLLBACK
              </Label>
              <p className="text-sm text-muted-foreground">
                Number of times to persistently retry market-selling a ghost leg if the broker API crashes during an Atomic Margin Rollback. Set to 0 to disable automatic retry.
              </p>
              <div className="flex items-center gap-3 max-w-xs">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">Kotak Neo</span>
                <Input
                  id="input-rollback-retry-count"
                  data-testid="input-rollback-retry-count"
                  type="number"
                  min="0"
                  step="1"
                  value={rollbackRetryCount}
                  onChange={(e) => setRollbackRetryCount(e.target.value)}
                  placeholder="5"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">retries</span>
              </div>
              <p className="text-xs text-muted-foreground">e.g. set to 5: engine retries the market-sell 5 times before declaring a ghost.</p>
              <Button
                data-testid="button-save-rollback-retry-count"
                onClick={() => saveRollbackMutation.mutate()}
                disabled={saveRollbackMutation.isPending}
              >
                {saveRollbackMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>

            <div className="space-y-3 pt-2 border-t">
              <Label htmlFor="input-max-close-retry-count">
                Max Exit Retry Attempts
              </Label>
              <p className="text-sm text-muted-foreground">
                Maximum times the persistent square-off loop retries a failed exit. Set to 0 for unlimited. When the cap is reached, the trade stays in 'close_failed' and the Force-Close button becomes the only resolution.
              </p>
              <div className="flex items-center gap-3 max-w-xs">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">Kotak Neo</span>
                <Input
                  id="input-max-close-retry-count"
                  data-testid="input-max-close-retry-count"
                  type="number"
                  min="0"
                  step="1"
                  value={maxCloseRetryCount}
                  onChange={(e) => setMaxCloseRetryCount(e.target.value)}
                  placeholder="0"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">retries</span>
              </div>
              <p className="text-xs text-muted-foreground">e.g. set to 5: loop retries 5 times then stops. Use Force-Close button to manually clear stuck trades.</p>
              <Button
                data-testid="button-save-max-close-retry-count"
                onClick={() => saveMaxCloseRetryMutation.mutate()}
                disabled={saveMaxCloseRetryMutation.isPending}
              >
                {saveMaxCloseRetryMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>

            <div className="space-y-3 pt-2 border-t">
              <Label htmlFor="input-limit-order-buffer">
                Limit Order Buffer (Points)
              </Label>
              <p className="text-sm text-muted-foreground">
                Points added to (BUY) or subtracted from (SELL) the current price when placing a Limit Order. Ensures the order gets filled even if the price moves slightly. Set to 0 for exact price. Applies to all LMT order placements.
              </p>
              <div className="flex items-center gap-3 max-w-xs">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">Kotak Neo</span>
                <Input
                  id="input-limit-order-buffer"
                  data-testid="input-limit-order-buffer"
                  type="number"
                  min="0"
                  step="0.05"
                  value={bufferPoints}
                  onChange={(e) => setBufferPoints(e.target.value)}
                  placeholder="1"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">pts</span>
              </div>
              <p className="text-xs text-muted-foreground">e.g. set to 1: BUY at ltp+1, SELL at ltp-1. Price rounded to nearest 0.05.</p>
              <Button
                data-testid="button-save-limit-order-buffer"
                onClick={() => saveBufferMutation.mutate()}
                disabled={saveBufferMutation.isPending}
              >
                {saveBufferMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>

            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center gap-2">
                <Label htmlFor="input-order-delay-ms">Inter-Leg Execution Delay (ms)</Label>
                <Badge variant="outline" className="text-xs">Required</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Delay in milliseconds between sequenced leg executions (entry and exit). Required — no default. Set to 0 for immediate sequential fire.
              </p>
              <div className="flex items-center gap-3 max-w-xs">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">Kotak Neo</span>
                <Input
                  id="input-order-delay-ms"
                  data-testid="input-order-delay-ms"
                  type="number"
                  min="0"
                  step="50"
                  value={orderDelayMs}
                  onChange={(e) => setOrderDelayMs(e.target.value)}
                  placeholder="e.g. 200"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">ms</span>
              </div>
              <Button
                data-testid="button-save-order-delay-ms"
                onClick={() => saveOrderDelayMutation.mutate()}
                disabled={saveOrderDelayMutation.isPending}
              >
                {saveOrderDelayMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>

            <div className="space-y-3 pt-2 border-t">
              <Label htmlFor="input-scrip-sync-clock">
                Kotak Scrip Master Sync Clock (IST)
              </Label>
              <p className="text-sm text-muted-foreground">
                Daily time at which the server automatically re-downloads the Kotak Neo scrip master to pick up post-expiry rolled-over contracts. Takes effect immediately — no restart required.
              </p>
              <div className="flex items-center gap-3 max-w-xs">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">Kotak Neo</span>
                <Input
                  id="input-scrip-sync-clock"
                  data-testid="input-scrip-sync-clock"
                  type="time"
                  value={syncClockValue}
                  onChange={(e) => setSyncClockValue(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">Default: 09:10. Exchange rolls over contract lists after 09:00 on expiry settlement days.</p>
              <Button
                data-testid="button-save-scrip-sync-clock"
                onClick={() => saveSyncClockMutation.mutate()}
                disabled={saveSyncClockMutation.isPending}
              >
                {saveSyncClockMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>

            <div className="space-y-3 pt-2 border-t">
              <Label htmlFor="select-intraday-interval">
                Intraday Scrip Master Refresh Interval
              </Label>
              <p className="text-sm text-muted-foreground">
                Re-downloads the scrip master during market hours (09:30–15:30 IST) at the selected interval. Useful on expiry days when new contracts roll in mid-session. Set to Disabled to rely solely on the daily sync.
              </p>
              <div className="flex items-center gap-3 max-w-xs">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">Kotak Neo</span>
                <Select
                  value={intradayIntervalValue}
                  onValueChange={setIntradayIntervalValue}
                >
                  <SelectTrigger id="select-intraday-interval" data-testid="select-intraday-interval" className="w-48">
                    <SelectValue placeholder="Select interval" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Disabled</SelectItem>
                    <SelectItem value="30">Every 30 minutes</SelectItem>
                    <SelectItem value="60">Every 60 minutes</SelectItem>
                    <SelectItem value="120">Every 2 hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">Default: Disabled. Enable on days with heavy expiry activity.</p>
              <Button
                data-testid="button-save-intraday-interval"
                onClick={() => saveIntradayIntervalMutation.mutate()}
                disabled={saveIntradayIntervalMutation.isPending}
              >
                {saveIntradayIntervalMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>

            <div className="space-y-3 pt-2 border-t">
              <Label htmlFor="input-span-rate">
                SPAN Rate for Margin Calculation (%)
              </Label>
              <p className="text-sm text-muted-foreground">
                Percentage of the strike price used as the SPAN margin estimate per SELL lot. The engine computes UT and DT margins separately and uses the larger of the two as the estimated margin for capital gating. BUY legs are excluded (they reduce net SPAN in a live basket, but are ignored here for a conservative estimate).
              </p>
              <div className="flex items-center gap-3 max-w-xs">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">Kotak Neo</span>
                <Input
                  id="input-span-rate"
                  data-testid="input-span-rate"
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  value={spanRateValue}
                  onChange={(e) => setSpanRateValue(e.target.value)}
                  placeholder="5.0"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">%</span>
              </div>
              <p className="text-xs text-muted-foreground">Default: 5.0%. Formula: rate × strike × lotSize × lotMultiplier × lots (SELL only).</p>
              <Button
                data-testid="button-save-span-rate"
                onClick={() => saveSpanRateMutation.mutate()}
                disabled={saveSpanRateMutation.isPending}
              >
                {saveSpanRateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>

            <div className="space-y-3 pt-2 border-t">
              <Label htmlFor="input-expiry-multiplier">
                Expiry Day SPAN Multiplier
              </Label>
              <p className="text-sm text-muted-foreground">
                On expiry day the effective SPAN rate is multiplied by this value to account for elevated margin requirements near settlement. Applied automatically when today's IST date matches the plan's target expiry date.
              </p>
              <div className="flex items-center gap-3 max-w-xs">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">Kotak Neo</span>
                <Input
                  id="input-expiry-multiplier"
                  data-testid="input-expiry-multiplier"
                  type="number"
                  min="1.0"
                  step="0.1"
                  value={expiryMultiplierValue}
                  onChange={(e) => setExpiryMultiplierValue(e.target.value)}
                  placeholder="1.5"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">×</span>
              </div>
              <p className="text-xs text-muted-foreground">Default: 1.5×. e.g. at 5% rate, expiry day effective rate = 7.5%.</p>
              <Button
                data-testid="button-save-expiry-multiplier"
                onClick={() => saveExpiryMultiplierMutation.mutate()}
                disabled={saveExpiryMultiplierMutation.isPending}
              >
                {saveExpiryMultiplierMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ErrorRoutingSettings() {
  const [newPattern, setNewPattern] = useState("");
  const [newActionType, setNewActionType] = useState("terminal_close");
  const [newDescription, setNewDescription] = useState("");
  const { toast } = useToast();

  const { data: routes = [], isLoading } = useQuery<ErrorRouting[]>({
    queryKey: ["/api/error-routes"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!newPattern.trim()) throw new Error("Pattern is required");
      const res = await apiRequest("POST", "/api/error-routes", {
        errorPattern: newPattern.trim().toLowerCase(),
        actionType: newActionType,
        description: newDescription.trim() || null,
        isActive: true,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create rule");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/error-routes"] });
      setNewPattern("");
      setNewDescription("");
      toast({ title: "Rule added", description: "Error routing rule created." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/error-routes/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/error-routes"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/error-routes/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/error-routes"] });
      toast({ title: "Rule deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <Card data-testid="card-error-routing">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5" />
            Error Routing Rules
          </CardTitle>
          <CardDescription>
            Define exact Kotak error patterns and the action to take when they occur in a failed exit order.
            Terminal patterns stop the retry loop and mark the trade closed. Rules are checked in order — first match wins.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading rules…</div>
          ) : routes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No error routing rules configured. Add one below.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Pattern (case-insensitive)</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-center w-20">Active</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routes.map((route) => (
                    <TableRow key={route.id} data-testid={`row-error-route-${route.id}`}
                      className={!route.isActive ? "opacity-50" : ""}>
                      <TableCell className="text-xs text-muted-foreground font-mono">{route.id}</TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{route.errorPattern}</code>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={route.actionType === "terminal_close"
                            ? "text-red-400 border-red-400/50 text-xs"
                            : "text-muted-foreground text-xs"}
                          data-testid={`badge-action-${route.id}`}
                        >
                          {route.actionType === "terminal_close" ? "terminal_close" : route.actionType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {route.description || "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          data-testid={`toggle-error-route-${route.id}`}
                          checked={route.isActive}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: route.id, isActive: checked })}
                          disabled={toggleMutation.isPending}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          data-testid={`button-delete-error-route-${route.id}`}
                          onClick={() => {
                            if (confirm(`Delete rule for "${route.errorPattern}"?`)) {
                              deleteMutation.mutate(route.id);
                            }
                          }}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add New Rule
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr_auto] items-end">
              <div className="space-y-1">
                <Label htmlFor="input-new-error-pattern" className="text-xs">Error Pattern</Label>
                <Input
                  id="input-new-error-pattern"
                  data-testid="input-new-error-pattern"
                  placeholder="e.g. instrument has been expired"
                  value={newPattern}
                  onChange={(e) => setNewPattern(e.target.value)}
                  className="h-8 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="select-new-action-type" className="text-xs">Action</Label>
                <Select value={newActionType} onValueChange={setNewActionType}>
                  <SelectTrigger id="select-new-action-type" data-testid="select-new-action-type" className="h-8 text-sm w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="terminal_close">terminal_close</SelectItem>
                    <SelectItem value="system_halt">system_halt</SelectItem>
                    <SelectItem value="cancel_plan">cancel_plan</SelectItem>
                    <SelectItem value="ignore">ignore</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="input-new-error-description" className="text-xs">Description (optional)</Label>
                <Input
                  id="input-new-error-description"
                  data-testid="input-new-error-description"
                  placeholder="Context for this rule"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <Button
                data-testid="button-add-error-route"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !newPattern.trim()}
                className="h-8"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                {createMutation.isPending ? "Adding…" : "Add"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const RETENTION_FIELDS = [
  { key: "retention_webhook_data_days",        label: "Signal history (webhook data)",   default: "90",  hint: "Raw incoming signals" },
  { key: "retention_strategy_trades_days",     label: "Trade records",                   default: "365", hint: "All executed trades" },
  { key: "retention_broker_session_logs_days", label: "Broker session logs",             default: "30",  hint: "Login/logout history" },
  { key: "retention_broker_test_logs_days",    label: "Broker test logs",               default: "7",   hint: "Connectivity test results" },
  { key: "retention_webhook_status_logs_days", label: "Webhook status logs",             default: "30",  hint: "Per-webhook activity" },
];

function RetentionField({ field }: { field: typeof RETENTION_FIELDS[0] }) {
  const [value, setValue] = useState("");
  const { toast } = useToast();

  const { data: setting, isLoading } = useQuery<{ key: string; value: string | null }>({
    queryKey: [`/api/settings/${field.key}`],
  });

  useEffect(() => {
    if (setting?.value) {
      setValue(setting.value);
    } else if (!isLoading) {
      setValue(field.default);
    }
  }, [setting, isLoading, field.default]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const days = parseInt(value, 10);
      if (isNaN(days) || days < 1) throw new Error("Enter a valid number of days (minimum 1)");
      const res = await apiRequest("POST", `/api/settings/${field.key}`, { value: String(days) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/settings/${field.key}`] });
      toast({ title: "Saved", description: `${field.label} retention updated.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center py-2 border-b border-border last:border-0">
      <div>
        <div className="text-sm font-medium text-foreground">{field.label}</div>
        <div className="text-xs text-muted-foreground">{field.hint}</div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          data-testid={`input-${field.key}`}
          type="number"
          min="1"
          className="w-24 h-8 text-sm"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={isLoading}
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">days</span>
      </div>
      <Button
        data-testid={`button-save-${field.key}`}
        size="sm"
        variant="outline"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending || isLoading}
      >
        {saveMutation.isPending ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

function DataRetentionSettings() {
  return (
    <Card data-testid="card-data-retention-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="w-5 h-5" />
          Data Retention
        </CardTitle>
        <CardDescription>
          Old records are pruned automatically every 24 hours. Set how many days of history to keep for each data type.
          Changes take effect on the next daily cleanup run.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border">
          {RETENTION_FIELDS.map((f) => (
            <RetentionField key={f.key} field={f} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const DAY_NAMES: Record<number, string> = {
  0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday",
};

function MarketCalendarSettings() {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();

  // ── Exchange Settings state ──────────────────────────────────────────────
  type ExchangeEdit = { marketOpenTime: string; marketCloseTime: string; isActive: boolean };
  const [exchangeEdits, setExchangeEdits] = useState<Record<string, ExchangeEdit>>({});

  const { data: exchangeRows = [], isLoading: exchLoading } = useQuery<ExchangeSetting[]>({
    queryKey: ["/api/market-calendar/exchange-settings"],
  });

  const saveExchangeMutation = useMutation({
    mutationFn: async ({ exchange, data }: { exchange: string; data: ExchangeEdit }) => {
      const res = await apiRequest("POST", `/api/market-calendar/exchange-settings/${exchange}`, data);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/market-calendar/exchange-settings"] });
      toast({ title: "Saved", description: `${vars.exchange} trading hours updated.` });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  function getExchangeEdit(row: ExchangeSetting): ExchangeEdit {
    return exchangeEdits[row.exchange] ?? {
      marketOpenTime: row.marketOpenTime,
      marketCloseTime: row.marketCloseTime,
      isActive: row.isActive,
    };
  }

  function setExchangeField(exchange: string, field: keyof ExchangeEdit, value: string | boolean) {
    setExchangeEdits(prev => {
      const existing: ExchangeEdit = prev[exchange] ?? { marketOpenTime: "", marketCloseTime: "", isActive: true };
      return { ...prev, [exchange]: { ...existing, [field]: value } };
    });
  }

  // ── Index Expiry state ───────────────────────────────────────────────────
  const [expiryEdits, setExpiryEdits] = useState<Record<string, number>>({});

  const { data: expiryRows = [], isLoading: expiryLoading } = useQuery<IndexExpirySetting[]>({
    queryKey: ["/api/market-calendar/index-expiry-settings"],
  });

  const saveExpiryMutation = useMutation({
    mutationFn: async ({ indexName, defaultExpiryDay }: { indexName: string; defaultExpiryDay: number }) => {
      const res = await apiRequest("POST", `/api/market-calendar/index-expiry-settings/${indexName}`, { defaultExpiryDay });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/market-calendar/index-expiry-settings"] });
      toast({ title: "Saved", description: `${vars.indexName} expiry day updated.` });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  function getExpiryDay(row: IndexExpirySetting): number {
    return expiryEdits[row.indexName] ?? row.defaultExpiryDay;
  }

  // ── Holiday Calendar state ───────────────────────────────────────────────
  const [holidayYear, setHolidayYear] = useState<string>(String(currentYear));
  const [holidayExchange, setHolidayExchange] = useState<string>("NSE");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvParseError, setCsvParseError] = useState<string>("");
  const [holidayTableOpen, setHolidayTableOpen] = useState<boolean>(false);
  const [confirmReSync, setConfirmReSync] = useState<boolean>(false);

  const { data: holidayRows = [], isLoading: holidayLoading } = useQuery<MarketHoliday[]>({
    queryKey: ["/api/market-calendar/holidays", holidayYear, holidayExchange],
    queryFn: async () => {
      const res = await fetch(`/api/market-calendar/holidays?year=${holidayYear}&exchange=${holidayExchange}`);
      return res.json();
    },
  });

  type SyncStatusAll = {
    year: number;
    NSE: { count: number; lastSyncedAt: string | null };
    BSE: { count: number; lastSyncedAt: string | null };
    MCX: { count: number; lastSyncedAt: string | null };
  };

  const { data: syncStatusAll } = useQuery<SyncStatusAll>({
    queryKey: ["/api/market-calendar/holidays/sync-status-all", holidayYear],
    queryFn: () =>
      fetch(`/api/market-calendar/holidays/sync-status-all?year=${holidayYear}`)
        .then(r => r.json()),
  });

  const uploadHolidaysMutation = useMutation({
    mutationFn: async (payload: { year: number; exchange: string; rows: { date: string; description: string }[] }) => {
      const res = await apiRequest("POST", "/api/market-calendar/holidays/upload", payload);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/market-calendar/holidays"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market-calendar/holidays/sync-status-all"] });
      setCsvFile(null);
      setHolidayTableOpen(true);
      toast({ title: "Uploaded", description: `${data.inserted} holiday(s) saved for ${data.exchange} ${data.year}.` });
    },
    onError: (err: any) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const syncHolidaysMutation = useMutation({
    mutationFn: async (payload: { year: number; exchange: string }) => {
      const res = await fetch("/api/market-calendar/holidays/sync-nse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Sync failed");
      return body as { inserted: number; year: number; exchange: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/market-calendar/holidays"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market-calendar/holidays/sync-status-all"] });
      setConfirmReSync(false);
      setHolidayTableOpen(true);
      toast({
        title: "Sync complete",
        description: `Synced ${data.inserted} holidays for ${data.exchange} / ${data.year}.`,
      });
    },
    onError: (err: any) => {
      setConfirmReSync(false);
      toast({
        title: "Sync failed — please use CSV upload as backup",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Parse NSE-format CSV: "DD-MMM-YYYY,Description" or "Description,DD-MMM-YYYY"
  function parseNseCsv(text: string): { date: string; description: string }[] | null {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const rows: { date: string; description: string }[] = [];
    const months: Record<string, string> = {
      Jan:"01", Feb:"02", Mar:"03", Apr:"04", May:"05", Jun:"06",
      Jul:"07", Aug:"08", Sep:"09", Oct:"10", Nov:"11", Dec:"12",
    };
    for (const line of lines) {
      const parts = line.split(",").map(p => p.trim());
      if (parts.length < 2) continue;
      // Try each column as the date
      let dateStr = "";
      let desc = "";
      for (let i = 0; i < parts.length; i++) {
        const m = parts[i].match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
        if (m) {
          const month = months[m[2]] ?? months[m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase()];
          if (!month) continue;
          dateStr = `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
          desc = parts.filter((_, j) => j !== i).join(", ").trim();
          break;
        }
      }
      if (!dateStr) continue;
      rows.push({ date: dateStr, description: desc });
    }
    return rows.length > 0 ? rows : null;
  }

  function handleUpload() {
    if (!csvFile) {
      toast({ title: "No file selected", description: "Please choose a CSV file first.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseNseCsv(text);
      if (!rows) {
        setCsvParseError("Could not parse CSV. Expected format: DD-MMM-YYYY, Description");
        return;
      }
      setCsvParseError("");
      uploadHolidaysMutation.mutate({ year: parseInt(holidayYear), exchange: holidayExchange, rows });
    };
    reader.readAsText(csvFile);
  }

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <div className="space-y-6">
      {/* Card 1 — Exchange Trading Hours */}
      <Card>
        <CardHeader>
          <CardTitle>Exchange Trading Hours</CardTitle>
          <CardDescription>Configure market open/close times per exchange (IST). Changes take effect on the next monitor tick.</CardDescription>
        </CardHeader>
        <CardContent>
          {exchLoading ? (
            <div className="text-sm text-muted-foreground py-4">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Exchange</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Open Time (IST)</TableHead>
                  <TableHead>Close Time (IST)</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exchangeRows.map((row) => {
                  const edit = getExchangeEdit(row);
                  return (
                    <TableRow key={row.exchange}>
                      <TableCell className="font-mono font-medium">{row.exchange}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.displayName}</TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          value={edit.marketOpenTime}
                          onChange={e => setExchangeField(row.exchange, "marketOpenTime", e.target.value)}
                          className="w-32"
                          data-testid={`input-open-${row.exchange}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          value={edit.marketCloseTime}
                          onChange={e => setExchangeField(row.exchange, "marketCloseTime", e.target.value)}
                          className="w-32"
                          data-testid={`input-close-${row.exchange}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={edit.isActive}
                          onCheckedChange={val => setExchangeField(row.exchange, "isActive", val)}
                          data-testid={`switch-active-${row.exchange}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={saveExchangeMutation.isPending}
                          onClick={() => saveExchangeMutation.mutate({ exchange: row.exchange, data: edit })}
                          data-testid={`button-save-exchange-${row.exchange}`}
                        >
                          <Save className="w-3 h-3 mr-1" />
                          Save
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Card 2 — Index Expiry Days */}
      <Card>
        <CardHeader>
          <CardTitle>Index Expiry Days</CardTitle>
          <CardDescription>Default weekly expiry day per index. Used by the plan monitor for exitOnExpiry logic.</CardDescription>
        </CardHeader>
        <CardContent>
          {expiryLoading ? (
            <div className="text-sm text-muted-foreground py-4">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Index</TableHead>
                  <TableHead>Exchange</TableHead>
                  <TableHead>Default Expiry Day</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expiryRows.map((row) => (
                  <TableRow key={row.indexName}>
                    <TableCell className="font-mono font-medium">{row.indexName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.exchange}</TableCell>
                    <TableCell>
                      <Select
                        value={String(getExpiryDay(row))}
                        onValueChange={val => setExpiryEdits(prev => ({ ...prev, [row.indexName]: parseInt(val) }))}
                      >
                        <SelectTrigger className="w-40" data-testid={`select-expiry-${row.indexName}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1,2,3,4,5].map(d => (
                            <SelectItem key={d} value={String(d)}>{DAY_NAMES[d]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={saveExpiryMutation.isPending}
                        onClick={() => saveExpiryMutation.mutate({ indexName: row.indexName, defaultExpiryDay: getExpiryDay(row) })}
                        data-testid={`button-save-expiry-${row.indexName}`}
                      >
                        <Save className="w-3 h-3 mr-1" />
                        Save
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Card 3 — Holiday Calendar */}
      <Card>
        <CardHeader>
          <CardTitle>Holiday Calendar</CardTitle>
          <CardDescription>
            NSE/BSE holidays sync automatically from NSE. CSV upload is always available as backup. MCX holidays must always be uploaded manually.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Row 1 — Index tabs + Year selector */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1.5">
              {(["NSE", "BSE", "MCX"] as const).map((ex) => (
                <Button
                  key={ex}
                  size="sm"
                  variant={holidayExchange === ex ? "default" : "outline"}
                  onClick={() => { setHolidayExchange(ex); setConfirmReSync(false); }}
                  data-testid={`button-exchange-tab-${ex}`}
                >
                  {ex}
                </Button>
              ))}
            </div>
            <div className="ml-auto">
              <Select value={holidayYear} onValueChange={(v) => { setHolidayYear(v); setConfirmReSync(false); }}>
                <SelectTrigger className="w-24" data-testid="select-holiday-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 2 — All-index status strip */}
          {syncStatusAll && (
            <div className="flex flex-wrap gap-3 text-xs border border-border rounded-md px-3 py-2 bg-muted/20" data-testid="container-sync-status-all">
              {(["NSE", "BSE", "MCX"] as const).map((ex) => {
                const st = syncStatusAll[ex];
                const synced = st.count > 0;
                return (
                  <span key={ex} className={`flex items-center gap-1.5 ${synced ? "text-emerald-500" : "text-muted-foreground"}`} data-testid={`text-sync-status-${ex}`}>
                    <CalendarCheck className={`w-3 h-3 shrink-0 ${synced ? "text-emerald-500" : "text-muted-foreground/40"}`} />
                    <span className="font-medium">{ex}</span>
                    {synced
                      ? <span>{st.count} holidays{st.lastSyncedAt ? ` · ${new Date(st.lastSyncedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })}` : ""}</span>
                      : <span className="text-muted-foreground/60">— not synced</span>
                    }
                  </span>
                );
              })}
            </div>
          )}

          {/* Row 3 — Auto-sync row (hidden for MCX) */}
          {holidayExchange !== "MCX" && (() => {
            const alreadySynced = (syncStatusAll?.[holidayExchange as "NSE" | "BSE"]?.count ?? 0) > 0;
            return (
              <div className={`flex flex-wrap gap-3 items-center rounded-md border px-4 py-3 ${alreadySynced && !confirmReSync ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-muted/40"}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {alreadySynced && !confirmReSync ? `Already synced — ${syncStatusAll![holidayExchange as "NSE" | "BSE"].count} holidays saved` : `Sync from NSE`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {alreadySynced && !confirmReSync
                      ? "Clicking Re-Sync will overwrite the existing holiday list for this exchange and year."
                      : `Fetches the ${holidayYear} trading holiday list from NSE and saves it for ${holidayExchange}.`}
                  </p>
                </div>
                {alreadySynced && !confirmReSync ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-500/50 text-amber-500 hover:bg-amber-500/10"
                    onClick={() => setConfirmReSync(true)}
                    data-testid="button-confirm-resync"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Re-Sync
                  </Button>
                ) : (
                  <Button
                    onClick={() => syncHolidaysMutation.mutate({ year: parseInt(holidayYear), exchange: holidayExchange as "NSE" | "BSE" })}
                    disabled={syncHolidaysMutation.isPending}
                    variant={confirmReSync ? "destructive" : "default"}
                    data-testid="button-sync-holidays"
                  >
                    {syncHolidaysMutation.isPending
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Syncing…</>
                      : confirmReSync
                        ? <><RefreshCw className="w-4 h-4 mr-2" />Confirm Overwrite</>
                        : <><RefreshCw className="w-4 h-4 mr-2" />Sync Holidays</>}
                  </Button>
                )}
              </div>
            );
          })()}

          {/* Row 4 — CSV upload (always visible) */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {holidayExchange === "MCX" ? "CSV Upload (required for MCX)" : "CSV Upload (backup)"}
            </p>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-48">
                <Label className="text-xs mb-1 block">CSV File <span className="font-normal text-muted-foreground">(DD-MMM-YYYY, Description)</span></Label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={e => { setCsvFile(e.target.files?.[0] ?? null); setCsvParseError(""); }}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-border file:text-xs file:bg-muted file:text-foreground cursor-pointer"
                  data-testid="input-holiday-csv"
                />
              </div>
              <Button
                onClick={handleUpload}
                disabled={uploadHolidaysMutation.isPending || !csvFile}
                variant="outline"
                data-testid="button-upload-holidays"
              >
                <Upload className="w-4 h-4 mr-2" />
                {uploadHolidaysMutation.isPending ? "Uploading..." : "Upload CSV"}
              </Button>
            </div>
            {csvParseError && <p className="text-sm text-destructive">{csvParseError}</p>}
          </div>

          {/* Row 5 — Collapsible holiday table */}
          {holidayLoading ? (
            <div className="text-sm text-muted-foreground py-2">Loading holidays...</div>
          ) : holidayRows.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2 border border-dashed border-border rounded-md p-4 text-center">
              No holidays saved for {holidayExchange} {holidayYear}
            </div>
          ) : (
            <div className="border border-border rounded-md overflow-hidden">
              <button
                className="flex items-center justify-between w-full px-3 py-2 text-xs hover:bg-muted/30 transition-colors"
                onClick={() => setHolidayTableOpen(v => !v)}
                data-testid="button-toggle-holiday-table"
              >
                <span className="flex items-center gap-2 font-medium">
                  <CalendarCheck className="w-3.5 h-3.5 text-emerald-500" />
                  {holidayRows.length} holidays — {holidayExchange} {holidayYear}
                </span>
                <span className="text-muted-foreground">{holidayTableOpen ? "▲ hide" : "▼ show"}</span>
              </button>
              {holidayTableOpen && (
                <div className="border-t border-border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="py-1 text-xs">#</TableHead>
                        <TableHead className="py-1 text-xs">Date</TableHead>
                        <TableHead className="py-1 text-xs">Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {holidayRows.map((h, i) => (
                        <TableRow key={h.id} data-testid={`row-holiday-${h.id}`}>
                          <TableCell className="py-0.5 text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="py-0.5 text-xs font-mono">{h.date}</TableCell>
                          <TableCell className="py-0.5 text-xs">{h.description}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Settings() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  const navItems = [
    {
      id: "general" as const,
      label: "Trading Execution",
      icon: SettingsIcon,
    },
    {
      id: "mail" as const,
      label: "Mail API Settings",
      icon: Mail,
    },
    {
      id: "templates" as const,
      label: "Templates",
      icon: FileText,
    },
    {
      id: "retention" as const,
      label: "Data Retention",
      icon: Database,
    },
    {
      id: "error-routing" as const,
      label: "Error Routing",
      icon: ShieldAlert,
    },
    {
      id: "market-calendar" as const,
      label: "Market Calendar India",
      icon: CalendarDays,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <img src={mwLogo} alt="MentorsWorld" className="w-10 h-10 object-contain" />
                <div>
                  <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">
                    General Settings
                  </h1>
                  <p className="text-sm text-muted-foreground">Configure platform settings</p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-2">
            <PageBreadcrumbs items={[{ label: "Settings" }]} />
          </div>
        </div>
      </header>

      <div className="flex flex-col md:flex-row">
        <nav className="w-full md:w-64 border-b border-border md:border-b-0 md:border-r md:min-h-[calc(100vh-73px)] bg-card/30 p-4">
          <div className="flex flex-row flex-wrap gap-1 md:flex-col md:space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors md:w-full ${
                  activeSection === item.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover-elevate"
                }`}
                data-testid={`nav-${item.id}`}
              >
                <item.icon className="w-4 h-4" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <main className="flex-1 p-4 md:p-8">
          <div className="max-w-3xl">
            {activeSection === "general" && (
              <>
                <GeneralTradingSettings />
                <CapitalGatingStatus />
              </>
            )}
            {activeSection === "mail" && <MailApiSettings />}
            {activeSection === "templates" && <EmailTemplates />}
            {activeSection === "retention" && <DataRetentionSettings />}
            {activeSection === "error-routing" && <ErrorRoutingSettings />}
            {activeSection === "market-calendar" && <MarketCalendarSettings />}
          </div>
        </main>
      </div>
      <PageFooter />
    </div>
  );
}

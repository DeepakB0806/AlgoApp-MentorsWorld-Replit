import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  ArrowLeft, Mail, Key, CheckCircle, XCircle, 
  Eye, EyeOff, AlertTriangle, FileText, Settings as SettingsIcon
} from "lucide-react";
import { Link } from "wouter";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import mwLogo from "@/assets/images/mw-logo.png";

interface MailSettings {
  apiKeyConfigured: boolean;
  apiKeyLength: number;
  secretKeyConfigured: boolean;
  secretKeyLength: number;
  fromEmail: string;
  fromName: string;
}

type SettingsSection = "general" | "mail" | "templates";

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

function GeneralTradingSettings() {
  const [intervalValue, setIntervalValue] = useState<string>("");
  const { toast } = useToast();

  const { data: setting, isLoading } = useQuery<{ key: string; value: string | null }>({
    queryKey: ["/api/settings/squareoff_retry_interval_ms"],
  });

  useEffect(() => {
    if (setting?.value !== undefined && setting?.value !== null) {
      setIntervalValue(setting.value);
    } else if (!isLoading) {
      setIntervalValue("0");
    }
  }, [setting, isLoading]);

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

  return (
    <Card data-testid="card-general-trading-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon className="w-5 h-5" />
          Trading Execution
        </CardTitle>
        <CardDescription>
          Controls how the platform retries exit orders when a leg fails to close.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : (
          <div className="space-y-3">
            <Label htmlFor="input-squareoff-interval">
              Square-off Retry Interval (ms)
            </Label>
            <p className="text-sm text-muted-foreground">
              Delay between retry attempts after a failed exit order. Set to <strong>0</strong> for immediate retry — the broker API response time is the natural throttle. Increase only if the broker rejects rapid repeated orders.
            </p>
            <div className="flex items-center gap-3 max-w-xs">
              <Input
                id="input-squareoff-interval"
                data-testid="input-squareoff-interval"
                type="number"
                min="0"
                step="50"
                value={intervalValue}
                onChange={(e) => setIntervalValue(e.target.value)}
                placeholder="0"
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">ms</span>
            </div>
            <Button
              data-testid="button-save-squareoff-interval"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
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

      <div className="flex">
        <nav className="w-64 min-h-[calc(100vh-73px)] border-r border-border bg-card/30 p-4">
          <div className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${
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

        <main className="flex-1 p-8">
          <div className="max-w-3xl">
            {activeSection === "general" && <GeneralTradingSettings />}
            {activeSection === "mail" && <MailApiSettings />}
            {activeSection === "templates" && <EmailTemplates />}
          </div>
        </main>
      </div>
    </div>
  );
}

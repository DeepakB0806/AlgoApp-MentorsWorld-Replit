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
  Eye, EyeOff, AlertTriangle
} from "lucide-react";
import { Link } from "wouter";
import mwLogo from "@/assets/images/mw-logo.png";

interface MailSettings {
  apiKeyConfigured: boolean;
  apiKeyLength: number;
  secretKeyConfigured: boolean;
  secretKeyLength: number;
  fromEmail: string;
  fromName: string;
}

type SettingsSection = "mail";

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
export default function Settings() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("mail");

  const navItems = [
    {
      id: "mail" as const,
      label: "Mail API Settings",
      icon: Mail,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center gap-4">
            <div className="flex items-center gap-4">
              <Link href="/user-home">
                <Button variant="ghost" size="icon" data-testid="button-back-home">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
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
            {activeSection === "mail" && <MailApiSettings />}
          </div>
        </main>
      </div>
    </div>
  );
}

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
  Eye, EyeOff, AlertTriangle, FileText, ChevronDown, ChevronRight, 
  Webhook, GripVertical, Trash2, Plus, Save
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

interface FieldConfig {
  name: string;
  key: string;
  type: string;
  order: number;
}

interface WebhookTemplate {
  id: string;
  name: string;
  description: string | null;
  fieldConfig: string;
  defaultTriggerType: string;
  defaultIsActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type SettingsSection = "mail" | "webhook-template";

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

function WebhookTemplateSettings() {
  const { toast } = useToast();
  const [localFields, setLocalFields] = useState<FieldConfig[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const { data: template, isLoading } = useQuery<WebhookTemplate>({
    queryKey: ["/api/webhook-template"],
  });

  useEffect(() => {
    if (template?.fieldConfig && !initialized) {
      try {
        const parsed = JSON.parse(template.fieldConfig);
        setLocalFields(parsed);
        setInitialized(true);
      } catch {
        setLocalFields([]);
        setInitialized(true);
      }
    }
  }, [template, initialized]);

  const updateTemplateMutation = useMutation({
    mutationFn: async (data: { fieldConfig: string }) => {
      const res = await apiRequest("PATCH", `/api/webhook-template/${template?.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhook-template"] });
      setHasChanges(false);
      toast({
        title: "Template Updated",
        description: "Webhook template field configuration has been saved. All webhooks will now use this configuration.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Update Template",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const displayFields = localFields;

  const handleFieldChange = (index: number, field: string, value: string) => {
    const newFields = [...localFields];
    (newFields[index] as any)[field] = value;
    setLocalFields(newFields);
    setHasChanges(true);
  };

  const handleRemoveField = (index: number) => {
    const newFields = [...localFields];
    newFields.splice(index, 1);
    newFields.forEach((f, i) => f.order = i);
    setLocalFields(newFields);
    setHasChanges(true);
  };

  const handleAddField = () => {
    const newFields = [...localFields];
    const newField: FieldConfig = {
      name: "new_field",
      key: "new_field",
      type: "text",
      order: newFields.length,
    };
    newFields.push(newField);
    setLocalFields(newFields);
    setHasChanges(true);
  };

  const handleSave = () => {
    if (localFields.length === 0) {
      toast({
        title: "Cannot Save Empty Template",
        description: "Template must have at least one field configured.",
        variant: "destructive",
      });
      return;
    }
    updateTemplateMutation.mutate({
      fieldConfig: JSON.stringify(localFields),
    });
  };

  const handleMoveField = (index: number, direction: "up" | "down") => {
    const newFields = [...localFields];
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= newFields.length) return;
    
    [newFields[index], newFields[newIndex]] = [newFields[newIndex], newFields[index]];
    newFields.forEach((f, i) => f.order = i);
    setLocalFields(newFields);
    setHasChanges(true);
  };

  return (
    <Card data-testid="card-webhook-template">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="w-5 h-5" />
          Webhook Template Configuration
        </CardTitle>
        <CardDescription>
          Configure the master template for all webhooks. Changes here will apply to all existing and new webhooks.
          Fields define which data columns are displayed and tracked from TradingView alerts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading template...</div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Field Configuration</h3>
                <p className="text-xs text-muted-foreground">
                  {displayFields.length} fields configured
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddField}
                  data-testid="button-add-field"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Field
                </Button>
                {hasChanges && (
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={updateTemplateMutation.isPending}
                    data-testid="button-save-template"
                  >
                    <Save className="w-4 h-4 mr-1" />
                    {updateTemplateMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                )}
              </div>
            </div>

            <div className="border rounded-md">
              <div className="grid grid-cols-12 gap-2 p-3 bg-muted/50 border-b text-xs font-medium text-muted-foreground">
                <div className="col-span-1"></div>
                <div className="col-span-3">Display Name</div>
                <div className="col-span-4">Field Key (snake_case)</div>
                <div className="col-span-2">Type</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>
              <div className="divide-y max-h-[400px] overflow-y-auto">
                {displayFields.map((field, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 p-3 items-center hover:bg-muted/30">
                    <div className="col-span-1 flex items-center gap-1">
                      <GripVertical className="w-4 h-4 text-muted-foreground cursor-move" />
                      <div className="flex flex-col">
                        <button
                          onClick={() => handleMoveField(index, "up")}
                          disabled={index === 0}
                          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                          data-testid={`button-move-up-${index}`}
                        >
                          ▲
                        </button>
                        <button
                          onClick={() => handleMoveField(index, "down")}
                          disabled={index === displayFields.length - 1}
                          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                          data-testid={`button-move-down-${index}`}
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                    <div className="col-span-3">
                      <Input
                        value={field.name}
                        onChange={(e) => handleFieldChange(index, "name", e.target.value)}
                        className="h-8 text-sm"
                        data-testid={`input-field-name-${index}`}
                      />
                    </div>
                    <div className="col-span-4">
                      <Input
                        value={field.key}
                        onChange={(e) => handleFieldChange(index, "key", e.target.value)}
                        className="h-8 text-sm font-mono"
                        data-testid={`input-field-key-${index}`}
                      />
                    </div>
                    <div className="col-span-2">
                      <Badge variant="secondary" className="text-xs">
                        {field.type}
                      </Badge>
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveField(index)}
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        data-testid={`button-remove-field-${index}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {hasChanges && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3">
                <p className="text-sm text-yellow-600 dark:text-yellow-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  You have unsaved changes. Click "Save Changes" to apply them to all webhooks.
                </p>
              </div>
            )}

            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-2">Template Information</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Template Name:</span>
                  <span className="ml-2">{template?.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Last Updated:</span>
                  <span className="ml-2">{template?.updatedAt ? new Date(template.updatedAt).toLocaleString() : "Never"}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("mail");
  const [templatesExpanded, setTemplatesExpanded] = useState(false);

  const navItems = [
    {
      id: "mail" as const,
      label: "Mail API Settings",
      icon: Mail,
      isSubItem: false,
    },
    {
      id: "templates" as const,
      label: "Template Settings",
      icon: FileText,
      isSubItem: false,
      isExpandable: true,
      expanded: templatesExpanded,
      onToggle: () => setTemplatesExpanded(!templatesExpanded),
      children: [
        {
          id: "webhook-template" as const,
          label: "Webhook Template",
          icon: Webhook,
        },
      ],
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
              <div key={item.id}>
                {item.isExpandable ? (
                  <>
                    <button
                      onClick={item.onToggle}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm rounded-md hover-elevate transition-colors text-muted-foreground hover:text-foreground"
                      data-testid={`nav-${item.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <item.icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </div>
                      {item.expanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                    {item.expanded && item.children && (
                      <div className="ml-4 mt-1 space-y-1">
                        {item.children.map((child) => (
                          <button
                            key={child.id}
                            onClick={() => setActiveSection(child.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${
                              activeSection === child.id
                                ? "bg-primary/10 text-primary font-medium"
                                : "text-muted-foreground hover:text-foreground hover-elevate"
                            }`}
                            data-testid={`nav-${child.id}`}
                          >
                            <child.icon className="w-4 h-4" />
                            <span>{child.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => setActiveSection(item.id as SettingsSection)}
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
                )}
              </div>
            ))}
          </div>
        </nav>

        <main className="flex-1 p-8">
          <div className="max-w-3xl">
            {activeSection === "mail" && <MailApiSettings />}
            {activeSection === "webhook-template" && <WebhookTemplateSettings />}
          </div>
        </main>
      </div>
    </div>
  );
}

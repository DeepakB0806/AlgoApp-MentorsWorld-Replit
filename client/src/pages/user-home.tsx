import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, BarChart3, Activity, ArrowRight, Webhook, Key, Users, LogOut, LayoutDashboard, Cog, CheckCircle, XCircle } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import mwLogo from "@/assets/images/mw-logo.png";

interface BrokerConfig {
  id: string;
  brokerName: string;
  isConnected: boolean;
  lastConnected: string | null;
}

interface Strategy {
  id: string;
  name: string;
  isActive: boolean;
}

interface WebhookConfig {
  id: string;
  name: string;
  isActive: boolean;
}

interface WebhookData {
  id: string;
}

export default function UserHome() {
  const { user, isSuperAdmin, logout } = useAuth();

  const { data: brokerConfigs = [] } = useQuery<BrokerConfig[]>({
    queryKey: ["/api/broker-configs"],
  });

  const { data: strategies = [] } = useQuery<Strategy[]>({
    queryKey: ["/api/strategies"],
  });

  const { data: webhooks = [] } = useQuery<WebhookConfig[]>({
    queryKey: ["/api/webhooks"],
  });

  const { data: webhookData = [] } = useQuery<WebhookData[]>({
    queryKey: ["/api/webhook-data"],
  });

  const connectedBrokers = brokerConfigs.filter(b => b.isConnected);
  const activeStrategies = strategies.filter(s => s.isActive);
  const activeWebhooks = webhooks.filter(w => w.isActive);
  const firstName = user?.firstName || user?.email?.split('@')[0] || 'Trader';

  const formatBrokerName = (name: string) => {
    return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <img src={mwLogo} alt="MentorsWorld" className="w-10 h-10 object-contain" />
              <h1 className="text-lg font-bold text-foreground" data-testid="text-logo">
                MentorsWorld Algo Trading
              </h1>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-muted-foreground hidden sm:inline" data-testid="text-user-email">
                {user?.email}
              </span>
              <Button variant="outline" size="sm" onClick={logout} data-testid="button-logout">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12">
        <div className="mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-2" data-testid="text-welcome">
            Welcome back, {firstName}
          </h2>
          <p className="text-muted-foreground">
            Manage your trading strategies, webhooks, and broker connections
          </p>
        </div>

        <Card className="mb-8" data-testid="card-quick-stats">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Quick Stats
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-muted/50" data-testid="stat-brokers">
                <div className="text-xs text-muted-foreground mb-1.5">Brokers</div>
                {connectedBrokers.length > 0 ? (
                  <div className="space-y-1">
                    {connectedBrokers.map(b => (
                      <div key={b.id} className="flex items-center gap-1.5" data-testid={`text-broker-${b.id}`}>
                        <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="text-sm font-medium text-foreground truncate">{formatBrokerName(b.brokerName)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5" data-testid="text-broker-disconnected">
                    <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Not connected</span>
                  </div>
                )}
              </div>

              <div className="p-3 rounded-lg bg-muted/50" data-testid="stat-webhooks">
                <div className="text-xs text-muted-foreground mb-1.5">Webhooks</div>
                <div className="text-xl font-bold text-foreground" data-testid="text-webhooks-count">{webhooks.length}</div>
                <div className="text-xs text-muted-foreground">{activeWebhooks.length} active</div>
              </div>

              <div className="p-3 rounded-lg bg-muted/50" data-testid="stat-strategies">
                <div className="text-xs text-muted-foreground mb-1.5">Strategies</div>
                <div className="text-xl font-bold text-foreground" data-testid="text-strategies-count">{strategies.length}</div>
                <div className="text-xs text-muted-foreground">{activeStrategies.length} active</div>
              </div>

              <div className="p-3 rounded-lg bg-muted/50" data-testid="stat-alerts">
                <div className="text-xs text-muted-foreground mb-1.5">Alerts</div>
                <div className="text-xl font-bold text-foreground" data-testid="text-alerts-count">{webhookData.length}</div>
                <div className="text-xs text-muted-foreground">total received</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Link href="/dashboard">
            <Card className="hover-elevate cursor-pointer h-full" data-testid="card-link-dashboard">
              <CardHeader className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center">
                    <LayoutDashboard className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-sm flex items-center justify-between">
                      Dashboard
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      Positions, orders & trades
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/strategies">
            <Card className="hover-elevate cursor-pointer h-full" data-testid="card-link-strategies">
              <CardHeader className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-chart-2/20 flex items-center justify-center">
                    <BarChart3 className="w-4 h-4 text-chart-2" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-sm flex items-center justify-between">
                      Strategies
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      Manage trading strategies
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/webhooks">
            <Card className="hover-elevate cursor-pointer h-full" data-testid="card-link-webhooks">
              <CardHeader className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-chart-3/20 flex items-center justify-center">
                    <Webhook className="w-4 h-4 text-chart-3" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-sm flex items-center justify-between">
                      Webhooks
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      TradingView alerts config
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/broker-api">
            <Card className="hover-elevate cursor-pointer h-full" data-testid="card-link-broker">
              <CardHeader className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-chart-4/20 flex items-center justify-center">
                    <Key className="w-4 h-4 text-chart-4" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-sm flex items-center justify-between">
                      Broker API
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      Kotak Neo credentials
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Link>
        </div>


        {isSuperAdmin && (
          <div className="mt-6">
            <h3 className="text-base font-semibold text-foreground mb-3">Admin Settings</h3>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Link href="/settings">
                <Card className="hover-elevate cursor-pointer h-full" data-testid="card-link-settings">
                  <CardHeader className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-orange-500/20 flex items-center justify-center">
                        <Cog className="w-4 h-4 text-orange-500" />
                      </div>
                      <div className="flex-1">
                        <CardTitle className="text-sm flex items-center justify-between">
                          Other General Settings
                          <ArrowRight className="w-4 h-4 text-muted-foreground" />
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">
                          Mail API config
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
              <Link href="/user-management">
                <Card className="hover-elevate cursor-pointer h-full" data-testid="card-link-user-management">
                  <CardHeader className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center">
                        <Users className="w-4 h-4 text-blue-500" />
                      </div>
                      <div className="flex-1">
                        <CardTitle className="text-sm flex items-center justify-between">
                          User Management
                          <ArrowRight className="w-4 h-4 text-muted-foreground" />
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">
                          Team & invitations
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            </div>
          </div>
        )}
      </div>

      <footer className="border-t border-border py-8 mt-auto">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              <span className="font-semibold text-foreground">MentorsWorld Algo Trading</span>
            </div>
            <p className="text-muted-foreground text-sm" data-testid="text-footer">
              Automated Trading Made Simple
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

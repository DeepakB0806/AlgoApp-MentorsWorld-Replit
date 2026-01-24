import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, BarChart3, Activity, ArrowRight, Webhook, Key, Users, LogOut, LayoutDashboard, Settings } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import mwLogo from "@/assets/images/mw-logo.png";

export default function UserHome() {
  const { user, isSuperAdmin, logout } = useAuth();

  const firstName = user?.firstName || user?.email?.split('@')[0] || 'Trader';

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
              {isSuperAdmin && (
                <Link href="/user-management">
                  <Button variant="outline" size="sm" data-testid="button-user-management">
                    <Users className="w-4 h-4 mr-2" />
                    Team
                  </Button>
                </Link>
              )}
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

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <Link href="/dashboard">
            <Card className="hover-elevate cursor-pointer h-full" data-testid="card-link-dashboard">
              <CardHeader>
                <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center mb-4">
                  <LayoutDashboard className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="flex items-center justify-between gap-2">
                  Dashboard
                  <ArrowRight className="w-5 h-5 text-muted-foreground" />
                </CardTitle>
                <CardDescription>
                  View live positions, orders, holdings, and place trades
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/strategies">
            <Card className="hover-elevate cursor-pointer h-full" data-testid="card-link-strategies">
              <CardHeader>
                <div className="w-12 h-12 rounded-xl bg-chart-2/20 flex items-center justify-center mb-4">
                  <BarChart3 className="w-6 h-6 text-chart-2" />
                </div>
                <CardTitle className="flex items-center justify-between gap-2">
                  Strategies
                  <ArrowRight className="w-5 h-5 text-muted-foreground" />
                </CardTitle>
                <CardDescription>
                  Create and manage your automated trading strategies
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/webhooks">
            <Card className="hover-elevate cursor-pointer h-full" data-testid="card-link-webhooks">
              <CardHeader>
                <div className="w-12 h-12 rounded-xl bg-chart-3/20 flex items-center justify-center mb-4">
                  <Webhook className="w-6 h-6 text-chart-3" />
                </div>
                <CardTitle className="flex items-center justify-between gap-2">
                  Webhooks
                  <ArrowRight className="w-5 h-5 text-muted-foreground" />
                </CardTitle>
                <CardDescription>
                  Configure webhooks for TradingView alerts
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/broker-api">
            <Card className="hover-elevate cursor-pointer h-full" data-testid="card-link-broker">
              <CardHeader>
                <div className="w-12 h-12 rounded-xl bg-chart-4/20 flex items-center justify-center mb-4">
                  <Key className="w-6 h-6 text-chart-4" />
                </div>
                <CardTitle className="flex items-center justify-between gap-2">
                  Broker API
                  <ArrowRight className="w-5 h-5 text-muted-foreground" />
                </CardTitle>
                <CardDescription>
                  Manage Kotak Neo API credentials and connections
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <Card className="col-span-2" data-testid="card-quick-stats">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-foreground">--</div>
                  <div className="text-sm text-muted-foreground">Active Strategies</div>
                </div>
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-foreground">--</div>
                  <div className="text-sm text-muted-foreground">Webhooks</div>
                </div>
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-foreground">--</div>
                  <div className="text-sm text-muted-foreground">Today's Alerts</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-broker-status">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-chart-4" />
                Broker Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
                <div className="w-3 h-3 rounded-full bg-muted-foreground animate-pulse" />
                <div>
                  <div className="font-medium text-foreground">Not Connected</div>
                  <div className="text-sm text-muted-foreground">Configure in Broker API</div>
                </div>
              </div>
              <Link href="/broker-api">
                <Button variant="outline" className="w-full mt-4" data-testid="button-connect-broker">
                  Connect Broker
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
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

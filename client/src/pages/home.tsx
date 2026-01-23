import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, BarChart3, Activity, ArrowRight, Zap, Shield, Globe, LogIn, Users, LogOut } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";

export default function Home() {
  const { user, isAuthenticated, isSuperAdmin, logout } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center gap-4">
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-logo">
              AlgoTrading Platform
            </h1>
            <div className="flex items-center gap-3 flex-wrap">
              {isAuthenticated ? (
                <>
                  {isSuperAdmin && (
                    <Link href="/user-management">
                      <Button variant="outline" data-testid="button-user-management">
                        <Users className="w-4 h-4 mr-2" />
                        Team
                      </Button>
                    </Link>
                  )}
                  <span className="text-sm text-muted-foreground" data-testid="text-user-email">
                    {user?.email}
                  </span>
                  <Button variant="outline" onClick={logout} data-testid="button-logout">
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </Button>
                  <Link href="/dashboard">
                    <Button data-testid="button-dashboard">
                      Dashboard
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/login">
                    <Button variant="outline" data-testid="button-login">
                      <LogIn className="w-4 h-4 mr-2" />
                      Sign In
                    </Button>
                  </Link>
                  <Link href="/dashboard">
                    <Button data-testid="button-dashboard">
                      Dashboard
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12">
        <div className="text-center mb-16">
          <h2 className="text-5xl font-bold text-foreground mb-4" data-testid="text-hero-title">
            Automated Trading Made Simple
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8" data-testid="text-hero-description">
            Create, backtest, and deploy trading strategies with our powerful algorithmic trading platform
          </p>
          <Link href="/dashboard">
            <Button size="lg" data-testid="button-get-started">
              Get Started
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-16">
          <Card className="hover-elevate" data-testid="card-feature-strategy">
            <CardHeader>
              <TrendingUp className="w-12 h-12 text-primary mb-4" />
              <CardTitle>Strategy Builder</CardTitle>
              <CardDescription>
                Create custom trading strategies with our intuitive interface
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="hover-elevate" data-testid="card-feature-backtest">
            <CardHeader>
              <BarChart3 className="w-12 h-12 text-chart-2 mb-4" />
              <CardTitle>Backtesting</CardTitle>
              <CardDescription>
                Test your strategies with historical data before going live
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="hover-elevate" data-testid="card-feature-live">
            <CardHeader>
              <Activity className="w-12 h-12 text-chart-3 mb-4" />
              <CardTitle>Live Trading</CardTitle>
              <CardDescription>
                Execute trades automatically with integrated broker APIs
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-16">
          <Card className="hover-elevate" data-testid="card-feature-fast">
            <CardHeader>
              <Zap className="w-12 h-12 text-chart-4 mb-4" />
              <CardTitle>Lightning Fast</CardTitle>
              <CardDescription>
                Execute trades in milliseconds with low-latency infrastructure
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="hover-elevate" data-testid="card-feature-secure">
            <CardHeader>
              <Shield className="w-12 h-12 text-chart-1 mb-4" />
              <CardTitle>Secure</CardTitle>
              <CardDescription>
                Bank-grade encryption and security for your trading data
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="hover-elevate" data-testid="card-feature-global">
            <CardHeader>
              <Globe className="w-12 h-12 text-chart-5 mb-4" />
              <CardTitle>Multi-Exchange</CardTitle>
              <CardDescription>
                Connect to NSE, BSE, and F&O segments seamlessly
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          <Link href="/strategies">
            <Card className="hover-elevate cursor-pointer h-full" data-testid="card-link-strategies">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">Strategies</h3>
                    <p className="text-muted-foreground text-sm">Manage trading strategies</p>
                  </div>
                  <ArrowRight className="text-primary w-6 h-6 flex-shrink-0" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/dashboard">
            <Card className="hover-elevate cursor-pointer h-full" data-testid="card-link-dashboard">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">Dashboard</h3>
                    <p className="text-muted-foreground text-sm">View live trading</p>
                  </div>
                  <ArrowRight className="text-chart-2 w-6 h-6 flex-shrink-0" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/webhooks">
            <Card className="hover-elevate cursor-pointer h-full" data-testid="card-link-webhooks">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">Webhooks</h3>
                    <p className="text-muted-foreground text-sm">Configure webhooks</p>
                  </div>
                  <ArrowRight className="text-chart-3 w-6 h-6 flex-shrink-0" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/broker-api">
            <Card className="hover-elevate cursor-pointer h-full" data-testid="card-link-broker">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">Broker API</h3>
                    <p className="text-muted-foreground text-sm">Manage credentials</p>
                  </div>
                  <ArrowRight className="text-chart-4 w-6 h-6 flex-shrink-0" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      <footer className="border-t border-border py-8 mt-16">
        <div className="container mx-auto px-4 text-center text-muted-foreground">
          <p data-testid="text-footer">AlgoTrading Platform - Automated Trading Made Simple</p>
        </div>
      </footer>
    </div>
  );
}

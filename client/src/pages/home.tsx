      import { Button } from "@/components/ui/button";
      import { TrendingUp, BarChart3, Activity, ArrowRight, Zap, Shield, Globe, LogIn, CheckCircle2, Bot, LineChart, Bell } from "lucide-react";
      import { Link } from "wouter";
      import { useAuth } from "@/hooks/use-auth";
      import { useEffect } from "react";
      import { useLocation } from "wouter";

      export default function Home() {
        const { isAuthenticated, isLoading } = useAuth();
        const [, setLocation] = useLocation();

        useEffect(() => {
          if (!isLoading && isAuthenticated) {
            setLocation("/user-home");
          }
        }, [isAuthenticated, isLoading, setLocation]);

        if (isLoading) {
          return (
            <div className="min-h-screen bg-background flex items-center justify-center">
              <div className="animate-pulse text-muted-foreground">Loading...</div>
            </div>
          );
        }

        return (
          <div className="min-h-screen bg-background">
            <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
              <div className="container mx-auto px-4 py-4">
                <div className="flex justify-between items-center gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                      <TrendingUp className="w-6 h-6 text-primary" />
                    </div>
                    <h1 className="text-lg font-bold text-foreground" data-testid="text-logo">
                      MentorsWorld AlgoTrading Platform
                    </h1>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link href="/login">
                      <Button variant="outline" data-testid="button-login">
                        <LogIn className="w-4 h-4 mr-2" />
                        Sign In
                      </Button>
                    </Link>
                    <Link href="/login">
                      <Button data-testid="button-get-started-header">
                        Get Started
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </header>

            <section className="relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-chart-2/10" />
              <div className="absolute top-20 left-10 w-72 h-72 bg-primary/20 rounded-full blur-3xl" />
              <div className="absolute bottom-20 right-10 w-96 h-96 bg-chart-2/20 rounded-full blur-3xl" />

              <div className="container mx-auto px-4 py-24 relative">
                <div className="max-w-4xl mx-auto text-center">
                  <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-2 mb-8">
                    <Zap className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-primary">Powered by Live Market Alerts</span>
                  </div>

                  <h2 className="text-5xl md:text-7xl font-bold text-foreground mb-6 leading-tight" data-testid="text-hero-title">
                    Automated
                    <span className="block text-primary">Trading Strategy</span>
                  </h2>

                  <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto mb-10" data-testid="text-hero-description">
                    Ready Strategies Deployed, You only subscribe.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <Link href="/login">
                      <Button size="lg" data-testid="button-get-started">
                        Start Trading Automatically
                        <ArrowRight className="ml-2 h-5 w-5" />
                      </Button>
                    </Link>
                    <a href="#how-it-works">
                      <Button size="lg" variant="outline" data-testid="button-learn-more">
                        Learn How It Works
                      </Button>
                    </a>
                  </div>

                  <div className="flex flex-wrap justify-center gap-8 mt-12 text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-primary" />
                      <span>No Coding Required</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-primary" />
                      <span>Kotak Neo Integration</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-primary" />
                      <span>Real-time Execution under 50ms</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section id="how-it-works" className="py-24 bg-card/30 scroll-mt-20">
              <div className="container mx-auto px-4">
                <div className="text-center mb-16">
                  <h3 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                    How It Works
                  </h3>
                  <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                    Enrol & Subscribe
                  </p>
                </div>

                <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                  <div className="text-center p-8">
                    <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-6">
                      <Bell className="w-8 h-8 text-primary" />
                    </div>
                    <div className="text-sm font-medium text-primary mb-2">Step 1</div>
                    <h4 className="text-xl font-semibold text-foreground mb-3">Security Setup</h4>
                    <p className="text-muted-foreground">
                      Generate Trade API code from Kotak Neo panel of Yours
                    </p>
                  </div>

                  <div className="text-center p-8">
                    <div className="w-16 h-16 rounded-2xl bg-chart-2/20 flex items-center justify-center mx-auto mb-6">
                      <LineChart className="w-8 h-8 text-chart-2" />
                    </div>
                    <div className="text-sm font-medium text-chart-2 mb-2">Step 2</div>
                    <h4 className="text-xl font-semibold text-foreground mb-3">Defined Strategies</h4>
                    <p className="text-muted-foreground">
                      Pre-configured trading rules, position sizes, and risk parameters for every strategy
                    </p>
                  </div>

                  <div className="text-center p-8">
                    <div className="w-16 h-16 rounded-2xl bg-chart-3/20 flex items-center justify-center mx-auto mb-6">
                      <Bot className="w-8 h-8 text-chart-3" />
                    </div>
                    <div className="text-sm font-medium text-chart-3 mb-2">Step 3</div>
                    <h4 className="text-xl font-semibold text-foreground mb-3">Auto-Execute</h4>
                    <p className="text-muted-foreground">
                      Trades execute automatically through Kotak Neo API
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="py-24">
              <div className="container mx-auto px-4">
                <div className="text-center mb-16">
                  <h3 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                    Why Choose AlgoTrading
                  </h3>
                  <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                    Built for serious traders who want reliable automation
                  </p>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
                  <div className="p-6 rounded-xl border border-border bg-card/50 hover-elevate">
                    <Zap className="w-10 h-10 text-chart-4 mb-4" />
                    <h4 className="text-lg font-semibold text-foreground mb-2">Lightning Fast</h4>
                    <p className="text-muted-foreground text-sm">
                      Execute trades in milliseconds with low-latency infrastructure optimized for speed
                    </p>
                  </div>

                  <div className="p-6 rounded-xl border border-border bg-card/50 hover-elevate">
                    <Shield className="w-10 h-10 text-chart-1 mb-4" />
                    <h4 className="text-lg font-semibold text-foreground mb-2">Bank-Grade Security</h4>
                    <p className="text-muted-foreground text-sm">
                      Your credentials are encrypted and API keys never leave our secure servers
                    </p>
                  </div>

                  <div className="p-6 rounded-xl border border-border bg-card/50 hover-elevate">
                    <Globe className="w-10 h-10 text-chart-5 mb-4" />
                    <h4 className="text-lg font-semibold text-foreground mb-2">Multi-Segment</h4>
                    <p className="text-muted-foreground text-sm">
                      Trade NSE, BSE equity and F&O segments seamlessly from one platform
                    </p>
                  </div>

                  <div className="p-6 rounded-xl border border-border bg-card/50 hover-elevate">
                    <BarChart3 className="w-10 h-10 text-chart-2 mb-4" />
                    <h4 className="text-lg font-semibold text-foreground mb-2">Real-time Dashboard</h4>
                    <p className="text-muted-foreground text-sm">
                      Monitor positions, orders, and P&L with live updates from your broker
                    </p>
                  </div>

                  <div className="p-6 rounded-xl border border-border bg-card/50 hover-elevate">
                    <Activity className="w-10 h-10 text-chart-3 mb-4" />
                    <h4 className="text-lg font-semibold text-foreground mb-2">Audit Trail</h4>
                    <p className="text-muted-foreground text-sm">
                      Complete audit trail of every day profit & loss
                    </p>
                  </div>

                  <div className="p-6 rounded-xl border border-border bg-card/50 hover-elevate">
                    <TrendingUp className="w-10 h-10 text-primary mb-4" />
                    <h4 className="text-lg font-semibold text-foreground mb-2">TradingView Ready</h4>
                    <p className="text-muted-foreground text-sm">
                      Native support for TradingView alert format with 19 configurable fields
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="py-24 bg-card/30">
              <div className="container mx-auto px-4">
                <div className="max-w-3xl mx-auto text-center">
                  <h3 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                    Ready to Automate Your Trading?
                  </h3>
                  <p className="text-lg text-muted-foreground mb-10">
                    Join traders who have automated their TradingView strategies with our platform
                  </p>
                  <Link href="/login">
                    <Button size="lg" data-testid="button-cta-bottom">
                      Get Started Now
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </Button>
                  </Link>
                </div>
              </div>
            </section>

            <footer className="border-t border-border py-8">
              <div className="container mx-auto px-4">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 text-primary" />
                    </div>
                    <span className="font-semibold text-foreground">Copyright @ MentorsWorld Ventures Pvt. Ltd.</span>
                  </div>
                  <p className="text-muted-foreground text-sm" data-testid="text-footer">
                    Automated Trading Made Simple, Seamless, Secured, & Profitable
                  </p>
                </div>
              </div>
            </footer>
          </div>
        );
      }

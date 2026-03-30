import { lazy, Suspense, Component, type ReactNode } from "react";
import { Switch, Route } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, ProtectedRoute } from "@/hooks/use-auth";
import { Loader2, AlertTriangle, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

import Home from "@/pages/home";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background" data-testid="error-boundary">
          <div className="max-w-md text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">{this.state.error?.message}</p>
            <Button
              variant="default"
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              data-testid="button-reload"
            >
              Reload Page
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const UserHome = lazy(() => import("@/pages/user-home"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Strategies = lazy(() => import("@/pages/strategies"));
const Webhooks = lazy(() => import("@/pages/webhooks"));
const BrokerApi = lazy(() => import("@/pages/broker-api"));
const Register = lazy(() => import("@/pages/register"));
const Signup = lazy(() => import("@/pages/signup"));
const TotpSetup = lazy(() => import("@/pages/totp-setup"));
const UserManagement = lazy(() => import("@/pages/user-management"));
const Settings = lazy(() => import("@/pages/settings"));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background" data-testid="page-loader">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/login" component={Login} />
        <Route path="/signup">
          <Signup />
        </Route>
        <Route path="/register">
          <Register />
        </Route>
        <Route path="/totp-setup">
          <TotpSetup />
        </Route>
        
        <Route path="/user-home">
          <ProtectedRoute allowedRoles={["super_admin", "team_member", "customer"]}>
            <UserHome />
          </ProtectedRoute>
        </Route>
        <Route path="/dashboard">
          <ProtectedRoute allowedRoles={["super_admin", "team_member", "customer"]}>
            <Dashboard />
          </ProtectedRoute>
        </Route>
        <Route path="/strategies">
          <ProtectedRoute allowedRoles={["super_admin", "team_member"]}>
            <Strategies />
          </ProtectedRoute>
        </Route>
        <Route path="/webhooks">
          <ProtectedRoute allowedRoles={["super_admin", "team_member"]}>
            <Webhooks />
          </ProtectedRoute>
        </Route>
        <Route path="/broker-api">
          <ProtectedRoute allowedRoles={["super_admin", "team_member", "customer"]}>
            <BrokerApi />
          </ProtectedRoute>
        </Route>
        
        <Route path="/user-management">
          <ProtectedRoute requiredRole="super_admin">
            <UserManagement />
          </ProtectedRoute>
        </Route>
        <Route path="/settings">
          <ProtectedRoute requiredRole="super_admin">
            <Settings />
          </ProtectedRoute>
        </Route>
        
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function TradingHaltBanner() {
  const { data } = useQuery<{ key: string; value: string } | null>({
    queryKey: ["/api/settings/trading_halted"],
    refetchInterval: 15000,
    retry: false,
  });

  const resumeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/settings/resume-trading"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/trading_halted"] });
    },
  });

  if (data?.value !== "true") return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white px-4 py-3 flex items-center justify-between gap-4 shadow-lg"
      data-testid="banner-trading-halted"
    >
      <div className="flex items-center gap-3 min-w-0">
        <ShieldX className="h-5 w-5 shrink-0" />
        <span className="text-sm font-semibold truncate">
          CRITICAL: Trading Halted — Broker Auth/Session Error. Re-login to Kotak Neo and click Resume.
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 bg-white text-red-700 hover:bg-red-50 border-white font-semibold"
        onClick={() => resumeMutation.mutate()}
        disabled={resumeMutation.isPending}
        data-testid="button-resume-trading"
      >
        {resumeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Resume Trading"}
      </Button>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <TradingHaltBanner />
            <Toaster />
            <Router />
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;

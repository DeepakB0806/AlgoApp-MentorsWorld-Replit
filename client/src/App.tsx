import { lazy, Suspense, Component, type ReactNode } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, ProtectedRoute } from "@/hooks/use-auth";
import { Loader2, AlertTriangle } from "lucide-react";
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

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <Toaster />
            <Router />
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;

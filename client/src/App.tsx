import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, ProtectedRoute } from "@/hooks/use-auth";
import Home from "@/pages/home";
import UserHome from "@/pages/user-home";
import Dashboard from "@/pages/dashboard";
import Strategies from "@/pages/strategies";
import Webhooks from "@/pages/webhooks";
import BrokerApi from "@/pages/broker-api";
import Login from "@/pages/login";
import Register from "@/pages/register";
import Signup from "@/pages/signup";
import TotpSetup from "@/pages/totp-setup";
import UserManagement from "@/pages/user-management";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/register" component={Register} />
      <Route path="/totp-setup" component={TotpSetup} />
      
      {/* Protected routes - require authentication */}
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
      
      {/* Super Admin only */}
      <Route path="/user-management">
        <ProtectedRoute requiredRole="super_admin">
          <UserManagement />
        </ProtectedRoute>
      </Route>
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Router />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

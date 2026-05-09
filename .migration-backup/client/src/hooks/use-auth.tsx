import { createContext, useContext, ReactNode, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "../lib/queryClient";

interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: "super_admin" | "team_member" | "customer";
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isTeamMember: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // Query for authenticated user (supports both Replit Auth and team member sessions)
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 60000, // Cache for 1 minute
  });

  const isAuthenticated = !!user;
  const isSuperAdmin = user?.role === "super_admin";
  const isTeamMember = user?.role === "team_member";

  const logout = async () => {
    try {
      // Try team logout first (clears cookie)
      await apiRequest("POST", "/api/auth/team/logout");
    } catch (e) {
      // Ignore errors, continue with logout
    }
    
    // Clear query cache
    queryClient.clear();
    
    // Redirect to login or Replit logout
    window.location.href = "/api/logout";
  };

  return (
    <AuthContext.Provider value={{
      user: user ?? null,
      isLoading,
      isAuthenticated,
      isSuperAdmin,
      isTeamMember,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Protected route component
interface ProtectedRouteProps {
  children: ReactNode;
  requiredRole?: "super_admin" | "team_member" | "customer";
  allowedRoles?: ("super_admin" | "team_member" | "customer")[];
}

export function ProtectedRoute({ children, requiredRole, allowedRoles }: ProtectedRouteProps) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      navigate("/login");
      return;
    }

    if (requiredRole && user?.role !== requiredRole) {
      navigate("/");
      return;
    }

    if (allowedRoles && !allowedRoles.includes(user?.role!)) {
      navigate("/");
      return;
    }
  }, [isLoading, isAuthenticated, user, requiredRole, allowedRoles, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (requiredRole && user?.role !== requiredRole) {
    return null;
  }

  if (allowedRoles && !allowedRoles.includes(user?.role!)) {
    return null;
  }

  return <>{children}</>;
}

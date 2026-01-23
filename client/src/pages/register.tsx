import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Lock, UserPlus, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function Register() {
  const [token, setToken] = useState("");
  const [invitation, setInvitation] = useState<{ email: string; role: string } | null>(null);
  const [invitationError, setInvitationError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingToken, setIsCheckingToken] = useState(true);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get("token");
    
    if (inviteToken) {
      setToken(inviteToken);
      checkInvitation(inviteToken);
    } else {
      setIsCheckingToken(false);
      setInvitationError("No invitation token provided");
    }
  }, []);

  const checkInvitation = async (inviteToken: string) => {
    try {
      const res = await fetch(`/api/auth/invitations/check/${inviteToken}`);
      const data = await res.json();

      if (!res.ok || !data.valid) {
        setInvitationError(data.message || "Invalid invitation");
      } else {
        setInvitation({ email: data.email, role: data.role });
      }
    } catch (error) {
      setInvitationError("Failed to verify invitation");
    } finally {
      setIsCheckingToken(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        title: "Error",
        description: "Passwords do not match",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 8) {
      toast({
        title: "Error",
        description: "Password must be at least 8 characters",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/team/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Registration failed");
      }

      toast({
        title: "Registration Successful",
        description: "Your account has been created. Please check your email for verification.",
      });

      // For now, skip email verification and go to TOTP setup
      navigate(`/totp-setup?userId=${data.userId}`);
    } catch (error: any) {
      toast({
        title: "Registration Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isCheckingToken) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Verifying invitation...</p>
        </div>
      </div>
    );
  }

  if (invitationError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="w-5 h-5" />
              Invalid Invitation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{invitationError}</AlertDescription>
            </Alert>
            <Button
              className="w-full mt-4"
              onClick={() => navigate("/")}
              data-testid="button-go-home"
            >
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground" data-testid="text-register-title">
            AlgoTrading Platform
          </h1>
          <p className="text-muted-foreground mt-2">Complete Your Registration</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Create Your Account
            </CardTitle>
            <CardDescription>
              You've been invited to join as a {invitation?.role?.replace("_", " ")}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className="mb-6 p-3 bg-muted rounded-lg flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-primary" />
              <div>
                <p className="text-sm font-medium">{invitation?.email}</p>
                <p className="text-xs text-muted-foreground">Verified invitation</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="Create a strong password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                    required
                    minLength={8}
                    data-testid="input-password"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Minimum 8 characters
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10"
                    required
                    data-testid="input-confirm-password"
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
                data-testid="button-register"
              >
                {isLoading ? "Creating Account..." : "Create Account"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

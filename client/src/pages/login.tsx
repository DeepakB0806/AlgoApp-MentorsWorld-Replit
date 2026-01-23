import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Lock, Mail, Shield, LogIn, ArrowRight } from "lucide-react";

type LoginStep = "credentials" | "totp";

export default function Login() {
  const [step, setStep] = useState<LoginStep>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [userId, setUserId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/team/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Login failed");
      }

      if (data.requiresTotpSetup) {
        navigate(`/totp-setup?userId=${data.userId}`);
        return;
      }

      if (data.requiresTotp) {
        setUserId(data.userId);
        setStep("totp");
        toast({
          title: "Verification Required",
          description: "Please enter your TOTP code from your authenticator app.",
        });
      } else {
        toast({
          title: "Login Successful",
          description: "Welcome back!",
        });
        navigate("/dashboard");
      }
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/team/verify-totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, code: totpCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Verification failed");
      }

      toast({
        title: "Login Successful",
        description: `Welcome back, ${data.user.firstName || data.user.email}!`,
      });
      
      // Session is now stored in HTTP-only cookie by the server
      // Just navigate to dashboard
      window.location.href = "/dashboard"; // Full reload to refresh auth state
    } catch (error: any) {
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive",
      });
      setTotpCode("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground" data-testid="text-login-title">
            AlgoTrading Platform
          </h1>
          <p className="text-muted-foreground mt-2">Team Member Login</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {step === "credentials" ? (
                <>
                  <LogIn className="w-5 h-5" />
                  Sign In
                </>
              ) : (
                <>
                  <Shield className="w-5 h-5" />
                  Two-Factor Authentication
                </>
              )}
            </CardTitle>
            <CardDescription>
              {step === "credentials"
                ? "Enter your credentials to access the platform"
                : "Enter the 6-digit code from your authenticator app"}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {step === "credentials" ? (
              <form onSubmit={handleCredentialsSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="team@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      required
                      data-testid="input-email"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10"
                      required
                      data-testid="input-password"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading}
                  data-testid="button-login"
                >
                  {isLoading ? "Signing in..." : "Sign In"}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </form>
            ) : (
              <form onSubmit={handleTotpSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="totp">Verification Code</Label>
                  <Input
                    id="totp"
                    type="text"
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="text-center text-2xl tracking-widest"
                    maxLength={6}
                    required
                    autoFocus
                    data-testid="input-totp"
                  />
                  <p className="text-xs text-muted-foreground text-center">
                    Open your authenticator app and enter the 6-digit code
                  </p>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading || totpCode.length !== 6}
                  data-testid="button-verify-totp"
                >
                  {isLoading ? "Verifying..." : "Verify & Sign In"}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setStep("credentials");
                    setTotpCode("");
                  }}
                  data-testid="button-back"
                >
                  Back to Sign In
                </Button>
              </form>
            )}
          </CardContent>

          <CardFooter className="flex flex-col gap-4">
            <div className="relative w-full">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => window.location.href = "/api/login"}
              data-testid="button-replit-login"
            >
              Sign in with Replit (Super Admin)
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

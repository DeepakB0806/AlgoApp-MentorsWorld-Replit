import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { Lock, Mail, Shield, LogIn, ArrowRight, TrendingUp, RefreshCw, AlertCircle, Eye, EyeOff, Key } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import mwLogo from "@/assets/images/mw-logo.png";

type LoginStep = "credentials" | "totp" | "backup-code" | "verify-email";

export default function Login() {
  const [step, setStep] = useState<LoginStep>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [userId, setUserId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const { toast } = useToast();
  const [location, navigate] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "true") {
      toast({
        title: "Email Verified",
        description: "Your email has been verified. You are now logged in!",
      });
    }
    if (params.get("error") === "invalid_token") {
      toast({
        title: "Invalid Link",
        description: "The verification link is invalid or has been used.",
        variant: "destructive",
      });
    }
    if (params.get("error") === "token_expired") {
      toast({
        title: "Link Expired",
        description: "The verification link has expired. Please request a new one.",
        variant: "destructive",
      });
    }
  }, []);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/customer/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.requiresEmailVerification) {
          setStep("verify-email");
          return;
        }
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
      } else if (data.success) {
        toast({
          title: "Login Successful",
          description: `Welcome back, ${data.user.firstName || data.user.email}!`,
        });
        window.location.href = "/user-home";
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
        credentials: "include",
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
      
      window.location.href = "/user-home";
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

  const handleBackupCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/team/verify-backup-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId, code: backupCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Verification failed");
      }

      toast({
        title: "Login Successful",
        description: data.remainingCodes !== undefined 
          ? `Welcome back! You have ${data.remainingCodes} backup codes remaining.`
          : `Welcome back, ${data.user.firstName || data.user.email}!`,
      });
      
      window.location.href = "/user-home";
    } catch (error: any) {
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive",
      });
      setBackupCode("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendEmail = async () => {
    setResendingEmail(true);
    try {
      await apiRequest("POST", "/api/auth/resend-verification", { email });
      
      toast({
        title: "Email Sent",
        description: "A new verification email has been sent. Please check your inbox.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to Resend",
        description: error.message || "Could not resend verification email",
        variant: "destructive",
      });
    } finally {
      setResendingEmail(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/">
            <div className="inline-flex items-center gap-3 cursor-pointer">
              <img src={mwLogo} alt="MentorsWorld" className="w-10 h-10 object-contain" />
              <h1 className="text-lg font-bold text-foreground" data-testid="text-login-title">
                MentorsWorld Algo Trading
              </h1>
            </div>
          </Link>
          <p className="text-muted-foreground mt-4">Sign in to your account</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {step === "credentials" && (
                <>
                  <LogIn className="w-5 h-5" />
                  Sign In
                </>
              )}
              {step === "totp" && (
                <>
                  <Shield className="w-5 h-5" />
                  Two-Factor Authentication
                </>
              )}
              {step === "backup-code" && (
                <>
                  <Key className="w-5 h-5" />
                  Use Backup Code
                </>
              )}
              {step === "verify-email" && (
                <>
                  <AlertCircle className="w-5 h-5" />
                  Email Verification Required
                </>
              )}
            </CardTitle>
            <CardDescription>
              {step === "credentials" && "Enter your credentials to access the platform"}
              {step === "totp" && "Enter the 6-digit code from your authenticator app"}
              {step === "backup-code" && "Enter one of your backup recovery codes"}
              {step === "verify-email" && "Please verify your email to continue"}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {step === "credentials" && (
              <form onSubmit={handleCredentialsSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
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
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 pr-10"
                      required
                      data-testid="input-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                      data-testid="button-toggle-password"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
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

                <div className="text-center text-sm">
                  <span className="text-muted-foreground">Do not have an account? </span>
                  <Link href="/signup" className="text-primary hover:underline" data-testid="link-signup">
                    Sign Up
                  </Link>
                </div>

                <div className="text-center text-sm">
                  <Link href="/" className="text-muted-foreground hover:text-foreground hover:underline" data-testid="link-back-home">
                    Back to Home
                  </Link>
                </div>
              </form>
            )}

            {step === "totp" && (
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

                <div className="text-center">
                  <button
                    type="button"
                    className="text-sm text-muted-foreground hover:text-foreground underline"
                    onClick={() => {
                      setStep("backup-code");
                      setTotpCode("");
                    }}
                    data-testid="button-use-backup-code"
                  >
                    Lost access to authenticator? Use a backup code
                  </button>
                </div>

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

            {step === "backup-code" && (
              <form onSubmit={handleBackupCodeSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="backup">Backup Code</Label>
                  <Input
                    id="backup"
                    type="text"
                    placeholder="XXXX-XXXX"
                    value={backupCode}
                    onChange={(e) => setBackupCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 9))}
                    className="text-center text-2xl tracking-widest font-mono"
                    maxLength={9}
                    required
                    autoFocus
                    data-testid="input-backup-code"
                  />
                  <p className="text-xs text-muted-foreground text-center">
                    Enter one of your 8-character backup codes (format: XXXX-XXXX)
                  </p>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading || backupCode.length < 8}
                  data-testid="button-verify-backup"
                >
                  {isLoading ? "Verifying..." : "Verify & Sign In"}
                </Button>

                <div className="text-center">
                  <button
                    type="button"
                    className="text-sm text-muted-foreground hover:text-foreground underline"
                    onClick={() => {
                      setStep("totp");
                      setBackupCode("");
                    }}
                    data-testid="button-use-authenticator"
                  >
                    Use authenticator app instead
                  </button>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setStep("credentials");
                    setBackupCode("");
                  }}
                  data-testid="button-back-from-backup"
                >
                  Back to Sign In
                </Button>
              </form>
            )}

            {step === "verify-email" && (
              <div className="space-y-6">
                <div className="text-center text-sm text-muted-foreground">
                  <p>Your email address <strong>{email}</strong> has not been verified yet.</p>
                  <p className="mt-2">Please check your inbox for the verification link, or request a new one below.</p>
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleResendEmail}
                  disabled={resendingEmail}
                  data-testid="button-resend-verification"
                >
                  {resendingEmail ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Resend Verification Email
                    </>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setStep("credentials")}
                  data-testid="button-back-to-login"
                >
                  Back to Sign In
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

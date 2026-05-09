import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Shield, CheckCircle, Copy, AlertCircle, Key, Download } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function TotpSetup() {
  const [userId, setUserId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [backupCodesCopied, setBackupCodesCopied] = useState(false);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("userId");
    
    if (id) {
      setUserId(id);
      fetchTotpSetup(id);
    } else {
      setError("User ID not provided");
      setIsLoading(false);
    }
  }, []);

  const fetchTotpSetup = async (id: string) => {
    try {
      const res = await fetch(`/api/auth/totp/setup/${id}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to load TOTP setup");
      }

      setQrCode(data.qrCode);
      setSecret(data.secret);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    setCopied(true);
    toast({
      title: "Copied",
      description: "Secret key copied to clipboard",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);

    try {
      const res = await fetch("/api/auth/totp/verify-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, code: verificationCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Verification failed");
      }

      // Store backup codes and show them
      if (data.backupCodes && data.backupCodes.length > 0) {
        setBackupCodes(data.backupCodes);
        setShowBackupCodes(true);
      } else {
        toast({
          title: "TOTP Setup Complete",
          description: "Two-factor authentication is now enabled. You can now log in.",
        });
        navigate("/login");
      }
    } catch (error: any) {
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive",
      });
      setVerificationCode("");
    } finally {
      setIsVerifying(false);
    }
  };

  const copyBackupCodes = () => {
    const codesText = backupCodes.join("\n");
    navigator.clipboard.writeText(codesText);
    setBackupCodesCopied(true);
    toast({
      title: "Copied",
      description: "Backup codes copied to clipboard",
    });
    setTimeout(() => setBackupCodesCopied(false), 2000);
  };

  const downloadBackupCodes = () => {
    const codesText = `MentorsWorld AlgoTrading - Backup Recovery Codes\n${"=".repeat(50)}\n\nThese codes can be used to log in if you lose access to your authenticator app.\nEach code can only be used ONCE.\n\n${backupCodes.map((code, i) => `${i + 1}. ${code}`).join("\n")}\n\nGenerated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST\n\nKeep these codes in a safe place!`;
    const blob = new Blob([codesText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mentorsworld-backup-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: "Downloaded",
      description: "Backup codes saved to file",
    });
  };

  const handleContinueToLogin = () => {
    toast({
      title: "TOTP Setup Complete",
      description: "Two-factor authentication is now enabled. You can now log in.",
    });
    navigate("/login");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading TOTP setup...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              Setup Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button
              className="w-full mt-4"
              onClick={() => navigate("/login")}
              data-testid="button-go-login"
            >
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show backup codes after successful verification
  if (showBackupCodes) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-lg font-bold text-foreground">
              MentorsWorld Algo Trading Platform
            </h1>
            <p className="text-muted-foreground mt-2">Backup Recovery Codes</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-primary">
                <Key className="w-5 h-5" />
                Save Your Backup Codes
              </CardTitle>
              <CardDescription>
                These codes can be used to log in if you lose access to your authenticator app.
                Each code can only be used <strong>once</strong>.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Important</AlertTitle>
                <AlertDescription>
                  Store these codes in a safe place. They will not be shown again!
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg">
                {backupCodes.map((code, index) => (
                  <code 
                    key={index} 
                    className="text-center py-2 px-3 bg-background rounded font-mono text-sm"
                    data-testid={`backup-code-${index}`}
                  >
                    {code}
                  </code>
                ))}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={copyBackupCodes}
                  data-testid="button-copy-backup-codes"
                >
                  {backupCodesCopied ? (
                    <CheckCircle className="w-4 h-4 mr-2 text-primary" />
                  ) : (
                    <Copy className="w-4 h-4 mr-2" />
                  )}
                  Copy All
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={downloadBackupCodes}
                  data-testid="button-download-backup-codes"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </div>

              <Button
                className="w-full"
                onClick={handleContinueToLogin}
                data-testid="button-continue-to-login"
              >
                I've Saved My Codes - Continue to Login
              </Button>
            </CardContent>

            <CardFooter>
              <p className="text-xs text-muted-foreground text-center w-full">
                If you run out of backup codes, you can regenerate them from your account settings.
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-lg font-bold text-foreground" data-testid="text-totp-title">
            MentorsWorld Algo Trading Platform
          </h1>
          <p className="text-muted-foreground mt-2">Two-Factor Authentication Setup</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Set Up Authenticator
            </CardTitle>
            <CardDescription>
              Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="flex justify-center">
              {qrCode && (
                <img
                  src={qrCode}
                  alt="TOTP QR Code"
                  className="w-48 h-48 border rounded-lg"
                  data-testid="img-qr-code"
                />
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Can't scan? Enter this key manually:
              </Label>
              <div className="flex gap-2">
                <code className="flex-1 p-2 bg-muted rounded text-sm font-mono break-all">
                  {secret}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copySecret}
                  data-testid="button-copy-secret"
                >
                  {copied ? (
                    <CheckCircle className="w-4 h-4 text-primary" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>

            <form onSubmit={handleVerify} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Verification Code</Label>
                <Input
                  id="code"
                  type="text"
                  placeholder="000000"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="text-center text-2xl tracking-widest"
                  maxLength={6}
                  required
                  data-testid="input-verification-code"
                />
                <p className="text-xs text-muted-foreground text-center">
                  Enter the 6-digit code from your authenticator app
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isVerifying || verificationCode.length !== 6}
                data-testid="button-verify"
              >
                {isVerifying ? "Verifying..." : "Verify & Complete Setup"}
              </Button>
            </form>
          </CardContent>

          <CardFooter>
            <p className="text-xs text-muted-foreground text-center w-full">
              You'll need to enter a code from your authenticator app every time you log in
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

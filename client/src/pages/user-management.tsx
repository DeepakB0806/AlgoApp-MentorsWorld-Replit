import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  UserPlus, Users, Mail, Shield, CheckCircle, XCircle, 
  Clock, Copy, Trash2, ToggleLeft, ToggleRight, ArrowLeft, Home,
  Send, RefreshCw, MailCheck, MailX
} from "lucide-react";
import { Link } from "wouter";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  token: string;
  emailSent: boolean | null;
  emailSentAt: string | null;
}

interface TeamMember {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  emailVerified: boolean;
  totpVerified: boolean;
  isActive: boolean;
  createdAt: string;
}

export default function UserManagement() {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("team_member");
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: invitations = [], isLoading: loadingInvitations } = useQuery<Invitation[]>({
    queryKey: ["/api/auth/invitations"],
  });

  const { data: teamMembers = [], isLoading: loadingTeamMembers } = useQuery<TeamMember[]>({
    queryKey: ["/api/auth/team-members"],
  });

  const createInviteMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      const res = await apiRequest("POST", "/api/auth/invitations", { email, role });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/invitations"] });
      toast({
        title: "Invitation Sent",
        description: `Email invitation sent to ${inviteEmail}`,
      });
      setInviteEmail("");
      setIsInviteDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Create Invitation",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/auth/invitations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/invitations"] });
      toast({
        title: "Invitation Revoked",
        description: "The invitation has been cancelled",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Revoke Invitation",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleUserStatusMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest("PATCH", `/api/auth/team-members/${id}/status`, { isActive });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/team-members"] });
      toast({
        title: variables.isActive ? "User Activated" : "User Deactivated",
        description: `The user has been ${variables.isActive ? "activated" : "deactivated"}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Update User",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resendInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/auth/invitations/${id}/resend`);
      return res.json();
    },
    onSuccess: () => {
      setResendingId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/invitations"] });
      toast({
        title: "Email Sent",
        description: "Invitation email has been resent successfully",
      });
    },
    onError: (error: any) => {
      setResendingId(null);
      toast({
        title: "Failed to Resend Email",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleResendInvite = (id: string) => {
    setResendingId(id);
    resendInviteMutation.mutate(id);
  };

  const copyInviteUrl = (token: string) => {
    const url = `${window.location.origin}/register?token=${token}`;
    navigator.clipboard.writeText(url);
    setCopiedUrl(token);
    toast({
      title: "URL Copied",
      description: "Invitation URL copied to clipboard",
    });
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    createInviteMutation.mutate({ email: inviteEmail, role: inviteRole });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case "accepted":
        return <Badge variant="default"><CheckCircle className="w-3 h-3 mr-1" /> Accepted</Badge>;
      case "expired":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Expired</Badge>;
      case "revoked":
        return <Badge variant="outline"><XCircle className="w-3 h-3 mr-1" /> Revoked</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center gap-4">
            <div className="flex items-center gap-4">
              <div>
                <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">
                  User Management
                </h1>
                <p className="text-sm text-muted-foreground">Manage team members and invitations</p>
              </div>
            </div>
            <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-invite-member">
                  <UserPlus className="w-4 h-4 mr-2" />
                  Invite Team Member
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite Team Member</DialogTitle>
                  <DialogDescription>
                    Send an invitation to join as a team member. They'll need to set up TOTP for secure access.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleInvite}>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email Address</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="email"
                          type="email"
                          placeholder="team@example.com"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          className="pl-10"
                          required
                          data-testid="input-invite-email"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="role">Role</Label>
                      <Select value={inviteRole} onValueChange={setInviteRole}>
                        <SelectTrigger data-testid="select-invite-role">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="team_member">Team Member</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsInviteDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createInviteMutation.isPending}
                      data-testid="button-send-invite"
                    >
                      {createInviteMutation.isPending ? "Sending..." : "Send Invitation"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          <div className="mt-2">
            <PageBreadcrumbs items={[{ label: "User Management" }]} />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="grid gap-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Team Members
              </CardTitle>
              <CardDescription>
                Active team members with platform access
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingTeamMembers ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : (teamMembers ?? []).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No team members yet. Send an invitation to get started.
                </div>
              ) : (
                <div className="space-y-4">
                  {(teamMembers ?? []).map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                      data-testid={`member-${member.id}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                          <Shield className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">
                            {member.firstName && member.lastName
                              ? `${member.firstName} ${member.lastName}`
                              : member.email}
                          </p>
                          <p className="text-sm text-muted-foreground">{member.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex gap-2">
                          {member.emailVerified ? (
                            <Badge variant="secondary">
                              <CheckCircle className="w-3 h-3 mr-1" /> Email Verified
                            </Badge>
                          ) : (
                            <Badge variant="outline">Email Pending</Badge>
                          )}
                          {member.totpVerified ? (
                            <Badge variant="secondary">
                              <Shield className="w-3 h-3 mr-1" /> TOTP Enabled
                            </Badge>
                          ) : (
                            <Badge variant="outline">TOTP Pending</Badge>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleUserStatusMutation.mutate({ 
                            id: member.id, 
                            isActive: !member.isActive 
                          })}
                          data-testid={`button-toggle-${member.id}`}
                        >
                          {member.isActive ? (
                            <ToggleRight className="w-5 h-5 text-primary" />
                          ) : (
                            <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5" />
                Pending Invitations
              </CardTitle>
              <CardDescription>
                Invitations waiting to be accepted
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingInvitations ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : (invitations ?? []).filter(i => i.status === "pending").length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No pending invitations
                </div>
              ) : (
                <div className="space-y-4">
                  {(invitations ?? [])
                    .filter((inv) => inv.status === "pending")
                    .map((invitation) => (
                      <div
                        key={invitation.id}
                        className="flex items-center justify-between p-4 border rounded-lg"
                        data-testid={`invitation-${invitation.id}`}
                      >
                        <div className="flex-1">
                          <p className="font-medium">{invitation.email}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span className="text-sm text-muted-foreground">
                              Expires: {new Date(invitation.expiresAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}
                            </span>
                            {invitation.emailSent ? (
                              <Badge variant="secondary" className="text-xs">
                                <MailCheck className="w-3 h-3 mr-1" />
                                Email Sent {invitation.emailSentAt && (
                                  <span className="ml-1 opacity-75">
                                    ({new Date(invitation.emailSentAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })})
                                  </span>
                                )}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">
                                <MailX className="w-3 h-3 mr-1" />
                                Email Not Sent
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {getStatusBadge(invitation.status)}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleResendInvite(invitation.id)}
                            disabled={resendingId === invitation.id}
                            title="Resend invitation email"
                            data-testid={`button-resend-${invitation.id}`}
                          >
                            {resendingId === invitation.id ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyInviteUrl(invitation.token)}
                            title="Copy invitation URL"
                            data-testid={`button-copy-${invitation.id}`}
                          >
                            {copiedUrl === invitation.token ? (
                              <CheckCircle className="w-4 h-4 text-primary" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => revokeInviteMutation.mutate(invitation.id)}
                            title="Revoke invitation"
                            data-testid={`button-revoke-${invitation.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

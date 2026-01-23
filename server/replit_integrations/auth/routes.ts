import type { Express, Request, Response } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { db } from "../../db";
import { users, invitations } from "@shared/models/auth";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import crypto from "crypto";
import { sendVerificationEmail, sendTeamInvitationEmail } from "../../services/email";

// Super Admin email - this email will have super admin privileges
const SUPER_ADMIN_EMAIL = "webadmin@mentorsworld.org";

// Helper to check if user is Super Admin
function isSuperAdmin(userId: string, email?: string | null): boolean {
  // Super Admin is determined by email match
  if (!email) return false;
  return email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
}

// TOTP helper functions using speakeasy
function generateTotpSecret(): string {
  const secret = speakeasy.generateSecret({
    name: "AlgoTrading Platform",
    length: 20,
  });
  return secret.base32;
}

function verifyTotpCode(token: string, secret: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1, // Allow 1 step before/after for clock skew
  });
}

function generateTotpUri(email: string, secret: string): string {
  return speakeasy.otpauthURL({
    secret,
    label: email,
    issuer: "AlgoTrading Platform",
    encoding: "base32",
  });
}

// Middleware to validate team member session
async function validateTeamSession(req: Request, res: Response, next: any) {
  try {
    const sessionToken = req.cookies?.team_session;
    
    if (!sessionToken) {
      return next(); // No team session, continue to next middleware
    }
    
    const [user] = await db
      .select()
      .from(users)
      .where(and(
        eq(users.sessionToken, sessionToken),
        eq(users.isActive, true)
      ));
    
    if (!user || !user.sessionExpires || new Date() > user.sessionExpires) {
      res.clearCookie("team_session");
      return next(); // Session expired or invalid
    }
    
    // Attach team user to request
    (req as any).teamUser = user;
    next();
  } catch (error) {
    console.error("Error validating team session:", error);
    next();
  }
}

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Apply team session validation middleware to all routes
  app.use(validateTeamSession);
  
  // Get current authenticated user (supports both Replit Auth and team member auth)
  app.get("/api/auth/user", async (req: any, res) => {
    try {
      // First check for team member session
      if (req.teamUser) {
        return res.json({
          id: req.teamUser.id,
          email: req.teamUser.email,
          firstName: req.teamUser.firstName,
          lastName: req.teamUser.lastName,
          role: req.teamUser.role,
        });
      }
      
      // Then check for Replit Auth session
      if (!req.user?.claims?.sub) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Check if this user should be super admin
      const shouldBeSuperAdmin = isSuperAdmin(userId, user.email);
      
      // Update role if needed
      if (shouldBeSuperAdmin && user.role !== "super_admin") {
        const [updatedUser] = await db
          .update(users)
          .set({ role: "super_admin", updatedAt: new Date() })
          .where(eq(users.id, userId))
          .returning();
        return res.json(updatedUser);
      }
      
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
  
  // Team member logout
  app.post("/api/auth/team/logout", async (req: any, res) => {
    try {
      if (req.teamUser) {
        // Clear session from database
        await db.update(users)
          .set({ sessionToken: null, sessionExpires: null })
          .where(eq(users.id, req.teamUser.id));
      }
      
      res.clearCookie("team_session");
      res.json({ message: "Logged out successfully" });
    } catch (error) {
      console.error("Error logging out:", error);
      res.status(500).json({ message: "Failed to logout" });
    }
  });
  
  // Get current authenticated user with role (Replit Auth only - legacy)
  app.get("/api/auth/replit-user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Check if this user should be super admin
      const shouldBeSuperAdmin = isSuperAdmin(userId, user.email);
      
      // Update role if needed
      if (shouldBeSuperAdmin && user.role !== "super_admin") {
        const [updatedUser] = await db
          .update(users)
          .set({ role: "super_admin", updatedAt: new Date() })
          .where(eq(users.id, userId))
          .returning();
        return res.json(updatedUser);
      }
      
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
  
  // ============ TEAM MEMBER AUTHENTICATION ============
  
  // Register a team member (via invitation)
  app.post("/api/auth/team/register", async (req: Request, res: Response) => {
    try {
      const { token, password, confirmPassword } = req.body;
      
      if (!token || !password) {
        return res.status(400).json({ message: "Token and password are required" });
      }
      
      if (password !== confirmPassword) {
        return res.status(400).json({ message: "Passwords do not match" });
      }
      
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      
      // Find the invitation
      const [invitation] = await db
        .select()
        .from(invitations)
        .where(and(
          eq(invitations.token, token),
          eq(invitations.status, "pending")
        ));
      
      if (!invitation) {
        return res.status(400).json({ message: "Invalid or expired invitation" });
      }
      
      // Check expiration
      if (new Date() > invitation.expiresAt) {
        await db.update(invitations)
          .set({ status: "expired" })
          .where(eq(invitations.id, invitation.id));
        return res.status(400).json({ message: "Invitation has expired" });
      }
      
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);
      
      // Generate email verification token
      const emailVerificationToken = crypto.randomBytes(32).toString("hex");
      const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      // Generate TOTP secret for the user
      const totpSecret = generateTotpSecret();
      
      // Create user
      const [newUser] = await db
        .insert(users)
        .values({
          email: invitation.email,
          role: invitation.role as any,
          password: hashedPassword,
          invitedBy: invitation.invitedBy,
          emailVerificationToken,
          emailVerificationExpires,
          totpSecret,
          totpEnabled: true, // TOTP is required for team members
          totpVerified: false,
          emailVerified: false,
          isActive: true,
        })
        .returning();
      
      // Mark invitation as accepted
      await db.update(invitations)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(eq(invitations.id, invitation.id));
      
      res.status(201).json({
        message: "Registration successful. Please check your email for verification.",
        userId: newUser.id,
        requiresEmailVerification: true,
      });
    } catch (error: any) {
      console.error("Error registering team member:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Email already registered" });
      }
      res.status(500).json({ message: "Failed to register" });
    }
  });
  
  // Customer self-signup (no invitation required)
  app.post("/api/auth/customer/signup", async (req: Request, res: Response) => {
    try {
      const { email, password, firstName, lastName } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      
      // Check if email already exists
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()));
      
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }
      
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);
      
      // Check if this email should be Super Admin
      const shouldBeSuperAdmin = isSuperAdmin("", email);
      
      // Generate email verification token
      const emailVerificationToken = crypto.randomBytes(32).toString("hex");
      const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      // Create user with customer role (or super_admin if email matches)
      const [newUser] = await db
        .insert(users)
        .values({
          email: email.toLowerCase(),
          role: shouldBeSuperAdmin ? "super_admin" : "customer",
          password: hashedPassword,
          firstName: firstName || null,
          lastName: lastName || null,
          emailVerified: false,
          emailVerificationToken,
          emailVerificationExpires,
          isActive: true,
          totpEnabled: false,
          totpVerified: false,
        })
        .returning();
      
      // Send verification email
      const emailSent = await sendVerificationEmail(
        email.toLowerCase(),
        emailVerificationToken,
        firstName
      );
      
      if (!emailSent) {
        console.error("Failed to send verification email to:", email);
      }
      
      res.status(201).json({
        message: "Account created! Please check your email to verify your account.",
        userId: newUser.id,
        requiresEmailVerification: true,
      });
    } catch (error: any) {
      console.error("Error in customer signup:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Email already registered" });
      }
      res.status(500).json({ message: "Failed to create account" });
    }
  });

  // Verify email
  app.get("/api/auth/verify-email/:token", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.emailVerificationToken, token));
      
      if (!user) {
        return res.redirect("/login?error=invalid_token");
      }
      
      if (user.emailVerificationExpires && new Date() > user.emailVerificationExpires) {
        return res.redirect("/login?error=token_expired");
      }
      
      // Generate session token for auto-login
      const sessionToken = crypto.randomBytes(32).toString("hex");
      const sessionExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      
      // Mark email as verified and create session
      await db.update(users)
        .set({
          emailVerified: true,
          emailVerificationToken: null,
          sessionToken,
          sessionExpires,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      
      // Set session cookie
      res.cookie("team_session", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: "/",
      });
      
      // Redirect to TOTP setup if it's a team member
      if (user.role === "team_member" && !user.totpVerified) {
        return res.redirect(`/totp-setup?userId=${user.id}`);
      }
      
      // For customers, redirect to user home
      res.redirect("/user-home?verified=true");
    } catch (error) {
      console.error("Error verifying email:", error);
      res.redirect("/login?error=verification_failed");
    }
  });
  
  // Resend verification email
  app.post("/api/auth/resend-verification", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()));
      
      if (!user) {
        // Don't reveal if email exists
        return res.json({ message: "If an account with that email exists, a verification email has been sent." });
      }
      
      if (user.emailVerified) {
        return res.status(400).json({ message: "Email is already verified" });
      }
      
      // Generate new verification token
      const emailVerificationToken = crypto.randomBytes(32).toString("hex");
      const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      await db.update(users)
        .set({
          emailVerificationToken,
          emailVerificationExpires,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      
      // Send verification email
      await sendVerificationEmail(
        user.email || email,
        emailVerificationToken,
        user.firstName || undefined
      );
      
      res.json({ message: "Verification email sent. Please check your inbox." });
    } catch (error) {
      console.error("Error resending verification:", error);
      res.status(500).json({ message: "Failed to resend verification email" });
    }
  });
  
  // Get TOTP setup (QR code)
  app.get("/api/auth/totp/setup/:userId", async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));
      
      if (!user || !user.totpSecret) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Skip email verification check in development for easier testing
      // In production, uncomment the check below:
      // if (!user.emailVerified) {
      //   return res.status(400).json({ message: "Please verify your email first" });
      // }
      
      if (user.totpVerified) {
        return res.status(400).json({ message: "TOTP already configured" });
      }
      
      // Generate QR code
      const otpauth = generateTotpUri(user.email || "user", user.totpSecret);
      
      const qrCode = await QRCode.toDataURL(otpauth);
      
      res.json({
        qrCode,
        secret: user.totpSecret, // Show secret for manual entry
      });
    } catch (error) {
      console.error("Error getting TOTP setup:", error);
      res.status(500).json({ message: "Failed to get TOTP setup" });
    }
  });
  
  // Verify and complete TOTP setup
  app.post("/api/auth/totp/verify-setup", async (req: Request, res: Response) => {
    try {
      const { userId, code } = req.body;
      
      if (!userId || !code) {
        return res.status(400).json({ message: "User ID and code are required" });
      }
      
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));
      
      if (!user || !user.totpSecret) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Verify TOTP code
      const isValid = verifyTotpCode(code, user.totpSecret);
      
      if (!isValid) {
        return res.status(400).json({ message: "Invalid TOTP code" });
      }
      
      // Mark TOTP as verified
      await db.update(users)
        .set({ totpVerified: true, updatedAt: new Date() })
        .where(eq(users.id, userId));
      
      res.json({ message: "TOTP setup complete. You can now log in." });
    } catch (error) {
      console.error("Error verifying TOTP setup:", error);
      res.status(500).json({ message: "Failed to verify TOTP" });
    }
  });
  
  // Team member login (Email + Password)
  app.post("/api/auth/team/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email));
      
      if (!user || !user.password) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      if (user.role !== "team_member") {
        return res.status(401).json({ message: "Use the standard login for this account" });
      }
      
      // Skip email verification check in development for easier testing
      // In production, uncomment the check below:
      // if (!user.emailVerified) {
      //   return res.status(401).json({ message: "Please verify your email first" });
      // }
      
      if (!user.isActive) {
        return res.status(401).json({ message: "Account is deactivated" });
      }
      
      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      // Check if TOTP is required
      if (user.totpEnabled) {
        if (!user.totpVerified) {
          return res.json({
            requiresTotpSetup: true,
            userId: user.id,
            message: "TOTP setup required",
          });
        }
        
        return res.json({
          requiresTotp: true,
          userId: user.id,
          message: "TOTP verification required",
        });
      }
      
      // This shouldn't happen for team members, but handle it
      res.json({ message: "Login successful", userId: user.id });
    } catch (error) {
      console.error("Error during team login:", error);
      res.status(500).json({ message: "Failed to log in" });
    }
  });
  
  // Verify TOTP for login
  app.post("/api/auth/team/verify-totp", async (req: Request, res: Response) => {
    try {
      const { userId, code } = req.body;
      
      if (!userId || !code) {
        return res.status(400).json({ message: "User ID and TOTP code are required" });
      }
      
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));
      
      if (!user || !user.totpSecret) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Verify TOTP
      const isValid = verifyTotpCode(code, user.totpSecret);
      
      if (!isValid) {
        return res.status(401).json({ message: "Invalid TOTP code" });
      }
      
      // Generate a session token and store it in a cookie
      const sessionToken = crypto.randomBytes(32).toString("hex");
      const sessionExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      // Store session token in database
      await db.update(users)
        .set({ 
          sessionToken, 
          sessionExpires,
          lastLoginAt: new Date(),
          updatedAt: new Date() 
        })
        .where(eq(users.id, userId));
      
      // Set HTTP-only cookie with session token
      res.cookie("team_session", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: "/",
      });
      
      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      });
    } catch (error) {
      console.error("Error verifying TOTP:", error);
      res.status(500).json({ message: "Failed to verify TOTP" });
    }
  });
  
  // Customer login (Email + Password, requires email verification)
  app.post("/api/auth/customer/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()));
      
      if (!user || !user.password) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      if (!user.isActive) {
        return res.status(401).json({ message: "Account is deactivated" });
      }
      
      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      // Check email verification
      if (!user.emailVerified) {
        return res.status(401).json({ 
          message: "Please verify your email first",
          requiresEmailVerification: true,
          email: user.email,
        });
      }
      
      // For team members, require TOTP
      if (user.role === "team_member" && user.totpEnabled) {
        if (!user.totpVerified) {
          return res.json({
            requiresTotpSetup: true,
            userId: user.id,
            message: "TOTP setup required",
          });
        }
        return res.json({
          requiresTotp: true,
          userId: user.id,
          message: "TOTP verification required",
        });
      }
      
      // Generate session token
      const sessionToken = crypto.randomBytes(32).toString("hex");
      const sessionExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      
      // Store session token in database
      await db.update(users)
        .set({ 
          sessionToken, 
          sessionExpires,
          lastLoginAt: new Date(),
          updatedAt: new Date() 
        })
        .where(eq(users.id, user.id));
      
      // Set HTTP-only cookie with session token
      res.cookie("team_session", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: "/",
      });
      
      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      });
    } catch (error) {
      console.error("Error during customer login:", error);
      res.status(500).json({ message: "Failed to log in" });
    }
  });
  
  // ============ INVITATION MANAGEMENT (Super Admin only) ============
  
  // Create invitation
  app.post("/api/auth/invitations", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      
      if (!user || user.role !== "super_admin") {
        return res.status(403).json({ message: "Only Super Admin can invite team members" });
      }
      
      const { email, role = "team_member" } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      
      // Check if user already exists
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, email));
      
      if (existingUser) {
        return res.status(400).json({ message: "User with this email already exists" });
      }
      
      // Check for pending invitation
      const [pendingInvitation] = await db
        .select()
        .from(invitations)
        .where(and(
          eq(invitations.email, email),
          eq(invitations.status, "pending")
        ));
      
      if (pendingInvitation) {
        return res.status(400).json({ message: "Invitation already sent to this email" });
      }
      
      // Create invitation token
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      
      const [invitation] = await db
        .insert(invitations)
        .values({
          email,
          role,
          invitedBy: userId,
          token,
          expiresAt,
          status: "pending",
        })
        .returning();
      
      // In production, send email here
      // For now, return the invitation URL
      const inviteUrl = `/register?token=${token}`;
      
      res.status(201).json({
        message: "Invitation created",
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
          inviteUrl,
        },
      });
    } catch (error) {
      console.error("Error creating invitation:", error);
      res.status(500).json({ message: "Failed to create invitation" });
    }
  });
  
  // Get all invitations (Super Admin only)
  app.get("/api/auth/invitations", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      
      if (!user || user.role !== "super_admin") {
        return res.status(403).json({ message: "Only Super Admin can view invitations" });
      }
      
      const allInvitations = await db.select().from(invitations);
      res.json(allInvitations);
    } catch (error) {
      console.error("Error fetching invitations:", error);
      res.status(500).json({ message: "Failed to fetch invitations" });
    }
  });
  
  // Revoke invitation (Super Admin only)
  app.delete("/api/auth/invitations/:id", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      
      if (!user || user.role !== "super_admin") {
        return res.status(403).json({ message: "Only Super Admin can revoke invitations" });
      }
      
      const { id } = req.params;
      
      await db.update(invitations)
        .set({ status: "revoked" })
        .where(eq(invitations.id, id));
      
      res.json({ message: "Invitation revoked" });
    } catch (error) {
      console.error("Error revoking invitation:", error);
      res.status(500).json({ message: "Failed to revoke invitation" });
    }
  });
  
  // ============ USER MANAGEMENT (Super Admin only) ============
  
  // Get all team members (Super Admin only)
  app.get("/api/auth/team-members", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      
      if (!user || user.role !== "super_admin") {
        return res.status(403).json({ message: "Only Super Admin can view team members" });
      }
      
      const teamMembers = await db
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
          emailVerified: users.emailVerified,
          totpVerified: users.totpVerified,
          isActive: users.isActive,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.role, "team_member"));
      
      res.json(teamMembers);
    } catch (error) {
      console.error("Error fetching team members:", error);
      res.status(500).json({ message: "Failed to fetch team members" });
    }
  });
  
  // Deactivate/activate team member (Super Admin only)
  app.patch("/api/auth/team-members/:id/status", isAuthenticated, async (req: any, res: Response) => {
    try {
      const adminId = req.user.claims.sub;
      const admin = await authStorage.getUser(adminId);
      
      if (!admin || admin.role !== "super_admin") {
        return res.status(403).json({ message: "Only Super Admin can manage team members" });
      }
      
      const { id } = req.params;
      const { isActive } = req.body;
      
      const [updated] = await db
        .update(users)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json({ message: `User ${isActive ? "activated" : "deactivated"}`, user: updated });
    } catch (error) {
      console.error("Error updating team member status:", error);
      res.status(500).json({ message: "Failed to update team member status" });
    }
  });
  
  // Check invitation validity
  app.get("/api/auth/invitations/check/:token", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      
      const [invitation] = await db
        .select()
        .from(invitations)
        .where(eq(invitations.token, token));
      
      if (!invitation) {
        return res.status(404).json({ valid: false, message: "Invitation not found" });
      }
      
      if (invitation.status !== "pending") {
        return res.status(400).json({ 
          valid: false, 
          message: invitation.status === "accepted" ? "Invitation already used" : "Invitation is no longer valid" 
        });
      }
      
      if (new Date() > invitation.expiresAt) {
        return res.status(400).json({ valid: false, message: "Invitation has expired" });
      }
      
      res.json({
        valid: true,
        email: invitation.email,
        role: invitation.role,
      });
    } catch (error) {
      console.error("Error checking invitation:", error);
      res.status(500).json({ message: "Failed to check invitation" });
    }
  });
}

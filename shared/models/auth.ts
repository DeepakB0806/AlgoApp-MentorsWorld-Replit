import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, varchar, text, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User roles for the platform
export type UserRole = "super_admin" | "team_member" | "customer";

// User storage table with roles and TOTP support
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  
  // Role-based access control
  role: varchar("role", { length: 50 }).notNull().default("customer"), // super_admin, team_member, customer
  
  // For team members: Email/Password auth
  password: varchar("password"), // Hashed password for team members
  
  // Email verification
  emailVerified: boolean("email_verified").default(false),
  emailVerificationToken: varchar("email_verification_token"),
  emailVerificationExpires: timestamp("email_verification_expires"),
  
  // TOTP (Time-based One-Time Password) for team members
  totpEnabled: boolean("totp_enabled").default(false),
  totpSecret: varchar("totp_secret"), // Base32 encoded secret
  totpVerified: boolean("totp_verified").default(false), // True after first successful TOTP entry
  
  // Status and metadata
  isActive: boolean("is_active").default(true),
  invitedBy: varchar("invited_by"), // User ID who invited this team member
  
  // Session management for team members
  sessionToken: varchar("session_token"),
  sessionExpires: timestamp("session_expires"),
  lastLoginAt: timestamp("last_login_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// Team member invitations
export const invitations = pgTable("invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").notNull(),
  role: varchar("role", { length: 50 }).notNull().default("team_member"), // team_member or specific developer role
  invitedBy: varchar("invited_by").notNull(), // Super admin user ID
  token: varchar("token").notNull().unique(), // Unique invitation token
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, accepted, expired, revoked
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertInvitationSchema = createInsertSchema(invitations).omit({
  id: true,
  createdAt: true,
  acceptedAt: true,
});

export type Invitation = typeof invitations.$inferSelect;
export type InsertInvitation = z.infer<typeof insertInvitationSchema>;

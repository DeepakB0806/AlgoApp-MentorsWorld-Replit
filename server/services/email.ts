import Mailjet from "node-mailjet";
import { Request } from "express";
import { db } from "../db";
import { appSettings } from "../../shared/schema";
import { eq } from "drizzle-orm";

// Extract base URL from incoming request headers (works in both dev and prod)
export function getBaseUrlFromRequest(req: Request): string {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  
  if (host) {
    return `${protocol}://${host}`;
  }
  
  return "";
}

const FROM_EMAIL = "webadmin@mentorsworld.org";
const FROM_NAME = "AlgoTrading Platform";

// Get base URL from app_settings (domain_name key) or fallback to env/localhost
// This is kept as internal fallback when no baseUrl is provided
async function getBaseUrlFromDatabase(): Promise<string> {
  try {
    // First, try to get domain from app_settings table
    const [setting] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "domain_name"));
    
    if (setting?.value) {
      // Ensure the domain has https:// prefix
      const domain = setting.value.trim();
      if (domain.startsWith("http://") || domain.startsWith("https://")) {
        return domain;
      }
      return `https://${domain}`;
    }
  } catch (error) {
    console.error("Failed to get domain from app_settings:", error);
  }
  
  // Fallback to environment variable or localhost
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  
  return "http://localhost:5000";
}

// Resolve base URL: use provided URL if valid, otherwise fall back to database
async function resolveBaseUrl(providedBaseUrl?: string): Promise<string> {
  // Trust the request-derived URL if it has a valid scheme
  if (providedBaseUrl && providedBaseUrl.startsWith("http")) {
    return providedBaseUrl;
  }
  return getBaseUrlFromDatabase();
}

// Mailjet API client
function getMailjetClient() {
  const apiKey = process.env.MAILJET_API_KEY?.trim().replace(/[,;'"\s]+$/g, '');
  const secretKey = process.env.MAILJET_SECRET_KEY?.trim().replace(/[,;'"\s]+$/g, '');
  
  if (!apiKey || !secretKey) {
    throw new Error("Mailjet credentials not configured");
  }
  
  return new Mailjet({
    apiKey: apiKey,
    apiSecret: secretKey,
  });
}

export interface EmailOptions {
  to: string;
  toName?: string;
  subject: string;
  textContent: string;
  htmlContent: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    const mailjet = getMailjetClient();
    
    const result = await mailjet.post("send", { version: "v3.1" }).request({
      Messages: [
        {
          From: {
            Email: FROM_EMAIL,
            Name: FROM_NAME,
          },
          To: [
            {
              Email: options.to,
              Name: options.toName || options.to,
            },
          ],
          Subject: options.subject,
          TextPart: options.textContent,
          HTMLPart: options.htmlContent,
        },
      ],
    });

    console.log("Email sent successfully via Mailjet API:", JSON.stringify(result.body));
    return true;
  } catch (error: any) {
    console.error("Failed to send email:", error.message || error);
    if (error.response?.body) {
      try {
        console.error("Mailjet error response:", JSON.stringify(error.response.body));
      } catch {
        console.error("Mailjet error response (non-serializable):", error.response.statusCode || error.response.status);
      }
    }
    return false;
  }
}

export async function sendVerificationEmail(
  email: string,
  token: string,
  firstName?: string,
  providedBaseUrl?: string
): Promise<boolean> {
  const baseUrl = await resolveBaseUrl(providedBaseUrl);

  const verificationUrl = `${baseUrl}/api/auth/verify-email/${token}`;
  const name = firstName || "there";

  const textContent = `
Hi ${name},

Welcome to AlgoTrading Platform! Please verify your email address by clicking the link below:

${verificationUrl}

This link will expire in 24 hours.

If you did not create an account, please ignore this email.

Best regards,
The AlgoTrading Team
  `.trim();

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">AlgoTrading Platform</h1>
  </div>
  
  <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
    <h2 style="color: #1e293b; margin-top: 0;">Verify Your Email</h2>
    
    <p>Hi ${name},</p>
    
    <p>Welcome to AlgoTrading Platform! To complete your registration, please verify your email address by clicking the button below:</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${verificationUrl}" style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
        Verify Email Address
      </a>
    </div>
    
    <p style="color: #64748b; font-size: 14px;">This link will expire in 24 hours.</p>
    
    <p style="color: #64748b; font-size: 14px;">If you did not create an account, please ignore this email.</p>
    
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
    
    <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">
      If the button above does not work, copy and paste this link into your browser:<br>
      <a href="${verificationUrl}" style="color: #10b981; word-break: break-all;">${verificationUrl}</a>
    </p>
  </div>
  
  <div style="text-align: center; padding: 20px; color: #94a3b8; font-size: 12px;">
    <p>&copy; ${new Date().getFullYear()} AlgoTrading Platform. All rights reserved.</p>
  </div>
</body>
</html>
  `.trim();

  return sendEmail({
    to: email,
    toName: firstName,
    subject: "Verify your email - AlgoTrading Platform",
    textContent,
    htmlContent,
  });
}

export async function sendTeamInvitationEmail(
  email: string,
  inviteToken: string,
  inviterName?: string,
  providedBaseUrl?: string
): Promise<boolean> {
  const baseUrl = await resolveBaseUrl(providedBaseUrl);

  const registerUrl = `${baseUrl}/register?token=${inviteToken}`;
  const inviter = inviterName || "A team administrator";

  const textContent = `
Hi,

${inviter} has invited you to join AlgoTrading Platform as a team member.

Click the link below to accept your invitation and create your account:

${registerUrl}

This invitation will expire in 7 days.

If you did not expect this invitation, please ignore this email.

Best regards,
The AlgoTrading Team
  `.trim();

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">AlgoTrading Platform</h1>
  </div>
  
  <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
    <h2 style="color: #1e293b; margin-top: 0;">You are Invited!</h2>
    
    <p><strong>${inviter}</strong> has invited you to join AlgoTrading Platform as a team member.</p>
    
    <p>As a team member, you will be able to:</p>
    <ul style="color: #475569;">
      <li>Access trading strategies and webhooks</li>
      <li>Monitor trading positions and orders</li>
      <li>Configure broker API connections</li>
    </ul>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${registerUrl}" style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
        Accept Invitation
      </a>
    </div>
    
    <p style="color: #64748b; font-size: 14px;">This invitation will expire in 7 days.</p>
    
    <p style="color: #64748b; font-size: 14px;">If you did not expect this invitation, please ignore this email.</p>
    
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
    
    <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">
      If the button above does not work, copy and paste this link into your browser:<br>
      <a href="${registerUrl}" style="color: #10b981; word-break: break-all;">${registerUrl}</a>
    </p>
  </div>
  
  <div style="text-align: center; padding: 20px; color: #94a3b8; font-size: 12px;">
    <p>&copy; ${new Date().getFullYear()} AlgoTrading Platform. All rights reserved.</p>
  </div>
</body>
</html>
  `.trim();

  return sendEmail({
    to: email,
    subject: "You are invited to AlgoTrading Platform",
    textContent,
    htmlContent,
  });
}

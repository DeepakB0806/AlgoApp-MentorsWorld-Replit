import nodemailer from "nodemailer";

const FROM_EMAIL = "webadmin@mentorsworld.org";
const FROM_NAME = "AlgoTrading Platform";

// Mailjet SMTP configuration
// Using port 587 with STARTTLS (Mailjet's recommended configuration)
function createTransporter() {
  const apiKey = process.env.MAILJET_API_KEY;
  const secretKey = process.env.MAILJET_SECRET_KEY;
  
  console.log("Creating Mailjet transporter...");
  console.log(`API Key length: ${apiKey?.length || 0}`);
  console.log(`Secret Key length: ${secretKey?.length || 0}`);
  console.log(`API Key first 8 chars: ${apiKey?.substring(0, 8) || 'N/A'}`);
  
  return nodemailer.createTransport({
    host: "in-v3.mailjet.com",
    port: 587,
    secure: false,
    auth: {
      user: apiKey,
      pass: secretKey,
    },
  });
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter;
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
    const transport = getTransporter();
    const result = await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: options.to,
      subject: options.subject,
      text: options.textContent,
      html: options.htmlContent,
    });

    console.log("Email sent successfully:", result.messageId);
    return true;
  } catch (error) {
    console.error("Failed to send email:", error);
    return false;
  }
}

export async function sendVerificationEmail(
  email: string,
  token: string,
  firstName?: string
): Promise<boolean> {
  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:5000";

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
  inviterName?: string
): Promise<boolean> {
  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:5000";

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

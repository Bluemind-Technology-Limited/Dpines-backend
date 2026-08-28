// Email Service - Phase 5.2 - Handles email delivery via Resend - Features: - - Email template rendering - - Variable substitution - - HTML and plain text support - - Retry logic - - Delivery tracking

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

interface EmailTemplate {
  subject: string;
  htmlTemplate: string;
  textTemplate?: string;
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// Email templates for different notification types
const emailTemplates: Record<string, EmailTemplate> = {
  // Loan payment reminder
  loan_payment_reminder: {
    subject: "Your DPINES Loan Payment is Due Soon",
    htmlTemplate: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; color: white; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">Payment Reminder</h1>
        </div>
        <div style="padding: 20px; background: #f9f9f9;">
          <p>Hello {{firstName}},</p>
          <p>This is a friendly reminder that your loan payment is due in <strong>{{daysUntilDue}} day(s)</strong>.</p>
          
          <div style="background: white; padding: 15px; border-left: 4px solid #667eea; margin: 20px 0;">
            <p style="margin: 0; color: #666;">Amount Due:</p>
            <h2 style="margin: 5px 0 0 0; color: #333;">₦{{amountDue}}</h2>
          </div>

          <p>Please ensure payment is made by your due date to avoid late charges.</p>
          
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd;">
            <p style="color: #666; font-size: 12px;">
              If you have any questions about your loan or need assistance making a payment, 
              please contact our support team at support@dpines.ng
            </p>
          </div>
        </div>
        <div style="background: #f0f0f0; padding: 15px; text-align: center; color: #666; font-size: 12px; border-radius: 0 0 8px 8px;">
          <p>© 2026 DPINES Nigeria. All rights reserved.</p>
        </div>
      </div>
    `,
    textTemplate: `
      PAYMENT REMINDER

      Hello {{firstName}},

      This is a friendly reminder that your loan payment is due in {{daysUntilDue}} day(s).

      Amount Due: ₦{{amountDue}}

      Please ensure payment is made by your due date to avoid late charges.

      If you have any questions, contact support@dpines.ng
    `,
  },

  // Loan payment received
  loan_payment_received: {
    subject: "Your DPINES Loan Payment has been Received",
    htmlTemplate: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #11c86d 0%, #21b573 100%); padding: 20px; color: white; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">✓ Payment Received</h1>
        </div>
        <div style="padding: 20px; background: #f9f9f9;">
          <p>Hello {{firstName}},</p>
          <p>Your loan payment has been successfully received and processed.</p>
          
          <div style="background: white; padding: 15px; border-left: 4px solid #11c86d; margin: 20px 0;">
            <p style="margin: 0; color: #666;">Payment Details</p>
            <table style="width: 100%; margin-top: 10px; font-size: 14px;">
              <tr>
                <td style="color: #666;">Amount Paid:</td>
                <td style="text-align: right; font-weight: bold;">₦{{amountPaid}}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td style="color: #666; padding-top: 10px;">Payment Date:</td>
                <td style="text-align: right; padding-top: 10px;">{{paymentDate}}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td style="color: #666; padding-top: 10px;">Remaining Balance:</td>
                <td style="text-align: right; font-weight: bold; padding-top: 10px;">₦{{remainingBalance}}</td>
              </tr>
            </table>
          </div>

          <p>Thank you for your timely payment. Your next payment is due on <strong>{{nextDueDate}}</strong>.</p>
          
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd;">
            <p style="color: #666; font-size: 12px;">
              Transaction ID: {{transactionId}}<br/>
              If you have any questions, contact support@dpines.ng
            </p>
          </div>
        </div>
        <div style="background: #f0f0f0; padding: 15px; text-align: center; color: #666; font-size: 12px; border-radius: 0 0 8px 8px;">
          <p>© 2026 DPINES Nigeria. All rights reserved.</p>
        </div>
      </div>
    `,
    textTemplate: `
      PAYMENT RECEIVED

      Hello {{firstName}},

      Your loan payment has been successfully received and processed.

      Payment Details
      ================
      Amount Paid: ₦{{amountPaid}}
      Payment Date: {{paymentDate}}
      Remaining Balance: ₦{{remainingBalance}}

      Your next payment is due on {{nextDueDate}}.

      Transaction ID: {{transactionId}}
      If you have any questions, contact support@dpines.ng
    `,
  },

  // Late fee charged
  late_fee_charged: {
    subject: "Late Fee Applied to Your DPINES Loan",
    htmlTemplate: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%); padding: 20px; color: white; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">⚠ Late Fee Applied</h1>
        </div>
        <div style="padding: 20px; background: #f9f9f9;">
          <p>Hello {{firstName}},</p>
          <p>A late fee has been applied to your loan account due to a missed payment.</p>
          
          <div style="background: #fff3cd; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0;">
            <p style="margin: 0; color: #856404;">Late Fee Amount</p>
            <h2 style="margin: 5px 0 0 0; color: #333;">₦{{feeAmount}}</h2>
          </div>

          <p><strong>To avoid further charges, please make your payment immediately.</strong></p>
          
          <div style="background: white; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0;">
            <p style="margin: 0 0 10px 0; color: #666;">Current Status:</p>
            <table style="width: 100%; font-size: 14px;">
              <tr>
                <td style="color: #666;">Original Payment Due:</td>
                <td style="text-align: right;">{{originalDueDate}}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td style="color: #666; padding-top: 10px;">Days Overdue:</td>
                <td style="text-align: right; padding-top: 10px; color: #d32f2f; font-weight: bold;">{{daysOverdue}}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td style="color: #666; padding-top: 10px;">Late Fee Rate:</td>
                <td style="text-align: right; padding-top: 10px;">{{feeRate}}</td>
              </tr>
            </table>
          </div>

          <p>Please settle this immediately to avoid loan default status. Contact support@dpines.ng if you need payment assistance.</p>
          
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd;">
            <p style="color: #666; font-size: 12px;">
              Urgent: Your account requires immediate attention to avoid further penalties.
            </p>
          </div>
        </div>
        <div style="background: #f0f0f0; padding: 15px; text-align: center; color: #666; font-size: 12px; border-radius: 0 0 8px 8px;">
          <p>© 2026 DPINES Nigeria. All rights reserved.</p>
        </div>
      </div>
    `,
    textTemplate: `
      LATE FEE ALERT

      Hello {{firstName}},

      A late fee has been applied to your loan account due to a missed payment.

      URGENT: Late Fee Amount: ₦{{feeAmount}}

      Current Status
      ==============
      Original Payment Due: {{originalDueDate}}
      Days Overdue: {{daysOverdue}}
      Late Fee Rate: {{feeRate}}

      Please settle this immediately to avoid loan default status.
      Contact support@dpines.ng if you need payment assistance.
    `,
  },

  // Investment maturity alert
  investment_maturity_alert: {
    subject: "Your DPINES Investment has Matured",
    htmlTemplate: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 20px; color: white; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">Investment Matured</h1>
        </div>
        <div style="padding: 20px; background: #f9f9f9;">
          <p>Hello {{firstName}},</p>
          <p>Congratulations! Your investment has reached maturity.</p>
          
          <div style="background: white; padding: 15px; border-left: 4px solid #3b82f6; margin: 20px 0;">
            <p style="margin: 0; color: #666;">Investment Summary</p>
            <table style="width: 100%; margin-top: 10px; font-size: 14px;">
              <tr>
                <td style="color: #666;">Initial Investment:</td>
                <td style="text-align: right;">₦{{initialAmount}}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td style="color: #666; padding-top: 10px;">Current Value:</td>
                <td style="text-align: right; font-weight: bold; padding-top: 10px;">₦{{currentValue}}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td style="color: #11c86d; padding-top: 10px; font-weight: bold;">Interest Earned:</td>
                <td style="text-align: right; font-weight: bold; padding-top: 10px; color: #11c86d;">₦{{interestEarned}}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td style="color: #666; padding-top: 10px;">Return on Investment:</td>
                <td style="text-align: right; padding-top: 10px;">{{roi}}%</td>
              </tr>
            </table>
          </div>

          <p>You have two options:</p>
          <ol>
            <li><strong>Rollover:</strong> Reinvest your matured amount for another term at current rates</li>
            <li><strong>Withdraw:</strong> Transfer your funds to your account</li>
          </ol>

          <p>Your current selection is set to: <strong>{{maturityAction}}</strong></p>
          
          <p>If you wish to change your preference, please log in to your account and update your investment settings.</p>
          
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd;">
            <p style="color: #666; font-size: 12px;">
              Action required: Your investment needs attention. Log in to your DPINES account to manage your investment.
            </p>
          </div>
        </div>
        <div style="background: #f0f0f0; padding: 15px; text-align: center; color: #666; font-size: 12px; border-radius: 0 0 8px 8px;">
          <p>© 2026 DPINES Nigeria. All rights reserved.</p>
        </div>
      </div>
    `,
    textTemplate: `
      INVESTMENT MATURED

      Hello {{firstName}},

      Congratulations! Your investment has reached maturity.

      Investment Summary
      ==================
      Initial Investment: ₦{{initialAmount}}
      Current Value: ₦{{currentValue}}
      Interest Earned: ₦{{interestEarned}}
      Return on Investment: {{roi}}%

      You have two options:
      1. Rollover: Reinvest your matured amount for another term
      2. Withdraw: Transfer your funds to your account

      Your current selection: {{maturityAction}}

      Log in to your DPINES account to manage your investment.
    `,
  },

  // Withdrawal confirmation
  withdrawal_confirmation: {
    subject: "Your DPINES Withdrawal has been Processed",
    htmlTemplate: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #11c86d 0%, #21b573 100%); padding: 20px; color: white; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">✓ Withdrawal Confirmed</h1>
        </div>
        <div style="padding: 20px; background: #f9f9f9;">
          <p>Hello {{firstName}},</p>
          <p>Your investment withdrawal has been successfully processed.</p>
          
          <div style="background: white; padding: 15px; border-left: 4px solid #11c86d; margin: 20px 0;">
            <p style="margin: 0; color: #666;">Withdrawal Details</p>
            <table style="width: 100%; margin-top: 10px; font-size: 14px;">
              <tr>
                <td style="color: #666;">Withdrawal Amount:</td>
                <td style="text-align: right; font-weight: bold;">₦{{withdrawalAmount}}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td style="color: #666; padding-top: 10px;">Withdrawal Date:</td>
                <td style="text-align: right; padding-top: 10px;">{{withdrawalDate}}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td style="color: #666; padding-top: 10px;">Transaction ID:</td>
                <td style="text-align: right; padding-top: 10px;">{{transactionId}}</td>
              </tr>
            </table>
          </div>

          <p>The funds should appear in your account within 1-2 business days.</p>
          
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd;">
            <p style="color: #666; font-size: 12px;">
              If you do not see the funds within 2 business days, please contact support@dpines.ng
            </p>
          </div>
        </div>
        <div style="background: #f0f0f0; padding: 15px; text-align: center; color: #666; font-size: 12px; border-radius: 0 0 8px 8px;">
          <p>© 2026 DPINES Nigeria. All rights reserved.</p>
        </div>
      </div>
    `,
    textTemplate: `
      WITHDRAWAL CONFIRMED

      Hello {{firstName}},

      Your investment withdrawal has been successfully processed.

      Withdrawal Details
      ==================
      Withdrawal Amount: ₦{{withdrawalAmount}}
      Withdrawal Date: {{withdrawalDate}}
      Transaction ID: {{transactionId}}

      The funds should appear in your account within 1-2 business days.

      If you don't see the funds within 2 business days, contact support@dpines.ng
    `,
  },
};

export class EmailService {
  // Render email template with variables
  private renderTemplate(template: string, variables: Record<string, any>): string {
    let rendered = template;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      rendered = rendered.replace(new RegExp(placeholder, "g"), String(value || ""));
    }
    return rendered;
  }

  // Send email via Resend
  async sendEmail(
    to: string,
    templateName: string,
    variables: Record<string, any>
  ): Promise<SendEmailResult> {
    try {
      // Validate email address
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return {
          success: false,
          error: `Invalid email address: ${to}`,
        };
      }

      // Get template
      const template = emailTemplates[templateName];
      if (!template) {
        return {
          success: false,
          error: `Email template not found: ${templateName}`,
        };
      }

      // Render templates with variables
      const subject = this.renderTemplate(template.subject, variables);
      const html = this.renderTemplate(template.htmlTemplate, variables);
      const text = template.textTemplate
        ? this.renderTemplate(template.textTemplate, variables)
        : undefined;

      // Send via Resend
      const response = await resend.emails.send({
        from: "noreply@dpines.ng",
        to,
        subject,
        html,
        text,
      });

      if (response.error) {
        console.error(`Failed to send email to ${to}:`, response.error);
        return {
          success: false,
          error: response.error.message,
        };
      }

      console.log(`✓ Email sent to ${to} (ID: ${response.data?.id})`);

      return {
        success: true,
        messageId: response.data?.id,
      };
    } catch (error) {
      console.error("Email send error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // Send email with retry logic
  async sendEmailWithRetry(
    to: string,
    templateName: string,
    variables: Record<string, any>,
    maxRetries: number = 3
  ): Promise<SendEmailResult> {
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.sendEmail(to, templateName, variables);

      if (result.success) {
        return result;
      }

      lastError = result.error;

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return {
      success: false,
      error: `Failed after ${maxRetries} retries: ${lastError}`,
    };
  }

  // Send bulk emails
  async sendBulkEmails(
    recipients: Array<{ email: string; variables: Record<string, any> }>,
    templateName: string
  ): Promise<{ sent: number; failed: number; errors: Array<{ email: string; error: string }> }> {
    const results = {
      sent: 0,
      failed: 0,
      errors: [] as Array<{ email: string; error: string }>,
    };

    for (const recipient of recipients) {
      const result = await this.sendEmail(recipient.email, templateName, recipient.variables);

      if (result.success) {
        results.sent++;
      } else {
        results.failed++;
        results.errors.push({
          email: recipient.email,
          error: result.error || "Unknown error",
        });
      }
    }

    return results;
  }

  // Get available templates
  getAvailableTemplates(): string[] {
    return Object.keys(emailTemplates);
  }

  // Check if template exists
  templateExists(templateName: string): boolean {
    return templateName in emailTemplates;
  }
}

export default new EmailService();

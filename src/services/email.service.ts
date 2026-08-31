// Email Service - Phase 5.2 - Handles email delivery via Resend - Features: - - Email template rendering - - Variable substitution - - HTML and plain text support - - Retry logic - - Delivery tracking

import { edgeFunctionService } from "./edge-function.service.js";

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

const emailTemplates: Record<string, EmailTemplate> = {
  loan_payment_reminder: {
    subject: "Your DPINES Loan Payment is Due Soon",
    htmlTemplate: "Hello {{firstName}},\n\nThis is a friendly reminder that your loan payment of ₦{{amountDue}} is due in {{daysUntilDue}} day(s).\n\nPlease ensure payment is made by your due date to avoid late charges.",
  },
  loan_payment_received: {
    subject: "Your DPINES Loan Payment has been Received",
    htmlTemplate: "Hello {{firstName}},\n\nYour loan payment of ₦{{amountPaid}} has been successfully received.\n\nThank you for your timely payment.",
  },
  late_fee_charged: {
    subject: "Late Fee Applied to Your DPINES Loan",
    htmlTemplate: "Hello {{firstName}},\n\nA late fee of ₦{{feeAmount}} has been applied to your loan account due to a missed payment.\n\nPlease settle this immediately to avoid loan default status.",
  },
  investment_maturity_alert: {
    subject: "Your DPINES Investment has Matured",
    htmlTemplate: "Hello {{firstName}},\n\nCongratulations! Your investment has reached maturity. Current Value: ₦{{currentValue}}.\n\nYour current selection is set to: {{maturityAction}}.\n\nLog in to your DPINES account to manage your investment.",
  },
  withdrawal_confirmation: {
    subject: "Your DPINES Withdrawal has been Processed",
    htmlTemplate: "Hello {{firstName}},\n\nYour investment withdrawal of ₦{{withdrawalAmount}} has been successfully processed.\n\nThe funds should appear in your account within 1-2 business days.",
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

      // Send via Edge Function
      const response = await edgeFunctionService.callFunction("send-communication", {
        to,
        subject,
        body: html,
        html: html, // Pass both text body and raw HTML for flexibility
        text: text,
      });

      if (!response) {
        const errorMsg = `Failed to send email to ${to} via Edge Function (null response)`;
        console.error(`[EMAIL ERROR] ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
        };
      }

      if (response.error) {
        const errorMsg = `Edge function error: ${response.error}`;
        console.error(`[EMAIL ERROR] ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
        };
      }

      console.log(`✓ Email sent successfully to ${to}`);

      return {
        success: true,
        messageId: response.id || "edge_func_success",
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

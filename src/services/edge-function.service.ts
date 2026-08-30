import { env } from "../configs/env.js";

export class EdgeFunctionService {
  private getHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    };
  }

  async callFunction(functionName: string, payload: Record<string, any>): Promise<any> {
    try {
      const url = `${env.SUPABASE_URL}/functions/v1/${functionName}`;
      console.log(`[EDGE FUNCTION] Triggering ${functionName}...`);
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`[EDGE FUNCTION ERROR] ${functionName} responded with status: ${response.status}`);
        return null;
      }

      return await response.json().catch(() => null);
    } catch (error: any) {
      console.error(`[EDGE FUNCTION ERROR] Failed to call ${functionName}:`, error.message);
      // We do not throw so that it doesn't break main transaction execution if email/notification service fails
      return null;
    }
  }

  // Welcome Email
  async sendWelcomeEmail(email: string, firstName: string, lastName: string) {
    return this.callFunction("send-welcome-email", {
      to: email,
      firstName,
      lastName,
    });
  }

  // Loan Approval Confirmation
  async sendLoanApprovedEmail(to: string, firstName: string, amount: number, loanId: string, monthlyPayment: number, termMonths: number) {
    return this.callFunction("send-loan-approved-email", {
      to,
      firstName,
      amount,
      loanId,
      monthlyPayment,
      termMonths,
    });
  }

  // Repayment Processed Email
  async sendRepaymentProcessedEmail(to: string, firstName: string, amount: number, paymentMonth: number, loanId: string, remainingPrincipal: number) {
    return this.callFunction("send-communication", {
      to,
      subject: `Repayment Processed - Month ${paymentMonth}`,
      body: `Hello ${firstName},\n\nYour repayment of ₦${amount} for Month ${paymentMonth} (Loan #${loanId}) has been successfully processed.\n\nRemaining Balance: ₦${remainingPrincipal}\n\nThank you.`,
    });
  }

  // Admin Notification on maturity action
  async notifyAdminMaturityAction(investmentId: string, userName: string, action: string, amount: number) {
    return this.callFunction("send-admin-notification", {
      type: "maturity_action_selected",
      payload: {
        investment_id: investmentId,
        user_name: userName,
        action,
        amount,
      },
    });
  }

  // Investment Top-Up Confirmation Email
  async sendInvestmentTopUpEmail(to: string, firstName: string, amount: number, newBalance: number, investmentId: string) {
    return this.callFunction("send-communication", {
      to,
      subject: "Investment Top-Up Successful",
      body: `Hello ${firstName},\n\nYour top-up of ₦${amount} for Investment #${investmentId} has been successfully processed.\n\nYour new investment balance is ₦${newBalance}.\n\nThank you for investing with DPINES.`,
    });
  }

  // Investment Rollover Confirmation Email
  async sendInvestmentRolloverEmail(to: string, firstName: string, amount: number, termMonths: number, investmentId: string) {
    return this.callFunction("send-communication", {
      to,
      subject: "Investment Rollover Confirmed",
      body: `Hello ${firstName},\n\nYour matured investment #${investmentId} has been successfully rolled over for another term of ${termMonths} months with a starting principal of ₦${amount}.\n\nThank you for choosing DPINES.`,
    });
  }
}

export const edgeFunctionService = new EdgeFunctionService();

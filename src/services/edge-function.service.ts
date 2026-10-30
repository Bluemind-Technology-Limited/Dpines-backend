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
      console.log(`[EDGE FUNCTION] URL: ${url}`);
      console.log(`[EDGE FUNCTION] Payload:`, JSON.stringify(payload, null, 2));
      
      const response = (await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      })) as any;

      console.log(`[EDGE FUNCTION] Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[EDGE FUNCTION ERROR] ${functionName} responded with status: ${response.status}`);
        console.error(`[EDGE FUNCTION ERROR] Response body:`, errorText);
        throw new Error(`Edge function ${functionName} failed with status ${response.status}: ${errorText}`);
      }

      const responseData = await response.json().catch(() => null);
      console.log(`[EDGE FUNCTION] Response data:`, responseData);
      return responseData;
    } catch (error: any) {
      console.error(`[EDGE FUNCTION ERROR] Failed to call ${functionName}:`, error.message);
      console.error(`[EDGE FUNCTION ERROR] Full error:`, error);
      throw error;  // Throw so caller can handle it
    }
  }

  // Welcome Email
  async sendWelcomeEmail(email: string, firstName: string, lastName: string) {
    return this.callFunction("send-welcome-email", {
      email,
      first_name: firstName,
      last_name: lastName,
    });
  }

  // Loan Approval Confirmation
  // The edge function reads snake_case fields, so map them explicitly.
  async sendLoanApprovedEmail(params: {
    to: string;
    userName: string;
    loanId: string;
    amount: number;
    interestRate: number;
    termMonths: number;
    monthlyPayment: number;
    totalInterest: number;
    startDate: string;
    endDate: string;
  }) {
    return this.callFunction("send-loan-approved-email", {
      loan_id: params.loanId,
      user_email: params.to,
      user_name: params.userName,
      loan_amount: params.amount,
      interest_rate: params.interestRate,
      term_months: params.termMonths,
      monthly_payment: params.monthlyPayment,
      total_interest: params.totalInterest,
      start_date: params.startDate,
      end_date: params.endDate,
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

  // Loan Rejection Email
  async sendLoanRejectedEmail(params: {
    to: string;
    userName: string;
    loanId: string;
    rejectionReason: string;
    amount?: number;
    monthlyPayment?: number;
    termMonths?: number;
  }) {
    return this.callFunction("send-loan-rejected-email", {
      loan_id: params.loanId,
      user_email: params.to,
      user_name: params.userName,
      rejection_reason: params.rejectionReason,
      loan_amount: params.amount,
      monthly_payment: params.monthlyPayment,
      term_months: params.termMonths,
    });
  }

  // Investment Approval Email
  async sendInvestmentApprovedEmail(params: {
    to: string;
    userName: string;
    investmentId: string;
    amount: number;
    interestRate: number;
    termMonths: number;
    payoutFrequency: string;
    startDate: string;
    endDate: string;
    currentValue?: number;
  }) {
    return this.callFunction("send-investment-approved-email", {
      investment_id: params.investmentId,
      user_email: params.to,
      user_name: params.userName,
      amount: params.amount,
      interest_rate: params.interestRate,
      term_months: params.termMonths,
      payout_frequency: params.payoutFrequency,
      start_date: params.startDate,
      end_date: params.endDate,
      current_value: params.currentValue,
    });
  }

  // Investment Rejection Email
  async sendInvestmentRejectedEmail(params: {
    to: string;
    userName: string;
    investmentId: string;
    rejectionReason: string;
    amount?: number;
    termMonths?: number;
  }) {
    return this.callFunction("send-investment-rejected-email", {
      investment_id: params.investmentId,
      user_email: params.to,
      user_name: params.userName,
      rejection_reason: params.rejectionReason,
      amount: params.amount,
      term_months: params.termMonths,
    });
  }

  // Investment Payout Notification Email
  async sendPayoutNotificationEmail(
    to: string,
    firstName: string,
    payoutNumber: number,
    payoutAmount: number,
    payoutDate: string,
    currentValue: number,
    investmentId: string,
    isReinvestment: boolean = false
  ) {
    const payoutType = isReinvestment ? "reinvested" : "credited to your account";
    const formattedDate = new Date(payoutDate).toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    return this.callFunction("send-communication", {
      to,
      subject: `Investment Payout #${payoutNumber} - ₦${payoutAmount.toLocaleString()}`,
      body: `Hello ${firstName},\n\nYour payout for Investment #${investmentId} has been processed.\n\nPayout Details:\n• Payout Number: ${payoutNumber}\n• Amount: ₦${payoutAmount.toLocaleString()}\n• Date: ${formattedDate}\n• Type: ${payoutType}\n• Current Investment Value: ₦${currentValue.toLocaleString()}\n\nThank you for investing with DPINES.`,
    });
  }
}

export const edgeFunctionService = new EdgeFunctionService();

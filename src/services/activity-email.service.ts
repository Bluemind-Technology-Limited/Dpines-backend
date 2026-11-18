// Activity email service
//
// Every money-moving action on a contribution is emailed to BOTH the affected
// contributor and the admins. That gives each side an independent trail:
// the user learns what changed on their account, and the admin team keeps a
// record of who did what, when, and why.
//
// Sending is best-effort by design: mail failures are logged and swallowed so a
// Resend / edge-function outage can never roll back or block a financial
// operation that has already been committed to the ledger.

import prisma from "../configs/database.js";
import { edgeFunctionService } from "./edge-function.service.js";
import { formatCurrency } from "../lib/utils.js";

// Roles that receive the operational copies.
const ADMIN_ROLES = ["admin", "loans_admin", "invest_admin"] as const;

interface AdminRecipient {
  id: string;
  email: string;
  firstName: string | null;
}

interface Contributor {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

interface ActorInfo {
  id: string;
  name: string;
  email: string | null;
}

const shortRef = (id: string) => `#${id.slice(-6)}`;

const fullName = (user?: Contributor | null): string => {
  const name = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
  return name || "Contributor";
};

const today = () =>
  new Date().toLocaleDateString("en-NG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const currency = (amount: number) => formatCurrency(Number(amount) || 0);

class ActivityEmailService {
  // ---- recipients -------------------------------------------------------

  private async getAdminRecipients(excludeUserId?: string | null): Promise<AdminRecipient[]> {
    try {
      const admins: Array<{ id: string; email: string | null; first_name: string | null }> =
        await prisma.userProfile.findMany({
          where: {
            role: { in: ADMIN_ROLES as unknown as any },
            users: { deleted_at: null },
          },
          select: { id: true, email: true, first_name: true },
        });

      const seen = new Set<string>();
      const recipients: AdminRecipient[] = [];

      for (const admin of admins) {
        if (!admin.email) continue;
        if (excludeUserId && admin.id === excludeUserId) continue;
        if (seen.has(admin.email)) continue;
        seen.add(admin.email);
        recipients.push({ id: admin.id, email: admin.email, firstName: admin.first_name });
      }

      return recipients;
    } catch (error) {
      console.error("[ACTIVITY EMAIL] Failed to load admin recipients:", error);
      return [];
    }
  }

  // Resolves the admin who performed the action so the copy can name them.
  private async resolveActor(adminId?: string | null): Promise<ActorInfo | null> {
    if (!adminId) return null;
    try {
      const admin = await prisma.userProfile.findUnique({
        where: { id: adminId },
        select: { id: true, email: true, first_name: true, last_name: true },
      });
      if (!admin) return null;
      return {
        id: admin.id,
        email: admin.email ?? null,
        name: `${admin.first_name || ""} ${admin.last_name || ""}`.trim() || "An administrator",
      };
    } catch (error) {
      console.error("[ACTIVITY EMAIL] Failed to resolve admin:", error);
      return null;
    }
  }

  // ---- delivery ---------------------------------------------------------

  private async send(to: string, subject: string, body: string): Promise<void> {
    try {
      await edgeFunctionService.callFunction("send-communication", {
        to,
        subject,
        body,
      });
    } catch (error) {
      console.error(`[ACTIVITY EMAIL] Failed to send "${subject}" to ${to}:`, error);
    }
  }

  private async sendToUser(user: Contributor | null | undefined, subject: string, body: string) {
    if (!user?.email) return;
    await this.send(user.email, subject, body);
  }

  private async sendToAdmins(subject: string, body: string, excludeUserId?: string | null) {
    const recipients = await this.getAdminRecipients(excludeUserId);
    await Promise.all(recipients.map((admin) => this.send(admin.email, subject, body)));
  }

  // ---- manual deduction -------------------------------------------------

  // Admin removed funds from a contribution (fees, charges, corrections, ...).
  async manualDeduction(params: {
    investmentId: string;
    contributor: Contributor | null | undefined;
    amount: number;
    purpose: string;
    remainingValue: number;
    adminId?: string | null;
  }): Promise<void> {
    try {
      const { investmentId, contributor, amount, purpose, remainingValue, adminId } = params;
      const actor = await this.resolveActor(adminId);
      const ref = shortRef(investmentId);
      const who = fullName(contributor);

      const userBody = [
        `Hello ${contributor?.firstName || "there"},`,
        "",
        "A deduction has been applied to your DPINES contribution.",
        "",
        `Contribution: ${ref}`,
        `Amount deducted: ${currency(amount)}`,
        `Reason: ${purpose}`,
        `Remaining value: ${currency(remainingValue)}`,
        `Date: ${today()}`,
        "",
        "If you were not expecting this adjustment, please contact the DPINES support team.",
      ].join("\n");

      const adminBody = [
        "A manual deduction was processed on DPINES.",
        "",
        `Contributor: ${who}${contributor?.email ? ` (${contributor.email})` : ""}`,
        `Contribution: ${ref} — ${investmentId}`,
        `Amount deducted: ${currency(amount)}`,
        `Reason: ${purpose}`,
        `Remaining value: ${currency(remainingValue)}`,
        `Processed by: ${actor?.name || "An administrator"}`,
        `Date: ${today()}`,
      ].join("\n");

      await Promise.all([
        this.sendToUser(
          contributor,
          `Deduction of ${currency(amount)} applied to your contribution ${ref}`,
          userBody
        ),
        this.sendToAdmins(
          `Manual deduction: ${currency(amount)} from contribution ${ref}`,
          adminBody
        ),
      ]);
    } catch (error) {
      console.error("[ACTIVITY EMAIL] manualDeduction failed:", error);
    }
  }

  // ---- investment top-ups ----------------------------------------------

  // A top-up request was submitted (by the contributor or by an admin on
  // their behalf) and is now awaiting review.
  async topUpRequested(params: {
    investmentId: string;
    topUpId: string;
    contributor: Contributor | null | undefined;
    amount: number;
    tenureLabel: string;
    hasReceipt: boolean;
    requestedByAdminId?: string | null;
  }): Promise<void> {
    try {
      const { investmentId, topUpId, contributor, amount, tenureLabel, hasReceipt, requestedByAdminId } = params;
      const actor = await this.resolveActor(requestedByAdminId);
      const ref = shortRef(investmentId);
      const who = fullName(contributor);

      const userBody = [
        `Hello ${contributor?.firstName || "there"},`,
        "",
        "We have received your top-up request for your DPINES contribution.",
        "",
        `Contribution: ${ref}`,
        `Amount: ${currency(amount)}`,
        `Tenure: ${tenureLabel}`,
        `Receipt: ${hasReceipt ? "attached" : "not attached"}`,
        `Status: Awaiting admin approval`,
        `Request reference: ${shortRef(topUpId)}`,
        ...(actor ? ["", `Submitted on your behalf by ${actor.name}.`] : []),
        "",
        "You will receive another email as soon as the request is reviewed.",
      ].join("\n");

      const adminBody = [
        "A new contribution top-up request is awaiting review.",
        "",
        `Contributor: ${who}${contributor?.email ? ` (${contributor.email})` : ""}`,
        `Contribution: ${ref} — ${investmentId}`,
        `Amount: ${currency(amount)}`,
        `Tenure: ${tenureLabel}`,
        `Receipt: ${hasReceipt ? "attached" : "not attached"}`,
        `Request reference: ${shortRef(topUpId)}`,
        `Submitted: ${today()}`,
        ...(actor ? [`Submitted by: ${actor.name}`] : []),
        "",
        "Open the Top-Up Requests queue in the admin dashboard to approve or decline it.",
      ].join("\n");

      await Promise.all([
        this.sendToUser(
          contributor,
          `Top-up request received — ${currency(amount)} (contribution ${ref})`,
          userBody
        ),
        this.sendToAdmins(
          `New top-up request: ${currency(amount)} (contribution ${ref})`,
          adminBody
        ),
      ]);
    } catch (error) {
      console.error("[ACTIVITY EMAIL] topUpRequested failed:", error);
    }
  }

  // A top-up was approved and applied to the contribution.
  async topUpApproved(params: {
    investmentId: string;
    topUpId: string;
    contributor: Contributor | null | undefined;
    amount: number;
    newPrincipal: number;
    tenureLabel: string;
    newEndDate?: Date | string | null;
    approvedByAdminId?: string | null;
  }): Promise<void> {
    try {
      const { investmentId, topUpId, contributor, amount, newPrincipal, tenureLabel, newEndDate, approvedByAdminId } = params;
      const actor = await this.resolveActor(approvedByAdminId);
      const ref = shortRef(investmentId);
      const who = fullName(contributor);
      const endDate = newEndDate
        ? new Date(newEndDate).toLocaleDateString("en-NG", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : null;

      const details = [
        `Contribution: ${ref}`,
        `Amount applied: ${currency(amount)}`,
        `New principal: ${currency(newPrincipal)}`,
        `Tenure: ${tenureLabel}`,
        ...(endDate ? [`Maturity date: ${endDate}`] : []),
        `Request reference: ${shortRef(topUpId)}`,
      ];

      const userBody = [
        `Hello ${contributor?.firstName || "there"},`,
        "",
        "Good news — your top-up has been approved and applied to your contribution.",
        "",
        ...details,
        `Date: ${today()}`,
        "",
        "Thank you for investing with DPINES.",
      ].join("\n");

      const adminBody = [
        "A contribution top-up has been approved and applied.",
        "",
        `Contributor: ${who}${contributor?.email ? ` (${contributor.email})` : ""}`,
        ...details,
        `Approved by: ${actor?.name || "An administrator"}`,
        `Date: ${today()}`,
      ].join("\n");

      await Promise.all([
        this.sendToUser(
          contributor,
          `Top-up approved — ${currency(amount)} added to contribution ${ref}`,
          userBody
        ),
        this.sendToAdmins(
          `Top-up approved: ${currency(amount)} (contribution ${ref})`,
          adminBody
        ),
      ]);
    } catch (error) {
      console.error("[ACTIVITY EMAIL] topUpApproved failed:", error);
    }
  }

  // A top-up request was declined.
  async topUpRejected(params: {
    investmentId: string;
    topUpId: string;
    contributor: Contributor | null | undefined;
    amount: number;
    reason: string;
    reviewedByAdminId?: string | null;
  }): Promise<void> {
    try {
      const { investmentId, topUpId, contributor, amount, reason, reviewedByAdminId } = params;
      const actor = await this.resolveActor(reviewedByAdminId);
      const ref = shortRef(investmentId);
      const who = fullName(contributor);

      const userBody = [
        `Hello ${contributor?.firstName || "there"},`,
        "",
        "Your top-up request was not approved, so no funds have been added to your contribution.",
        "",
        `Contribution: ${ref}`,
        `Amount requested: ${currency(amount)}`,
        `Reason: ${reason || "No reason was provided"}`,
        `Request reference: ${shortRef(topUpId)}`,
        `Date: ${today()}`,
        "",
        "If you have questions, please contact the DPINES support team.",
      ].join("\n");

      const adminBody = [
        "A contribution top-up request was declined.",
        "",
        `Contributor: ${who}${contributor?.email ? ` (${contributor.email})` : ""}`,
        `Contribution: ${ref} — ${investmentId}`,
        `Amount requested: ${currency(amount)}`,
        `Reason: ${reason || "No reason provided"}`,
        `Request reference: ${shortRef(topUpId)}`,
        `Reviewed by: ${actor?.name || "An administrator"}`,
        `Date: ${today()}`,
      ].join("\n");

      await Promise.all([
        this.sendToUser(
          contributor,
          `Top-up request declined — ${currency(amount)} (contribution ${ref})`,
          userBody
        ),
        this.sendToAdmins(
          `Top-up declined: ${currency(amount)} (contribution ${ref})`,
          adminBody
        ),
      ]);
    } catch (error) {
      console.error("[ACTIVITY EMAIL] topUpRejected failed:", error);
    }
  }
}

export const activityEmailService = new ActivityEmailService();
export default activityEmailService;

import prisma from "../../configs/database.js";
import { AppError } from "../../middlewares/error.middleware.js";
import notificationService from "../notifications/notification.service.js";
import { edgeFunctionService } from "../../services/edge-function.service.js";

export class CommunicationsService {
  async getTemplates() {
    try {
      const templates = await prisma.communication_templates.findMany({
        orderBy: { created_at: "desc" },
      });
      return templates;
    } catch (error) {
      throw new AppError(500, "Failed to fetch communication templates");
    }
  }

  async getTemplateById(id: string) {
    try {
      const template = await prisma.communication_templates.findUnique({
        where: { id },
      });
      return template;
    } catch (error) {
      throw new AppError(500, "Failed to fetch template");
    }
  }

  async createTemplate(
    name: string,
    subject: string,
    body: string,
    type: string,
    isActive: boolean = true
  ) {
    try {
      const existing = await prisma.communication_templates.findUnique({
        where: { name },
      });
      if (existing) {
        throw new AppError(400, `Template with name "${name}" already exists`);
      }

      const template = await prisma.communication_templates.create({
        data: {
          name,
          subject,
          body,
          type,
          is_active: isActive,
        },
      });
      return template;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to create template");
    }
  }

  async updateTemplate(id: string, data: { name?: string; subject?: string; body?: string; type?: string; isActive?: boolean }) {
    try {
      const existing = await prisma.communication_templates.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new AppError(404, "Template not found");
      }

      if (data.name && data.name !== existing.name) {
        const dup = await prisma.communication_templates.findUnique({
          where: { name: data.name },
        });
        if (dup) {
          throw new AppError(400, `Template with name "${data.name}" already exists`);
        }
      }

      const updated = await prisma.communication_templates.update({
        where: { id },
        data: {
          name: data.name,
          subject: data.subject,
          body: data.body,
          type: data.type,
          is_active: data.isActive,
        },
      });
      return updated;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update template");
    }
  }

  async deleteTemplate(id: string) {
    try {
      const existing = await prisma.communication_templates.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new AppError(404, "Template not found");
      }

      await prisma.communication_templates.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to delete template");
    }
  }

  async sendCommunication(
    userIds: string[] | undefined,
    _templateId: string | undefined,
    type: string | undefined,
    subject: string,
    body: string,
    to?: string
  ) {
    try {
      if (!subject || !body) {
        throw new AppError(400, "subject and body are required");
      }

      // The admin UI sends a single email recipient (`to`); the bulk API sends
      // `userIds`. Support both. Missing `type` defaults to email.
      const channel = type || "email";

      const results: Array<{ userId: string; success: boolean; error?: string }> = [];
      const recipients: any[] = [];

      for (const userId of Array.isArray(userIds) ? userIds : []) {
        const user = await prisma.userProfile.findUnique({
          where: { id: userId },
        });
        if (!user) {
          results.push({ userId, success: false, error: "User profile not found" });
          continue;
        }
        recipients.push(user);
      }

      if (to) {
        const user = await prisma.userProfile.findUnique({ where: { email: to } });
        if (!user) {
          results.push({ userId: to, success: false, error: "User profile not found" });
        } else {
          recipients.push(user);
        }
      }

      if (recipients.length === 0 && results.length === 0) {
        throw new AppError(400, "Provide at least one recipient (userIds or to)");
      }

      for (const user of recipients) {
        try {
          const userFirstName = user.first_name || "";
          const userLastName = user.last_name || "";
          const userFullName = `${userFirstName} ${userLastName}`.trim();
          const customize = (text: string) =>
            text
              .replace(/{{firstName}}/g, userFirstName)
              .replace(/{{lastName}}/g, userLastName)
              .replace(/{{fullName}}/g, userFullName);

          const customizedSubject = customize(subject);
          const customizedBody = customize(body);

          if (channel === "email") {
            if (!user.email) {
              throw new Error("User has no email address");
            }
            // Route through the Supabase edge function — the Resend credentials
            // live on Supabase (edge function secrets), not in the Express env.
            await edgeFunctionService.callFunction("send-communication", {
              to: user.email,
              subject: customizedSubject,
              body: customizedBody,
            });
          } else {
            await notificationService.createNotification({
              userId: user.id,
              title: customizedSubject,
              message: customizedBody,
              type: "system_alert",
              channels: ["in_app"],
            });
          }

          results.push({ userId: user.id, success: true });
        } catch (err: any) {
          results.push({ userId: user.id, success: false, error: err?.message || "Failed delivery" });
        }
      }

      return results;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to send communications");
    }
  }
}

export const communicationsService = new CommunicationsService();
export default communicationsService;

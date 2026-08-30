import prisma from "../../configs/database.js";
import { AppError } from "../../middlewares/error.middleware.js";
import notificationService from "../notifications/notification.service.js";

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
    userIds: string[],
    _templateId: string | undefined,
    type: string,
    subject: string,
    body: string
  ) {
    try {
      const results = [];

      for (const userId of userIds) {
        const user = await prisma.userProfile.findUnique({
          where: { id: userId },
        });

        if (!user) {
          results.push({ userId, success: false, error: "User profile not found" });
          continue;
        }

        try {
          if (type === "email") {
            const userFirstName = user.first_name || "";
            const userLastName = user.last_name || "";
            const userFullName = `${userFirstName} ${userLastName}`.trim();
            const customizedSubject = subject.replace(/{{firstName}}/g, userFirstName).replace(/{{lastName}}/g, userLastName).replace(/{{fullName}}/g, userFullName);
            const customizedBody = body.replace(/{{firstName}}/g, userFirstName).replace(/{{lastName}}/g, userLastName).replace(/{{fullName}}/g, userFullName);

            const resendApiKey = process.env.RESEND_API_KEY;
            if (resendApiKey && user.email) {
              const { Resend } = await import("resend");
              const resend = new Resend(resendApiKey);
              await resend.emails.send({
                from: "DPINES <noreply@dpines.ng>",
                to: user.email,
                subject: customizedSubject,
                html: customizedBody.replace(/\n/g, "<br/>"),
                text: customizedBody,
              });
            }
          } else {
            const userFirstName = user.first_name || "";
            const userLastName = user.last_name || "";
            const userFullName = `${userFirstName} ${userLastName}`.trim();
            const customizedSubject = subject.replace(/{{firstName}}/g, userFirstName).replace(/{{lastName}}/g, userLastName).replace(/{{fullName}}/g, userFullName);
            const customizedBody = body.replace(/{{firstName}}/g, userFirstName).replace(/{{lastName}}/g, userLastName).replace(/{{fullName}}/g, userFullName);

            await notificationService.createNotification({
              userId,
              title: customizedSubject,
              message: customizedBody,
              type: "system_alert",
              channels: ["in_app"],
            });
          }

          results.push({ userId, success: true });
        } catch (err: any) {
          results.push({ userId, success: false, error: err.message || "Failed delivery" });
        }
      }

      return results;
    } catch (error) {
      throw new AppError(500, "Failed to send communications");
    }
  }
}

export const communicationsService = new CommunicationsService();
export default communicationsService;

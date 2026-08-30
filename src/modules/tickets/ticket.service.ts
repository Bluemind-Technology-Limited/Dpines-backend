import prisma from "../../configs/database.js";
import { AppError } from "../../middlewares/error.middleware.js";
import type { Ticket } from "../../types/index.js";

export class TicketService {
  async createTicket(
    userId: string,
    subject: string,
    description: string,
    priority?: string
  ): Promise<Ticket> {
    try {
      const ticket = await prisma.ticket.create({
        data: {
          user_id: userId,
          subject,
          description,
          priority: priority || "medium",
          status: "open",
        },
      });

      return ticket;
    } catch (error) {
      throw new AppError(500, "Failed to create ticket");
    }
  }

  async getTicketById(ticketId: string) {
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: {
          ticket_messages: {
            orderBy: { created_at: "asc" },
          },
          user_profiles: true,
        },
      });

      if (!ticket) {
        throw new AppError(404, "Ticket not found");
      }

      return ticket;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to fetch ticket");
    }
  }

  async getUserTickets(userId: string, status?: string) {
    try {
      const where: any = { user_id: userId };
      if (status) {
        where.status = status;
      }

      const tickets = await prisma.ticket.findMany({
        where,
        include: {
          ticket_messages: true,
          user_profiles: true,
        },
        orderBy: {
          created_at: "desc",
        },
      });

      return tickets;
    } catch (error) {
      throw new AppError(500, "Failed to fetch user tickets");
    }
  }

  async getAllTickets(status?: string, skip: number = 0, take: number = 10) {
    try {
      const where: any = {};
      if (status) {
        where.status = status;
      }

      const [tickets, total] = await Promise.all([
        prisma.ticket.findMany({
          where,
          include: {
            user_profiles: true,
            ticket_messages: true,
          },
          skip,
          take,
          orderBy: {
            created_at: "desc",
          },
        }),
        prisma.ticket.count({ where }),
      ]);

      return { tickets, total };
    } catch (error) {
      throw new AppError(500, "Failed to fetch tickets");
    }
  }

  async addMessage(
    ticketId: string,
    senderId: string,
    content: string,
    isAdminReply: boolean = false
  ): Promise<any> {
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
      });

      if (!ticket) {
        throw new AppError(404, "Ticket not found");
      }

      const message = await prisma.ticketMessage.create({
        data: {
          ticket_id: ticketId,
          sender_id: senderId,
          content,
          is_admin_reply: isAdminReply,
        },
      });

      return message;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to add message");
    }
  }

  async updateTicketStatus(ticketId: string, status: string): Promise<Ticket> {
    try {
      const ticket = await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          status,
          updated_at: new Date(),
        },
      });

      return ticket;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update ticket status");
    }
  }

  async updateTicketPriority(
    ticketId: string,
    priority: string
  ): Promise<Ticket> {
    try {
      const ticket = await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          priority,
          updated_at: new Date(),
        },
      });

      return ticket;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update ticket priority");
    }
  }

  async closeTicket(ticketId: string): Promise<Ticket> {
    try {
      return await this.updateTicketStatus(ticketId, "closed");
    } catch (error) {
      throw new AppError(500, "Failed to close ticket");
    }
  }
}

export const ticketService = new TicketService();

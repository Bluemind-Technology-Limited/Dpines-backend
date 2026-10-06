import { Request, Response } from "express";
import { ticketService } from "./ticket.service.js";
import { sendSuccess, sendPaginated, asyncHandler } from "../../lib/utils.js";
import { AppError } from "../../middlewares/error.middleware.js";
import {
  createTicketSchema,
  addTicketMessageSchema,
  updateTicketStatusSchema,
} from "../../lib/validators.js";

export const createTicket = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, "Unauthorized");
  }

  const body = createTicketSchema.parse(req.body);

  const ticket = await ticketService.createTicket(
    req.user.sub,
    body.subject,
    body.description,
    body.priority
  );

  sendSuccess(res, ticket, "Ticket created successfully", 201);
});

export const getTicketById = asyncHandler(async (req: Request, res: Response) => {
  const { ticketId } = req.params;

  const ticket = await ticketService.getTicketById(ticketId);

  sendSuccess(res, ticket, "Ticket fetched successfully");
});

export const getUserTickets = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const { status } = req.query;

    const tickets = await ticketService.getUserTickets(
      req.user.sub,
      status as any
    );

    sendSuccess(res, tickets, "User tickets fetched successfully");
  }
);

export const getAllTickets = asyncHandler(
  async (req: Request, res: Response) => {
    const status = req.query.status as string;
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 10);

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const { tickets, total } = await ticketService.getAllTickets(
      status as any,
      skip,
      take
    );

    sendPaginated(
      res,
      tickets,
      total,
      page,
      pageSize
    );
  }
);

export const addMessage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, "Unauthorized");
  }

  const { ticketId } = req.params;
  const body = addTicketMessageSchema.parse(req.body);

  // Check if user is admin for isAdminReply flag
  const user = await (await import("../../configs/database.js")).default.userProfile.findUnique({
    where: { id: req.user.sub },
  });

  const isAdminReply = user?.role !== "user";

  const message = await ticketService.addMessage(
    ticketId,
    req.user.sub,
    body.content,
    isAdminReply
  );

  sendSuccess(res, message, "Message added successfully", 201);
});

export const updateTicketStatus = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const { ticketId } = req.params;
    const body = updateTicketStatusSchema.parse(req.body);

    // Throws 404 if the ticket does not exist.
    const existing = await ticketService.getTicketById(ticketId);

    // Staff can change any ticket; a regular user may only change their own
    // (e.g. closing a resolved thread).
    const isStaff = req.user.role === "admin" || req.user.role === "support";
    const isOwner = existing.user_id === req.user.sub;

    if (!isStaff && !isOwner) {
      throw new AppError(403, "You do not have permission to update this ticket");
    }

    const ticket = await ticketService.updateTicketStatus(ticketId, body.status);

    sendSuccess(res, ticket, "Ticket status updated successfully");
  }
);

export const updateTicketPriority = asyncHandler(
  async (req: Request, res: Response) => {
    const { ticketId } = req.params;
    const { priority } = req.body;

    if (!priority) {
      throw new AppError(400, "Priority is required");
    }

    const ticket = await ticketService.updateTicketPriority(ticketId, priority);

    sendSuccess(res, ticket, "Ticket priority updated successfully");
  }
);

export const closeTicket = asyncHandler(async (req: Request, res: Response) => {
  const { ticketId } = req.params;

  const ticket = await ticketService.closeTicket(ticketId);

  sendSuccess(res, ticket, "Ticket closed successfully");
});

export const deleteTicket = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, "Unauthorized");
  }

  const { ticketId } = req.params;

  // Throws 404 if the ticket does not exist.
  const ticket = await ticketService.getTicketById(ticketId);

  // Staff can delete any ticket; a regular user may only delete their own.
  const isStaff = req.user.role === "admin" || req.user.role === "support";
  const isOwner = ticket.user_id === req.user.sub;

  if (!isStaff && !isOwner) {
    throw new AppError(403, "You do not have permission to delete this ticket");
  }

  await ticketService.deleteTicket(ticketId);

  sendSuccess(res, { id: ticketId }, "Ticket deleted successfully");
});

import { Router } from "express";
import {
  createTicket,
  getTicketById,
  getUserTickets,
  getAllTickets,
  addMessage,
  updateTicketStatus,
  updateTicketPriority,
  closeTicket,
  deleteTicket,
} from "./ticket.controller.js";
import { verifySupabaseToken, requireAuth, requireRole } from "../../middlewares/auth.middleware.js";

const router: Router = Router();

// Apply authentication middleware to all routes
router.use(verifySupabaseToken);
router.use(requireAuth);

// User routes
router.post("/", createTicket);
router.get("/user/my-tickets", getUserTickets);
router.get("/:ticketId", getTicketById);
router.post("/:ticketId/messages", addMessage);
router.post("/:ticketId/close", closeTicket);
// Deletion: staff may delete any ticket, a user may delete their own
// (ownership is enforced in the controller).
router.delete("/:ticketId", deleteTicket);

// Admin routes
router.get("/", requireRole(["admin", "support"]), getAllTickets);
// Status changes: staff can change any ticket, a user can close/reopen their
// own (ownership is enforced in the controller).
router.put("/:ticketId/status", updateTicketStatus);
router.put(
  "/:ticketId/priority",
  requireRole(["admin", "support"]),
  updateTicketPriority
);

export default router;

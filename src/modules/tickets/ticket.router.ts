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
} from "./ticket.controller";
import { verifySupabaseToken, requireAuth, requireRole } from "@/middlewares/auth.middleware";

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

// Admin routes
router.get("/", requireRole(["admin", "support"]), getAllTickets);
router.put(
  "/:ticketId/status",
  requireRole(["admin", "support"]),
  updateTicketStatus
);
router.put(
  "/:ticketId/priority",
  requireRole(["admin", "support"]),
  updateTicketPriority
);

export default router;

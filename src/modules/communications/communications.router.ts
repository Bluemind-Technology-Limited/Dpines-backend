import { Router } from "express";
import * as communicationsController from "./communications.controller";
import { authenticate, adminOnly } from "@/middlewares/auth.middleware";

const router: Router = Router();

// Retrieve all communication templates
router.get(
  "/templates",
  authenticate,
  communicationsController.getTemplates
);

// Create a new communication template
router.post(
  "/templates",
  authenticate,
  adminOnly,
  communicationsController.createTemplate
);

// Update a communication template by ID
router.put(
  "/templates/:id",
  authenticate,
  adminOnly,
  communicationsController.updateTemplate
);

// Delete a communication template by ID
router.delete(
  "/templates/:id",
  authenticate,
  adminOnly,
  communicationsController.deleteTemplate
);

// Bulk send communication to users
router.post(
  "/send",
  authenticate,
  adminOnly,
  communicationsController.sendCommunication
);

export default router;

import { Router, type Router as ExpressRouter } from "express";
import {
  createAdvert,
  getAdvertById,
  getAllAdverts,
  getActiveAdverts,
  updateAdvert,
  deleteAdvert,
  toggleAdvertActive,
} from "./advert.controller.js";
import { verifySupabaseToken, requireAuth, requireRole } from "../../middlewares/auth.middleware.js";

const router: ExpressRouter = Router();

// Public route - get active adverts
router.get("/active", getActiveAdverts);

// Protected routes
router.use(verifySupabaseToken);
router.use(requireAuth);

router.get("/", getAllAdverts);
router.get("/:advertId", getAdvertById);

// Admin routes
router.post("/", requireRole(["admin"]), createAdvert);
router.put("/:advertId", requireRole(["admin"]), updateAdvert);
router.delete("/:advertId", requireRole(["admin"]), deleteAdvert);
router.patch("/:advertId/toggle", requireRole(["admin"]), toggleAdvertActive);

export default router;

import { Request, Response } from "express";
import { communicationsService } from "./communications.service";
import { sendSuccess, asyncHandler } from "@/lib/utils";

export const getTemplates = asyncHandler(async (_req: Request, res: Response) => {
  const templates = await communicationsService.getTemplates();
  sendSuccess(res, templates, "Templates fetched successfully");
});

export const createTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { name, subject, body, type, isActive } = req.body;
  const template = await communicationsService.createTemplate(
    name,
    subject,
    body,
    type,
    isActive
  );
  sendSuccess(res, template, "Template created successfully", 201);
});

export const updateTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, subject, body, type, isActive } = req.body;
  const template = await communicationsService.updateTemplate(id, {
    name,
    subject,
    body,
    type,
    isActive,
  });
  sendSuccess(res, template, "Template updated successfully");
});

export const deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  await communicationsService.deleteTemplate(id);
  sendSuccess(res, null, "Template deleted successfully");
});

export const sendCommunication = asyncHandler(async (req: Request, res: Response) => {
  const { userIds, templateId, type, subject, body } = req.body;
  const results = await communicationsService.sendCommunication(
    userIds,
    templateId,
    type,
    subject,
    body
  );
  sendSuccess(res, results, "Communications processed");
});

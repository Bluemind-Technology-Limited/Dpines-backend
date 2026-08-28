import { Request, Response } from "express";
import { advertService } from "./advert.service";
import { sendSuccess, sendPaginated, asyncHandler } from "@/lib/utils";
import { AppError } from "@/middlewares/error.middleware";
import { createAdvertSchema, updateAdvertSchema } from "@/lib/validators";

export const createAdvert = asyncHandler(async (req: Request, res: Response) => {
  const body = createAdvertSchema.parse(req.body);

  const advert = await advertService.createAdvert(
    body.title,
    body.content,
    body.imageUrl,
    body.linkUrl,
    body.isActive
  );

  sendSuccess(res, advert, "Advert created successfully", 201);
});

export const getAdvertById = asyncHandler(async (req: Request, res: Response) => {
  const { advertId } = req.params;

  const advert = await advertService.getAdvertById(advertId);

  if (!advert) {
    throw new AppError(404, "Advert not found");
  }

  sendSuccess(res, advert, "Advert fetched successfully");
});

export const getAllAdverts = asyncHandler(
  async (req: Request, res: Response) => {
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 10);

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const { adverts, total } = await advertService.getAllAdverts(skip, take);

    sendPaginated(
      res,
      adverts,
      total,
      page,
      pageSize
    );
  }
);

export const getActiveAdverts = asyncHandler(
  async (_req: Request, res: Response) => {
    const adverts = await advertService.getActiveAdverts();

    sendSuccess(res, adverts, "Active adverts fetched successfully");
  }
);

export const updateAdvert = asyncHandler(async (req: Request, res: Response) => {
  const { advertId } = req.params;
  const body = updateAdvertSchema.parse(req.body);

  const advert = await advertService.updateAdvert(advertId, body);

  sendSuccess(res, advert, "Advert updated successfully");
});

export const deleteAdvert = asyncHandler(async (req: Request, res: Response) => {
  const { advertId } = req.params;

  const advert = await advertService.deleteAdvert(advertId);

  sendSuccess(res, advert, "Advert deleted successfully");
});

export const toggleAdvertActive = asyncHandler(
  async (req: Request, res: Response) => {
    const { advertId } = req.params;

    const advert = await advertService.toggleAdvertActive(advertId);

    sendSuccess(res, advert, "Advert toggled successfully");
  }
);

import prisma from "../../configs/database.js";
import { AppError } from "../../middlewares/error.middleware.js";
import type { Advert } from "../../types/index.js";

export class AdvertService {
  async createAdvert(
    title: string,
    content?: string,
    imageUrl?: string,
    _linkUrl?: string,
    isActive: boolean = true
  ): Promise<Advert> {
    try {
      const advert = await prisma.advert.create({
        data: {
          title,
          content,
          image_url: imageUrl,
          type: "banner",
          active: isActive,
        },
      });

      return advert;
    } catch (error) {
      throw new AppError(500, "Failed to create advert");
    }
  }

  async getAdvertById(advertId: string): Promise<Advert | null> {
    try {
      const advert = await prisma.advert.findUnique({
        where: { id: advertId },
      });

      return advert;
    } catch (error) {
      throw new AppError(500, "Failed to fetch advert");
    }
  }

  async getAllAdverts(skip: number = 0, take: number = 10) {
    try {
      const [adverts, total] = await Promise.all([
        prisma.advert.findMany({
          skip,
          take,
          orderBy: {
            created_at: "desc",
          },
        }),
        prisma.advert.count(),
      ]);

      return { adverts, total };
    } catch (error) {
      throw new AppError(500, "Failed to fetch adverts");
    }
  }

  async getActiveAdverts() {
    try {
      const adverts = await prisma.advert.findMany({
        where: { active: true },
        orderBy: {
          created_at: "desc",
        },
      });

      return adverts;
    } catch (error) {
      throw new AppError(500, "Failed to fetch active adverts");
    }
  }

  async updateAdvert(
    advertId: string,
    data: {
      title?: string;
      content?: string;
      imageUrl?: string;
      _linkUrl?: string;
      isActive?: boolean;
    }
  ): Promise<Advert> {
    try {
      const advert = await prisma.advert.update({
        where: { id: advertId },
        data: {
          title: data.title,
          content: data.content,
          image_url: data.imageUrl,
          active: data.isActive,
          updated_at: new Date(),
        },
      });

      return advert;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update advert");
    }
  }

  async deleteAdvert(advertId: string): Promise<Advert> {
    try {
      const advert = await prisma.advert.delete({
        where: { id: advertId },
      });

      return advert;
    } catch (error) {
      throw new AppError(500, "Failed to delete advert");
    }
  }

  async toggleAdvertActive(advertId: string): Promise<Advert> {
    try {
      const advert = await prisma.advert.findUnique({
        where: { id: advertId },
      });

      if (!advert) {
        throw new AppError(404, "Advert not found");
      }

      return await this.updateAdvert(advertId, {
        isActive: !advert.active,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to toggle advert");
    }
  }
}

export const advertService = new AdvertService();

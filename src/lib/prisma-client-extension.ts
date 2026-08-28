// Prisma Client Extension - Not currently used - Placeholder for future extension implementations

import { Prisma } from "@prisma/client";

// This extension file is kept for reference but not actively used
// The prisma-wrapper.ts provides direct aliasing instead

export function createPrismaExtension() {
  // Return empty extension
  return Prisma.defineExtension((client) =>
    client.$extends({
      // No extensions defined
    })
  );
}

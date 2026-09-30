import path from "path";
import { PrismaClient } from "@/generated/prisma/client";

// Prisma 6 new generator + Turbopack resolves import.meta.url to a virtual
// .next/ path, breaking relative SQLite path resolution. Anchor to process.cwd()
// so the path works regardless of bundle context.
function resolveDatasourceUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (url.startsWith("file:") && !path.isAbsolute(url.slice(5))) {
    return `file:${path.resolve(/*turbopackIgnore: true*/ process.cwd(), url.slice(5))}`;
  }
  return url;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
    datasourceUrl: resolveDatasourceUrl(),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

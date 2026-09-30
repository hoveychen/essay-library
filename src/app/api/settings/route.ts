import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { ensureAppConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const config = await ensureAppConfig();
  return NextResponse.json({
    ...config,
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
  });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as {
    ocrPrompt?: string;
    matchPrompt?: string;
    ocrModel?: string;
    matchModel?: string;
    scoringModel?: string;
    apiKey?: string;
  };

  // Persist API key to appDataDir/.env and update runtime env immediately
  if (body.apiKey !== undefined) {
    const appDataDir = process.env.APP_DATA_DIR;
    if (appDataDir) {
      const envPath = path.join(appDataDir, ".env");
      await writeFile(envPath, `OPENROUTER_API_KEY=${body.apiKey}\n`, "utf-8");
    }
    process.env.OPENROUTER_API_KEY = body.apiKey;
  }

  const config = await ensureAppConfig();
  const updated = await prisma.appConfig.update({
    where: { id: config.id },
    data: {
      ocrPrompt: body.ocrPrompt?.trim() || config.ocrPrompt,
      matchPrompt: body.matchPrompt?.trim() || config.matchPrompt,
      ocrModel: body.ocrModel?.trim() || config.ocrModel,
      matchModel: body.matchModel?.trim() || config.matchModel,
      scoringModel: body.scoringModel?.trim() || config.scoringModel,
    },
  });
  return NextResponse.json({
    ...updated,
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
  });
}

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { ensureAppConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";

// Never send the key itself to the browser; only a hint of its last 4 chars
function apiKeyFields() {
  const key = process.env.DEEPSEEK_API_KEY ?? "";
  return { apiKey: "", apiKeyHint: key ? `…${key.slice(-4)}` : "" };
}

export async function GET() {
  const config = await ensureAppConfig();
  return NextResponse.json({
    ...config,
    ...apiKeyFields(),
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

  // Persist API key to appDataDir/.env and update runtime env immediately.
  // An empty value means "keep the current key".
  if (body.apiKey?.trim()) {
    body.apiKey = body.apiKey.trim();
    const appDataDir = process.env.APP_DATA_DIR;
    if (appDataDir) {
      const envPath = path.join(appDataDir, ".env");
      await writeFile(envPath, `DEEPSEEK_API_KEY=${body.apiKey}\n`, "utf-8");
    }
    process.env.DEEPSEEK_API_KEY = body.apiKey;
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
    ...apiKeyFields(),
  });
}

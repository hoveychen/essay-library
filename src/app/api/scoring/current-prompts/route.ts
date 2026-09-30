import { NextResponse } from "next/server";
import { ensureAppConfig, getScoringPrompt, SCORING_DIMENSIONS, type ScoringDimensionKey } from "@/lib/config";

export const runtime = "nodejs";

export async function GET() {
  const config = await ensureAppConfig();
  const prompts: Record<string, string> = {};
  for (const dim of Object.keys(SCORING_DIMENSIONS) as ScoringDimensionKey[]) {
    prompts[dim] = getScoringPrompt(config, dim);
  }
  return NextResponse.json(prompts);
}

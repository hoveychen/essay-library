import { NextResponse } from "next/server";
import { SCORING_DIMENSIONS, type ScoringDimensionKey } from "@/lib/config";
import { scoreEssay } from "@/lib/scoring-ai";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const body = (await req.json()) as {
    dimension?: string;
    dimensions?: string[];
  };

  try {
    // Single dimension
    if (body.dimension) {
      if (!(body.dimension in SCORING_DIMENSIONS)) {
        return NextResponse.json(
          { error: `未知评分维度: ${body.dimension}` },
          { status: 400 },
        );
      }
      const result = await scoreEssay(id, body.dimension as ScoringDimensionKey);
      return NextResponse.json(result);
    }

    // Multiple specific dimensions, or all if not specified
    const dims = (body.dimensions || Object.keys(SCORING_DIMENSIONS)) as ScoringDimensionKey[];
    const results: Record<string, { score: number; brief: string; extra: string | null } | { error: string }> = {};
    for (const dim of dims) {
      if (!(dim in SCORING_DIMENSIONS)) {
        results[dim] = { error: `未知评分维度: ${dim}` };
        continue;
      }
      try {
        results[dim] = await scoreEssay(id, dim);
      } catch (e) {
        results[dim] = { error: e instanceof Error ? e.message : "评分失败" };
      }
    }
    return NextResponse.json(results);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "评分失败" },
      { status: 500 },
    );
  }
}

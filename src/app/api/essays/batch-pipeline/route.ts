import { NextResponse } from "next/server";
import { runMatchForEssay, runOcrForEssay } from "@/lib/essay-ai";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type BatchBody = {
  studentId?: string;
  onlyPending?: boolean;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as BatchBody;
  const onlyPending = body.onlyPending ?? true;

  const essays = await prisma.essay.findMany({
    where: body.studentId ? { studentId: body.studentId } : undefined,
    include: { images: true },
    orderBy: { createdAt: "asc" },
  });

  const candidates = essays.filter((essay) => {
    if (!essay.images.length) return false;
    if (!onlyPending) return true;
    return essay.matchStatus !== "CONFIRMED";
  });

  const results: Array<{
    essayId: string;
    ok: boolean;
    stage: "ocr" | "match";
    error?: string;
  }> = [];

  for (const essay of candidates) {
    try {
      if (!essay.rawText?.trim() || essay.ocrStatus !== "DONE") {
        await runOcrForEssay(essay.id);
      }
    } catch (error) {
      results.push({
        essayId: essay.id,
        ok: false,
        stage: "ocr",
        error: error instanceof Error ? error.message : "OCR失败",
      });
      continue;
    }

    try {
      await runMatchForEssay(essay.id);
      results.push({
        essayId: essay.id,
        ok: true,
        stage: "match",
      });
    } catch (error) {
      results.push({
        essayId: essay.id,
        ok: false,
        stage: "match",
        error: error instanceof Error ? error.message : "匹配失败",
      });
    }
  }

  const successCount = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({
    totalCandidates: candidates.length,
    successCount,
    failedCount: failed.length,
    failed,
  });
}

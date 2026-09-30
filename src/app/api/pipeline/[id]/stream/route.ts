import { prisma } from "@/lib/prisma";
import { runOcrForEssay, runMatchForEssay } from "@/lib/essay-ai";
import { scoreEssay } from "@/lib/scoring-ai";
import { SCORING_DIMENSIONS, type ScoringDimensionKey } from "@/lib/config";
import { withRetry } from "@/lib/retry";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;

  const encoder = new TextEncoder();
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;

  function emit(event: object) {
    try {
      ctrl?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      // client disconnected
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });

  (async () => {
    try {
      const job = await prisma.pipelineJob.findUnique({
        where: { id },
        include: {
          essay: {
            include: { images: true, matchedTopic: true, scoringResults: true },
          },
        },
      });

      if (!job) {
        emit({ type: "error", message: "任务不存在" });
        return;
      }

      if (job.status === "done") {
        emit({ type: "already_done" });
        return;
      }

      await prisma.pipelineJob.update({
        where: { id },
        data: { status: "running", errorMsg: null },
      });
      emit({ type: "state", status: "running" });

      const essay = job.essay;
      const allDimKeys = Object.keys(SCORING_DIMENSIONS) as ScoringDimensionKey[];

      // ── 阶段一：OCR ──────────────────────────────────────────────
      if (essay.ocrStatus !== "DONE") {
        emit({ type: "step", step: "ocr", status: "running" });
        await withRetry(
          async () => {
            await runOcrForEssay(essay.id, (progress) => {
              emit({ type: "ocr_phase", phase: progress.phase });
            });
          },
          {
            maxAttempts: 3,
            baseDelayMs: 3000,
            onRetry: (attempt, err) => {
              emit({
                type: "retry",
                step: "ocr",
                attempt,
                error: err.message,
              });
            },
          },
        );
        emit({ type: "step", step: "ocr", status: "done" });
      } else {
        emit({ type: "step", step: "ocr", status: "done", skipped: true });
      }

      // 重新加载，确保拿到最新的 rawText
      const essayAfterOcr = await prisma.essay.findUniqueOrThrow({
        where: { id: essay.id },
        include: { suggestedTopic: true, matchedTopic: true },
      });

      if (!essayAfterOcr.rawText?.trim()) {
        throw new Error("OCR 未能识别出文字，请检查图片质量后重试");
      }

      // ── 阶段二：题目匹配 ─────────────────────────────────────────
      if (essayAfterOcr.matchStatus !== "CONFIRMED") {
        emit({ type: "step", step: "match", status: "running" });

        let topicTitle: string | null = null;
        await withRetry(
          async () => {
            const updated = await runMatchForEssay(essay.id);
            if (updated.suggestedTopicId) {
              await prisma.essay.update({
                where: { id: essay.id },
                data: {
                  matchedTopicId: updated.suggestedTopicId,
                  matchStatus: "CONFIRMED",
                },
              });
              topicTitle = updated.suggestedTopic?.title ?? null;
            }
          },
          {
            maxAttempts: 3,
            baseDelayMs: 2000,
            onRetry: (attempt, err) => {
              emit({ type: "retry", step: "match", attempt, error: err.message });
            },
          },
        );

        emit({ type: "step", step: "match", status: "done", topicTitle });
      } else {
        emit({
          type: "step",
          step: "match",
          status: "done",
          skipped: true,
          topicTitle: essayAfterOcr.matchedTopic?.title ?? null,
        });
      }

      // ── 阶段三：AI 评分 ──────────────────────────────────────────
      const existingScores = await prisma.scoringResult.findMany({
        where: { essayId: essay.id },
      });
      const scoredDims = new Set(existingScores.map((r) => r.dimension));
      const dimsToScore = allDimKeys.filter((d) => !scoredDims.has(d));

      if (dimsToScore.length > 0) {
        emit({
          type: "step",
          step: "score",
          status: "running",
          total: dimsToScore.length,
        });

        for (const dim of dimsToScore) {
          await withRetry(
            async () => {
              const result = await scoreEssay(essay.id, dim);
              emit({ type: "score_dim", dim, score: result.score, brief: result.brief });
            },
            {
              maxAttempts: 3,
              baseDelayMs: 2000,
              onRetry: (attempt, err) => {
                emit({
                  type: "retry",
                  step: `score:${dim}`,
                  attempt,
                  error: err.message,
                });
              },
            },
          );
        }

        emit({ type: "step", step: "score", status: "done" });
      } else {
        emit({ type: "step", step: "score", status: "done", skipped: true });
      }

      // ── 完成 ─────────────────────────────────────────────────────
      const finalResults = await prisma.scoringResult.findMany({
        where: { essayId: essay.id },
      });
      const scores: Record<string, { score: number; brief: string }> = {};
      let totalScore = 0;
      for (const r of finalResults) {
        scores[r.dimension] = { score: r.score, brief: r.brief };
        totalScore += r.score;
      }

      await prisma.pipelineJob.update({
        where: { id },
        data: { status: "done" },
      });

      emit({ type: "done", totalScore, scores });
    } catch (err) {
      const message = err instanceof Error ? err.message : "处理失败";
      await prisma.pipelineJob
        .update({ where: { id }, data: { status: "error", errorMsg: message } })
        .catch(() => {});
      emit({ type: "error", message });
    } finally {
      try {
        ctrl?.close();
      } catch {}
    }
  })();

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

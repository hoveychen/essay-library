import { NextRequest, NextResponse } from "next/server";
import { SCORING_DIMENSIONS, type ScoringDimensionKey } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { scoreEssay } from "@/lib/scoring-ai";

export const runtime = "nodejs";

const SCORING_CONCURRENCY = 10;

type BatchSseEvent =
  | { type: "start"; total: number; concurrency: number }
  | {
      type: "slot";
      slotId: number;
      essayId: string;
      studentName: string;
      essayTitle: string;
      dimension: string;
      dimensionCn: string;
      phase: "scoring" | "done" | "failed";
      score?: number;
      brief?: string;
    }
  | { type: "progress"; done: number; total: number }
  | { type: "complete"; done: number; failed: number };

// GET: retrieve all scoring results (optionally filtered)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const essayId = url.searchParams.get("essayId");
  const studentId = url.searchParams.get("studentId");

  const where: Record<string, unknown> = {};
  if (essayId) where.essayId = essayId;
  if (studentId) where.essay = { studentId };

  const results = await prisma.scoringResult.findMany({
    where,
    include: {
      essay: {
        include: {
          student: true,
          matchedTopic: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(results);
}

// POST: batch score essays with 10 concurrent workers (SSE progress)
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    // New: explicit task list (essayId + dimension pairs)
    tasks?: Array<{ essayId: string; dimension: string }>;
    // Legacy: essayIds + dimensions (scores all combinations)
    essayIds?: string[];
    dimensions?: string[];
  };

  type Task = { essayId: string; dimension: ScoringDimensionKey };
  const taskQueue: Task[] = [];

  if (Array.isArray(body.tasks) && body.tasks.length > 0) {
    // New mode: explicit task list
    for (const t of body.tasks) {
      if (!(t.dimension in SCORING_DIMENSIONS)) {
        return new Response(JSON.stringify({ error: `未知评分维度: ${t.dimension}` }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      taskQueue.push({ essayId: t.essayId, dimension: t.dimension as ScoringDimensionKey });
    }
  } else if (Array.isArray(body.essayIds) && body.essayIds.length > 0) {
    // Legacy mode: all combinations
    const dims = (body.dimensions || Object.keys(SCORING_DIMENSIONS)) as ScoringDimensionKey[];
    for (const d of dims) {
      if (!(d in SCORING_DIMENSIONS)) {
        return new Response(JSON.stringify({ error: `未知评分维度: ${d}` }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    for (const essayId of body.essayIds) {
      for (const dim of dims) {
        taskQueue.push({ essayId, dimension: dim });
      }
    }
  }

  if (taskQueue.length === 0) {
    return new Response(JSON.stringify({ error: "没有需要评分的任务" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Load essay info for display
  const uniqueEssayIds = [...new Set(taskQueue.map((t) => t.essayId))];
  const essays = await prisma.essay.findMany({
    where: { id: { in: uniqueEssayIds } },
    include: { student: true },
    orderBy: { createdAt: "asc" },
  });

  const essayMap = new Map(essays.map((e) => [e.id, e]));

  const encoder = new TextEncoder();
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;

  function emit(event: BatchSseEvent) {
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
    const numSlots = Math.min(SCORING_CONCURRENCY, taskQueue.length);
    emit({ type: "start", total: taskQueue.length, concurrency: numSlots });

    let doneCount = 0;
    let failedCount = 0;
    const queue = [...taskQueue];

    const worker = async (slotId: number) => {
      while (queue.length > 0) {
        const task = queue.shift()!;
        const essay = essayMap.get(task.essayId);
        const studentName = essay?.student.name ?? "未知";
        const essayTitle = essay?.title ?? "未命名";
        const dimensionCn = SCORING_DIMENSIONS[task.dimension];

        emit({
          type: "slot",
          slotId,
          essayId: task.essayId,
          studentName,
          essayTitle,
          dimension: task.dimension,
          dimensionCn,
          phase: "scoring",
        });

        try {
          const result = await scoreEssay(task.essayId, task.dimension);
          doneCount++;
          emit({
            type: "slot",
            slotId,
            essayId: task.essayId,
            studentName,
            essayTitle,
            dimension: task.dimension,
            dimensionCn,
            phase: "done",
            score: result.score,
            brief: result.brief,
          });
        } catch {
          doneCount++;
          failedCount++;
          emit({
            type: "slot",
            slotId,
            essayId: task.essayId,
            studentName,
            essayTitle,
            dimension: task.dimension,
            dimensionCn,
            phase: "failed",
          });
        }

        emit({ type: "progress", done: doneCount, total: taskQueue.length });
      }
    };

    await Promise.all(Array.from({ length: numSlots }, (_, i) => worker(i)));
    emit({ type: "complete", done: doneCount - failedCount, failed: failedCount });
    try {
      ctrl?.close();
    } catch {}
  })();

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

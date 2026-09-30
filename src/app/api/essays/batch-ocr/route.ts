import { NextRequest } from "next/server";
import { OcrProgressEvent, runOcrForEssay } from "@/lib/essay-ai";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// 并发全部在服务端控制，浏览器只用 1 个 SSE 连接
const LLM_CONCURRENCY = 10;

type BatchSseEvent =
  | { type: "start"; total: number; concurrency: number }
  | {
      type: "slot";
      slotId: number;
      essayId: string;
      studentName: string;
      essayTitle: string;
      phase: string;
      fileSizeBytes?: number;
    }
  | { type: "progress"; done: number; total: number }
  | { type: "complete"; done: number; failed: number };

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { essayIds?: string[] };
  const essayIds = Array.isArray(body.essayIds) ? body.essayIds : [];

  if (essayIds.length === 0) {
    return new Response(JSON.stringify({ error: "没有需要处理的作文" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const essays = await prisma.essay.findMany({
    where: { id: { in: essayIds } },
    include: { student: true },
    orderBy: { createdAt: "asc" },
  });

  const encoder = new TextEncoder();
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;

  function emit(event: BatchSseEvent) {
    try {
      ctrl?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      // 客户端断开连接
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });

  (async () => {
    const numSlots = Math.min(LLM_CONCURRENCY, essays.length);
    emit({ type: "start", total: essays.length, concurrency: numSlots });

    let doneCount = 0;
    let failedCount = 0;
    const queue = [...essays];

    const worker = async (slotId: number) => {
      while (queue.length > 0) {
        const essay = queue.shift()!;
        const studentName = essay.student.name;
        const essayTitle = essay.title ?? "未命名";

        emit({ type: "slot", slotId, essayId: essay.id, studentName, essayTitle, phase: "reading" });

        try {
          await runOcrForEssay(essay.id, (progress: OcrProgressEvent) => {
            emit({
              type: "slot",
              slotId,
              essayId: essay.id,
              studentName,
              essayTitle,
              phase: progress.phase,
              ...("fileSizeBytes" in progress ? { fileSizeBytes: progress.fileSizeBytes } : {}),
            });
          });
          emit({ type: "slot", slotId, essayId: essay.id, studentName, essayTitle, phase: "done" });
          doneCount++;
        } catch {
          emit({ type: "slot", slotId, essayId: essay.id, studentName, essayTitle, phase: "failed" });
          failedCount++;
        }

        emit({ type: "progress", done: doneCount + failedCount, total: essays.length });
      }
    };

    await Promise.all(Array.from({ length: numSlots }, (_, i) => worker(i)));
    emit({ type: "complete", done: doneCount, failed: failedCount });
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

import { OcrProgressEvent, runOcrForEssay } from "@/lib/essay-ai";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  const { id } = await params;

  const encoder = new TextEncoder();
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;

  function emit(event: object) {
    try {
      ctrl?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      // 客户端已断开连接
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });

  (async () => {
    try {
      await runOcrForEssay(id, (progress: OcrProgressEvent) => emit(progress));
      emit({ phase: "done" });
    } catch (error) {
      emit({
        phase: "error",
        message: error instanceof Error ? error.message : "OCR失败",
      });
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

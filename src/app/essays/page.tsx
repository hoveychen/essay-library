"use client";

import { useEffect, useMemo, useState } from "react";
import { Essay, Student, Topic, getEssays, getStudents, getTopics } from "@/lib/client-api";

const ALL_STUDENTS = "__all__";
// 批量匹配并发数（不是 OCR，不占 SSE 连接，可以适当高一些）
const BATCH_CONCURRENCY = 5;

type BatchProgress = { done: number; total: number } | null;

type OcrSlotPhase = "idle" | "reading" | "uploading" | "llm" | "done" | "failed";

type OcrSlot = {
  slotId: number;
  essayId?: string;
  studentName?: string;
  essayTitle?: string;
  phase: OcrSlotPhase;
  fileSizeBytes?: number;
};

type SseEvent = {
  phase: string;
  fileSizeBytes?: number;
  message?: string;
};

async function consumeOcrSse(
  essayId: string,
  onEvent: (event: SseEvent) => void,
): Promise<boolean> {
  const res = await fetch(`/api/essays/${essayId}/ocr`, { method: "POST" });
  if (!res.body) return false;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ok = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (!part.startsWith("data: ")) continue;
        let event: SseEvent;
        try {
          event = JSON.parse(part.slice(6)) as SseEvent;
        } catch {
          continue;
        }
        onEvent(event);
        if (event.phase === "done") ok = true;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return ok;
}

export default function EssaysPage() {
  const [essays, setEssays] = useState<Essay[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [studentId, setStudentId] = useState(ALL_STUDENTS);
  const [busyEssayId, setBusyEssayId] = useState<string | null>(null);
  const [batchOcrProgress, setBatchOcrProgress] = useState<BatchProgress>(null);
  const [batchOcrSlots, setBatchOcrSlots] = useState<OcrSlot[]>([]);
  const [batchMatchProgress, setBatchMatchProgress] = useState<BatchProgress>(null);
  const [message, setMessage] = useState("就绪");
  const [reviewEssay, setReviewEssay] = useState<Essay | null>(null);
  const [showBatchReview, setShowBatchReview] = useState(false);

  const studentMap = useMemo(
    () => new Map(students.map((s) => [s.id, s])),
    [students],
  );
  const filteredEssays = useMemo(
    () =>
      studentId === ALL_STUDENTS
        ? essays
        : essays.filter((essay) => essay.student.id === studentId),
    [essays, studentId],
  );

  async function loadAll() {
    const [sData, tData, eData] = await Promise.all([
      getStudents(),
      getTopics(),
      getEssays(),
    ]);
    setStudents(sData);
    setTopics(tData);
    setEssays(eData);
  }

  useEffect(() => {
    loadAll().catch((e) => setMessage(`加载失败: ${String(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runOcr(essayId: string) {
    setBusyEssayId(essayId);
    setMessage("OCR：读取文件中…");
    let lastError = "";
    try {
      await consumeOcrSse(essayId, (event) => {
        if (event.phase === "reading") setMessage("OCR：读取文件中…");
        if (event.phase === "uploading") setMessage("OCR：上传至 AI…");
        if (event.phase === "llm") setMessage("OCR：等待 AI 响应…");
        if (event.phase === "done") setMessage("OCR 完成");
        if (event.phase === "error") lastError = event.message ?? "OCR 失败";
      });
    } catch (e) {
      lastError = String(e);
    }
    if (lastError) setMessage(lastError);
    await loadAll();
    setBusyEssayId(null);
  }

  async function runMatch(essayId: string) {
    setBusyEssayId(essayId);
    const res = await fetch(`/api/essays/${essayId}/match`, { method: "POST" });
    const data = await res.json();
    setMessage(res.ok ? "匹配完成" : data.error || "匹配失败");
    await loadAll();
    setBusyEssayId(null);
  }

  async function confirmTopic(essayId: string, topicId: string) {
    if (!topicId) {
      setMessage("请选择题目");
      return;
    }
    setBusyEssayId(essayId);
    const res = await fetch(`/api/essays/${essayId}/confirm-topic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId }),
    });
    const data = await res.json();
    setMessage(res.ok ? "题目已确认绑定" : data.error || "绑定失败");
    await loadAll();
    setBusyEssayId(null);
  }

  async function runBatchOcr() {
    const targets = filteredEssays.filter(
      (e) => e.images.length > 0 && !e.rawText?.trim() && e.ocrStatus !== "DONE",
    );
    if (targets.length === 0) {
      setMessage("没有需要 OCR 的作文");
      return;
    }

    setBatchOcrProgress({ done: 0, total: targets.length });
    setBatchOcrSlots([]);

    const res = await fetch("/api/essays/batch-ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ essayIds: targets.map((e) => e.id) }),
    });

    if (!res.body) {
      setMessage("批量 OCR 请求失败");
      setBatchOcrProgress(null);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          let event: { type: string; [key: string]: unknown };
          try {
            event = JSON.parse(part.slice(6)) as typeof event;
          } catch {
            continue;
          }

          if (event.type === "start") {
            const concurrency = event.concurrency as number;
            setBatchOcrSlots(
              Array.from({ length: concurrency }, (_, i) => ({
                slotId: i,
                phase: "idle" as OcrSlotPhase,
              })),
            );
          } else if (event.type === "slot") {
            setBatchOcrSlots((prev) =>
              prev.map((s) =>
                s.slotId === (event.slotId as number)
                  ? {
                      ...s,
                      essayId: event.essayId as string,
                      studentName: event.studentName as string,
                      essayTitle: event.essayTitle as string,
                      phase: event.phase as OcrSlotPhase,
                      ...(event.fileSizeBytes !== undefined
                        ? { fileSizeBytes: event.fileSizeBytes as number }
                        : {}),
                    }
                  : s,
              ),
            );
          } else if (event.type === "progress") {
            setBatchOcrProgress({
              done: event.done as number,
              total: event.total as number,
            });
          } else if (event.type === "complete") {
            const done = event.done as number;
            const failed = event.failed as number;
            setMessage(`批量 OCR 完成：${done} 成功，${failed} 失败`);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    setBatchOcrProgress(null);
    setBatchOcrSlots([]);
    await loadAll();
  }

  async function runBatchMatch() {
    const targets = filteredEssays.filter(
      (e) => e.ocrStatus === "DONE" && e.matchStatus !== "CONFIRMED",
    );
    if (targets.length === 0) {
      setMessage("没有需要匹配的作文（需先完成 OCR）");
      return;
    }

    const studentIds = [...new Set(targets.map((e) => e.student.id))];
    let done = 0;
    let matchedTotal = 0;
    let failedTotal = 0;
    setBatchMatchProgress({ done: 0, total: studentIds.length });

    const queue = [...studentIds];
    const worker = async () => {
      while (queue.length > 0) {
        const sid = queue.shift()!;
        const res = await fetch(`/api/students/${sid}/batch-match`, { method: "POST" });
        if (res.ok) {
          const data = await res.json() as { matched: number; failed: number };
          matchedTotal += data.matched;
          failedTotal += data.failed;
        } else {
          failedTotal++;
        }
        done++;
        setBatchMatchProgress({ done, total: studentIds.length });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(BATCH_CONCURRENCY, studentIds.length) }, worker),
    );

    setBatchMatchProgress(null);
    setMessage(`批量匹配完成：${matchedTotal} 篇成功，${failedTotal} 篇失败`);
    await loadAll();
  }

  async function deleteEssay(essayId: string) {
    const confirmed = window.confirm("确认删除这篇作文吗？删除后不可恢复。");
    if (!confirmed) return;

    setBusyEssayId(essayId);
    const res = await fetch(`/api/essays/${essayId}`, {
      method: "DELETE",
    });
    const data = await res.json();
    setMessage(res.ok ? "作文已删除" : data.error || "删除失败");
    await loadAll();
    setBusyEssayId(null);
  }

  function handleReviewSaved(essayId: string, newText: string) {
    setEssays((prev) =>
      prev.map((e) => (e.id === essayId ? { ...e, rawText: newText } : e)),
    );
    setReviewEssay((prev) => (prev ? { ...prev, rawText: newText } : null));
  }

  const batchBusy = !!batchOcrProgress || !!batchMatchProgress;

  return (
    <main className="page-wrap space-y-4">
      <h1 className="title-lg">作文管理</h1>
      <p className="status-bar">{message}</p>

      <div className="glass-card flex flex-wrap items-center gap-2 p-4">
        <select
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          className="field w-auto min-w-56"
        >
          <option value={ALL_STUDENTS}>全部学生（仅筛选）</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={runBatchOcr}
          disabled={batchBusy}
          className="btn btn-primary"
        >
          {batchOcrProgress
            ? `OCR 中 ${batchOcrProgress.done}/${batchOcrProgress.total}…`
            : "批量 OCR"}
        </button>

        <button
          type="button"
          onClick={runBatchMatch}
          disabled={batchBusy}
          className="btn btn-success"
        >
          {batchMatchProgress
            ? `匹配中 ${batchMatchProgress.done}/${batchMatchProgress.total} 人…`
            : "批量匹配"}
        </button>

        {filteredEssays.some((e) => e.matchStatus === "SUGGESTED") && (
          <button
            type="button"
            onClick={() => setShowBatchReview(true)}
            disabled={batchBusy}
            className="btn btn-secondary"
          >
            批量审核（{filteredEssays.filter((e) => e.matchStatus === "SUGGESTED").length} 篇待审）
          </button>
        )}

        {batchOcrProgress && (
          <BatchOcrPanel progress={batchOcrProgress} slots={batchOcrSlots} />
        )}

        {batchMatchProgress && (
          <div className="mt-2 w-full">
            <div className="mb-1 text-sm text-slate-600">
              匹配进度：{batchMatchProgress.done} / {batchMatchProgress.total} 位学生
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-2 rounded-full bg-green-500 transition-all duration-300"
                style={{ width: `${(batchMatchProgress.done / batchMatchProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <section className="space-y-3">
        {filteredEssays.map((essay) => (
          <article key={essay.id} className="glass-card p-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <strong>{essay.title || "未命名作文"}</strong>
              <span>学生：{studentMap.get(essay.student.id)?.name || essay.student.id}</span>
              <span>OCR：{essay.ocrStatus}</span>
              <span>匹配：{essay.matchStatus}</span>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {essay.images.map((img, idx) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setReviewEssay(essay)}
                  className="group relative cursor-pointer border-0 bg-transparent p-0"
                  title={`查看第 ${idx + 1} 张扫描图`}
                >
                  <img
                    src={img.publicPath}
                    alt={img.originalName}
                    className="thumb h-28"
                  />
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="text-xs font-semibold text-white">查看 / 编辑</span>
                  </div>
                </button>
              ))}
            </div>

            {essay.ocrError ? (
              <p className="mt-2 text-sm text-red-600">{essay.ocrError}</p>
            ) : null}

            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <textarea
                readOnly
                value={essay.rawText || ""}
                className="field h-36 bg-white/70 text-sm"
                placeholder="OCR 结果"
              />
              <div className="space-y-2 rounded-2xl border border-white/80 bg-white/60 p-3 text-sm">
                <div>
                  建议题目：{essay.suggestedTopic?.title || "暂无"} | 置信度：
                  {essay.suggestedConfidence ?? 0}
                </div>
                <div>匹配原因：{essay.suggestedReason || "暂无"}</div>
                <div>已绑定题目：{essay.matchedTopic?.title || "未确认"}</div>
                <TopicConfirm
                  essayId={essay.id}
                  topics={topics}
                  initialTopicId={essay.matchedTopic?.id || essay.suggestedTopic?.id || ""}
                  onConfirm={confirmTopic}
                />
              </div>
            </div>

            <div className="mt-2 flex gap-2">
              <button
                onClick={() => runOcr(essay.id)}
                disabled={busyEssayId === essay.id}
                className="btn btn-primary"
              >
                OCR
              </button>
              <button
                onClick={() => runMatch(essay.id)}
                disabled={busyEssayId === essay.id}
                className="btn btn-success"
              >
                自动匹配题目
              </button>
              <button
                onClick={() => deleteEssay(essay.id)}
                disabled={busyEssayId === essay.id}
                className="btn btn-danger"
              >
                删除作文
              </button>
            </div>
          </article>
        ))}
        {filteredEssays.length === 0 ? (
          <p className="text-sm">当前筛选下暂无作文</p>
        ) : null}
      </section>

      {reviewEssay && (
        <EssayReviewModal
          essay={reviewEssay}
          onClose={() => setReviewEssay(null)}
          onSaved={handleReviewSaved}
        />
      )}

      {showBatchReview && (
        <BatchReviewModal
          essays={filteredEssays.filter((e) => e.matchStatus === "SUGGESTED")}
          topics={topics}
          studentMap={studentMap}
          onClose={() => setShowBatchReview(false)}
          onDone={async () => {
            setShowBatchReview(false);
            await loadAll();
            setMessage("批量审核完成");
          }}
        />
      )}
    </main>
  );
}

// ──────────────────────────────────────────────────────────────
// 批量 OCR 进度面板
// ──────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<OcrSlotPhase, string> = {
  idle: "空闲",
  reading: "读取文件",
  uploading: "上传中",
  llm: "AI 识别中",
  done: "完成",
  failed: "失败",
};

const PHASE_DOT: Record<OcrSlotPhase, string> = {
  idle: "bg-slate-300",
  reading: "bg-yellow-400 animate-pulse",
  uploading: "bg-blue-500 animate-pulse",
  llm: "bg-purple-500 animate-pulse",
  done: "bg-green-500",
  failed: "bg-red-500",
};

function OcrSlotCard({ slot }: { slot: OcrSlot }) {
  if (slot.phase === "idle") return null;
  const sizeKb = slot.fileSizeBytes !== undefined ? Math.round(slot.fileSizeBytes / 1024) : null;
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-white/70 bg-white/60 px-3 py-2 text-xs shadow-sm">
      <span
        className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${PHASE_DOT[slot.phase]}`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-slate-800">
          {slot.studentName ?? "—"}
          {slot.essayTitle ? ` · ${slot.essayTitle}` : ""}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-slate-500">
          <span>{PHASE_LABEL[slot.phase]}</span>
          {sizeKb !== null && (
            <>
              <span>·</span>
              <span>{sizeKb} KB</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BatchOcrPanel({
  progress,
  slots,
}: {
  progress: { done: number; total: number };
  slots: OcrSlot[];
}) {
  const pct = Math.round((progress.done / progress.total) * 100);
  const activeSlots = slots.filter((s) => s.phase !== "idle");
  return (
    <div className="mt-3 w-full space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between text-sm text-slate-600">
          <span>OCR 总进度</span>
          <span>
            {progress.done} / {progress.total}（{pct}%）
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-2 rounded-full bg-blue-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {activeSlots.length > 0 && (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {activeSlots.map((slot) => (
            <OcrSlotCard key={slot.slotId} slot={slot} />
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────

function TopicConfirm({
  essayId,
  topics,
  initialTopicId,
  onConfirm,
}: {
  essayId: string;
  topics: Topic[];
  initialTopicId: string;
  onConfirm: (essayId: string, topicId: string) => Promise<void>;
}) {
  const [topicId, setTopicId] = useState(initialTopicId);

  useEffect(() => {
    setTopicId(initialTopicId);
  }, [initialTopicId]);

  return (
    <div className="flex gap-2">
      <select
        value={topicId}
        onChange={(e) => setTopicId(e.target.value)}
        className="field min-w-48"
      >
        <option value="">请选择题目</option>
        {topics.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onConfirm(essayId, topicId)}
        className="btn btn-secondary"
      >
        确认绑定
      </button>
    </div>
  );
}

function EssayReviewModal({
  essay,
  onClose,
  onSaved,
}: {
  essay: Essay;
  onClose: () => void;
  onSaved: (essayId: string, newText: string) => void;
}) {
  const [imageIdx, setImageIdx] = useState(0);
  const [text, setText] = useState(essay.rawText || "");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    setText(essay.rawText || "");
    setImageIdx(0);
  }, [essay.id, essay.rawText]);

  async function save() {
    setSaving(true);
    setSaveMsg("");
    const res = await fetch(`/api/essays/${essay.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText: text }),
    });
    setSaving(false);
    if (res.ok) {
      onSaved(essay.id, text);
      setSaveMsg("已保存");
      setTimeout(() => setSaveMsg(""), 2000);
    } else {
      setSaveMsg("保存失败");
    }
  }

  const totalImages = essay.images.length;
  const currentImage = essay.images[imageIdx];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-[88vh] w-[92vw] max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="font-semibold">{essay.title || "未命名作文"}</span>
            <span className="text-sm text-slate-400">
              {essay.student.name}
            </span>
          </div>
          <button type="button" onClick={onClose} className="btn btn-secondary px-4 py-1.5 text-sm">
            关闭
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Image Viewer */}
          <div className="flex w-1/2 flex-col items-center justify-between border-r border-slate-100 bg-slate-50 p-4">
            {totalImages > 0 && currentImage ? (
              <>
                <div className="flex flex-1 items-center justify-center overflow-hidden">
                  <img
                    src={currentImage.publicPath}
                    alt={currentImage.originalName}
                    className="max-h-full max-w-full rounded-lg object-contain shadow"
                  />
                </div>
                {totalImages > 1 && (
                  <div className="mt-3 flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setImageIdx((i) => Math.max(0, i - 1))}
                      disabled={imageIdx === 0}
                      className="btn btn-secondary px-4 py-1.5 text-sm"
                    >
                      ← 上一页
                    </button>
                    <span className="text-sm text-slate-500">
                      {imageIdx + 1} / {totalImages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setImageIdx((i) => Math.min(totalImages - 1, i + 1))}
                      disabled={imageIdx === totalImages - 1}
                      className="btn btn-secondary px-4 py-1.5 text-sm"
                    >
                      下一页 →
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-slate-400">
                暂无扫描图片
              </div>
            )}
          </div>

          {/* Right: OCR Editor */}
          <div className="flex w-1/2 flex-col p-4">
            <div className="mb-2 flex shrink-0 items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">OCR 识别结果</span>
              <div className="flex items-center gap-2">
                {saveMsg && (
                  <span
                    className={`text-sm font-medium ${saveMsg === "已保存" ? "text-green-600" : "text-red-500"}`}
                  >
                    {saveMsg}
                  </span>
                )}
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="btn btn-primary px-4 py-1.5 text-sm"
                >
                  {saving ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="field h-0 flex-1 resize-none font-mono text-sm leading-relaxed"
              placeholder="OCR 识别结果（可在此编辑）"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 批量审核模态框
// ──────────────────────────────────────────────────────────────

type ReviewRow = {
  essayId: string;
  selectedTopicId: string;
  status: "pending" | "confirming" | "confirmed" | "failed";
};

function BatchReviewModal({
  essays,
  topics,
  studentMap,
  onClose,
  onDone,
}: {
  essays: Essay[];
  topics: Topic[];
  studentMap: Map<string, Student>;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [rows, setRows] = useState<ReviewRow[]>(() =>
    essays.map((e) => ({
      essayId: e.id,
      selectedTopicId: e.suggestedTopic?.id || "",
      status: "pending" as const,
    })),
  );
  const [busy, setBusy] = useState(false);

  const essayMap = useMemo(() => new Map(essays.map((e) => [e.id, e])), [essays]);

  function updateRow(essayId: string, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((r) => (r.essayId === essayId ? { ...r, ...patch } : r)));
  }

  async function confirmOne(essayId: string, topicId: string) {
    if (!topicId) return;
    updateRow(essayId, { status: "confirming" });
    const res = await fetch(`/api/essays/${essayId}/confirm-topic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId }),
    });
    updateRow(essayId, { status: res.ok ? "confirmed" : "failed" });
  }

  async function confirmAll() {
    const pending = rows.filter((r) => r.status === "pending" && r.selectedTopicId);
    if (pending.length === 0) return;
    setBusy(true);
    await Promise.all(pending.map((r) => confirmOne(r.essayId, r.selectedTopicId)));
    setBusy(false);
  }

  const pendingCount = rows.filter((r) => r.status === "pending" && r.selectedTopicId).length;
  const confirmedCount = rows.filter((r) => r.status === "confirmed").length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-[85vh] w-[90vw] max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="font-semibold">批量审核题目匹配</span>
            <span className="text-sm text-slate-400">
              {confirmedCount} / {rows.length} 已确认
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={confirmAll}
              disabled={busy || pendingCount === 0}
              className="btn btn-success px-4 py-1.5 text-sm"
            >
              {busy ? "确认中…" : `全部确认（${pendingCount} 篇）`}
            </button>
            <button
              type="button"
              onClick={confirmedCount > 0 ? onDone : onClose}
              className="btn btn-secondary px-4 py-1.5 text-sm"
            >
              {confirmedCount > 0 ? "完成" : "关闭"}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">学生</th>
                <th className="pb-2 font-medium">作文</th>
                <th className="pb-2 font-medium">建议题目</th>
                <th className="pb-2 font-medium">置信度</th>
                <th className="pb-2 font-medium">匹配原因</th>
                <th className="pb-2 font-medium">确认题目</th>
                <th className="pb-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const essay = essayMap.get(row.essayId)!;
                return (
                  <tr key={row.essayId} className="border-b border-slate-100">
                    <td className="py-2.5 pr-2">
                      {studentMap.get(essay.student.id)?.name || essay.student.id}
                    </td>
                    <td className="py-2.5 pr-2">{essay.title || "未命名"}</td>
                    <td className="py-2.5 pr-2 text-slate-600">
                      {essay.suggestedTopic?.title || "—"}
                    </td>
                    <td className="py-2.5 pr-2">
                      <ConfidenceBadge value={essay.suggestedConfidence} />
                    </td>
                    <td className="max-w-48 truncate py-2.5 pr-2 text-xs text-slate-500" title={essay.suggestedReason || ""}>
                      {essay.suggestedReason || "—"}
                    </td>
                    <td className="py-2.5 pr-2">
                      <select
                        value={row.selectedTopicId}
                        onChange={(e) => updateRow(row.essayId, { selectedTopicId: e.target.value })}
                        disabled={row.status === "confirmed" || row.status === "confirming"}
                        className="field py-1 text-xs"
                      >
                        <option value="">请选择</option>
                        {topics.map((t) => (
                          <option key={t.id} value={t.id}>{t.title}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5">
                      {row.status === "confirmed" ? (
                        <span className="text-xs font-medium text-green-600">已确认</span>
                      ) : row.status === "confirming" ? (
                        <span className="text-xs text-slate-400">确认中…</span>
                      ) : row.status === "failed" ? (
                        <span className="text-xs text-red-500">失败</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => confirmOne(row.essayId, row.selectedTopicId)}
                          disabled={!row.selectedTopicId || busy}
                          className="btn btn-primary px-3 py-1 text-xs"
                        >
                          确认
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-slate-300">—</span>;
  const pct = Math.round(value * 100);
  const color =
    pct >= 80 ? "bg-green-100 text-green-700" :
    pct >= 50 ? "bg-yellow-100 text-yellow-700" :
    "bg-red-100 text-red-700";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {pct}%
    </span>
  );
}

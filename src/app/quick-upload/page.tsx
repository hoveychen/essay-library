"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Student, getStudents } from "@/lib/client-api";

// ─── 维度常量（客户端副本，避免引入服务端模块） ──────────────────────
const DIMENSIONS = [
  { key: "topic_adherence_and_task", label: "审题扣题与任务完成", max: 12 },
  { key: "thesis_and_theme", label: "论点与立意", max: 13 },
  { key: "evidence_and_material", label: "论据与素材", max: 12 },
  { key: "logic_and_structure", label: "逻辑与结构", max: 15 },
  { key: "language_and_expression", label: "语言与表达", max: 8 },
] as const;

type DimKey = (typeof DIMENSIONS)[number]["key"];

// ─── 类型定义 ──────────────────────────────────────────────────────────
type DbScoring = { dimension: string; score: number; brief: string };

type DbJob = {
  id: string;
  status: string;
  errorMsg: string | null;
  createdAt: string;
  essay: {
    id: string;
    title: string | null;
    ocrStatus: string;
    matchStatus: string;
    student: { name: string };
    matchedTopic: { title: string } | null;
    scoringResults: DbScoring[];
  };
};

type LiveState = {
  step: "ocr" | "matching" | "scoring" | "done" | "error";
  ocrPhase?: string;
  topicTitle?: string | null;
  scores: Partial<Record<DimKey, { score: number; brief: string }>>;
  totalScore: number;
  scoredCount: number;
  scoringTotal: number;
  errorMsg?: string;
  retrying?: string;
  streaming: boolean;
};

type JobView = DbJob & { live: LiveState | null };

// ─── SSE 读取工具 ──────────────────────────────────────────────────────
async function* readSSE(
  res: Response,
  signal: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (line.startsWith("data: ")) {
          try {
            yield JSON.parse(line.slice(6)) as Record<string, unknown>;
          } catch {
            // 忽略格式错误的 SSE 行
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function defaultLive(streaming: boolean): LiveState {
  return {
    step: "ocr",
    scores: {},
    totalScore: 0,
    scoredCount: 0,
    scoringTotal: 5,
    streaming,
  };
}

const MAX_CONCURRENT = 3;

// ─── 主组件 ────────────────────────────────────────────────────────────
export default function QuickUploadPage() {
  const [topicCount, setTopicCount] = useState<number | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [groupMode, setGroupMode] = useState<
    "filename-prefix" | "single-essay" | "one-image-one-essay"
  >("filename-prefix");
  const [essayTitle, setEssayTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  const [jobs, setJobs] = useState<JobView[]>([]);
  const jobsRef = useRef<JobView[]>([]);
  const streamsRef = useRef<Map<string, AbortController>>(new Map());

  // ── 同步 ref ────────────────────────────────────────────────────────
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  // ── 工具：更新单个 job 的 live 状态 ─────────────────────────────────
  function patchLive(jobId: string, patch: Partial<LiveState>) {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const base = j.live ?? defaultLive(false);
        return { ...j, live: { ...base, ...patch } };
      }),
    );
  }

  // ── 工具：从 DB 加载所有 jobs ────────────────────────────────────────
  const loadJobs = useCallback(async (): Promise<JobView[]> => {
    const res = await fetch("/api/pipeline");
    const fresh: DbJob[] = await res.json();
    setJobs((prev) => {
      const prevMap = new Map(prev.map((j) => [j.id, j]));
      return fresh.map((f) => {
        const existing = prevMap.get(f.id);
        if (existing && streamsRef.current.has(f.id)) {
          return { ...f, live: existing.live };
        }
        return { ...f, live: null };
      });
    });
    const views = fresh.map((f) => ({ ...f, live: null }));
    jobsRef.current = views;
    return views;
  }, []);

  // ── SSE 流处理 ───────────────────────────────────────────────────────
  const tryStartNext = useCallback(() => {
    const running = streamsRef.current.size;
    if (running >= MAX_CONCURRENT) return;
    const slots = MAX_CONCURRENT - running;
    const candidates = jobsRef.current
      .filter(
        (j) =>
          (j.status === "pending" || j.status === "running") &&
          !streamsRef.current.has(j.id),
      )
      .slice(0, slots);
    candidates.forEach((j) => startStream(j.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startStream = useCallback(
    (jobId: string) => {
      if (streamsRef.current.has(jobId)) return;
      const ac = new AbortController();
      streamsRef.current.set(jobId, ac);

      patchLive(jobId, { streaming: true, step: "ocr" });

      (async () => {
        try {
          const res = await fetch(`/api/pipeline/${jobId}/stream`, {
            method: "POST",
            signal: ac.signal,
          });
          if (!res.ok || !res.body) {
            throw new Error(`连接失败 (${res.status})`);
          }

          for await (const event of readSSE(res, ac.signal)) {
            handleEvent(jobId, event);
          }
        } catch (err) {
          if ((err as Error)?.name !== "AbortError") {
            patchLive(jobId, {
              step: "error",
              errorMsg: (err as Error)?.message ?? "连接中断",
              streaming: false,
            });
            setJobs((prev) =>
              prev.map((j) =>
                j.id === jobId ? { ...j, status: "error" } : j,
              ),
            );
          }
        } finally {
          streamsRef.current.delete(jobId);
          patchLive(jobId, { streaming: false });
          tryStartNext();
        }
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tryStartNext],
  );

  function handleEvent(jobId: string, event: Record<string, unknown>) {
    const type = event.type as string;

    if (type === "already_done") {
      patchLive(jobId, { step: "done", streaming: false });
      return;
    }

    if (type === "state") {
      patchLive(jobId, { streaming: true });
      return;
    }

    if (type === "ocr_phase") {
      const phase = event.phase as string;
      const label =
        phase === "reading"
          ? "读取图片"
          : phase === "uploading"
            ? "上传图片"
            : phase === "llm"
              ? "AI 识字中"
              : phase;
      patchLive(jobId, { step: "ocr", ocrPhase: label, retrying: undefined });
      return;
    }

    if (type === "step") {
      const step = event.step as string;
      const status = event.status as string;
      if (step === "ocr" && status === "done") {
        patchLive(jobId, { step: "matching", ocrPhase: undefined, retrying: undefined });
      } else if (step === "match" && status === "done") {
        patchLive(jobId, {
          step: "scoring",
          topicTitle: (event.topicTitle as string | null) ?? undefined,
          retrying: undefined,
        });
      } else if (step === "score" && status === "running") {
        patchLive(jobId, {
          step: "scoring",
          scoringTotal: (event.total as number) ?? 5,
        });
      } else if (step === "score" && status === "done") {
        patchLive(jobId, { step: "done" });
      }
      return;
    }

    if (type === "score_dim") {
      const dim = event.dim as DimKey;
      const score = event.score as number;
      const brief = event.brief as string;
      setJobs((prev) =>
        prev.map((j) => {
          if (j.id !== jobId) return j;
          const base = j.live ?? defaultLive(true);
          const scores = { ...base.scores, [dim]: { score, brief } };
          const totalScore = Object.values(scores).reduce(
            (s, r) => s + (r?.score ?? 0),
            0,
          );
          return {
            ...j,
            live: {
              ...base,
              scores,
              totalScore,
              scoredCount: Object.keys(scores).length,
            },
          };
        }),
      );
      return;
    }

    if (type === "retry") {
      patchLive(jobId, {
        retrying: `${event.step}（第 ${event.attempt} 次重试：${event.error}）`,
      });
      return;
    }

    if (type === "done") {
      const rawScores = event.scores as Record<
        string,
        { score: number; brief: string }
      >;
      const scores: Partial<Record<DimKey, { score: number; brief: string }>> =
        {};
      for (const [k, v] of Object.entries(rawScores)) {
        scores[k as DimKey] = v;
      }
      patchLive(jobId, {
        step: "done",
        scores,
        totalScore: event.totalScore as number,
        scoredCount: Object.keys(scores).length,
        streaming: false,
      });
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, status: "done" } : j)),
      );
      return;
    }

    if (type === "error") {
      patchLive(jobId, {
        step: "error",
        errorMsg: event.message as string,
        streaming: false,
      });
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: "error" } : j,
        ),
      );
      return;
    }
  }

  // ── 初始化 ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/topics")
      .then((r) => r.json())
      .then((t: unknown[]) => setTopicCount(t.length))
      .catch(() => setTopicCount(0));

    getStudents()
      .then((data) => {
        setStudents(data);
        if (data.length) setStudentId(data[0].id);
      })
      .catch(() => {});

    loadJobs().then((loaded) => {
      // 对未完成的 job 自动续跑
      const needRun = loaded.filter(
        (j) => j.status === "pending" || j.status === "running",
      );
      needRun.slice(0, MAX_CONCURRENT).forEach((j) => startStream(j.id));
    });

    return () => {
      for (const ac of streamsRef.current.values()) ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 上传 ─────────────────────────────────────────────────────────────
  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!studentId || !files?.length) {
      setUploadMsg("请选择学生并上传图片");
      return;
    }

    setUploading(true);
    setUploadMsg("上传图片中…");

    try {
      const form = new FormData();
      form.append("studentId", studentId);
      form.append("groupMode", groupMode);
      if (essayTitle.trim()) form.append("essayTitle", essayTitle.trim());
      Array.from(files).forEach((f) => form.append("images", f));

      const uploadRes = await fetch("/api/essays", {
        method: "POST",
        body: form,
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) {
        setUploadMsg(uploadData.error || "上传失败");
        return;
      }

      const essays = uploadData.essays as Array<{ id: string }>;
      setUploadMsg(`已上传 ${essays.length} 篇，加入评分队列…`);

      const jobsRes = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ essayIds: essays.map((e) => e.id) }),
      });
      const newJobs: DbJob[] = await jobsRes.json();

      setJobs((prev) => [
        ...newJobs.map((j) => ({ ...j, live: null })),
        ...prev,
      ]);
      jobsRef.current = [
        ...newJobs.map((j) => ({ ...j, live: null })),
        ...jobsRef.current,
      ];

      newJobs.forEach((j) => {
        if (streamsRef.current.size < MAX_CONCURRENT) {
          startStream(j.id);
        }
      });

      setUploadMsg(
        `${essays.length} 篇已加入队列，当前并发处理 ${Math.min(streamsRef.current.size, MAX_CONCURRENT)} 篇`,
      );
      setEssayTitle("");
      setFiles(null);
      const input = document.getElementById("qup-files") as HTMLInputElement;
      if (input) input.value = "";
    } finally {
      setUploading(false);
    }
  }

  // ── 重试 ─────────────────────────────────────────────────────────────
  async function retryJob(jobId: string) {
    streamsRef.current.get(jobId)?.abort();
    await fetch(`/api/pipeline/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry" }),
    });
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId ? { ...j, status: "pending", live: null } : j,
      ),
    );
    jobsRef.current = jobsRef.current.map((j) =>
      j.id === jobId ? { ...j, status: "pending", live: null } : j,
    );
    startStream(jobId);
  }

  // ── 删除 ─────────────────────────────────────────────────────────────
  async function deleteJob(jobId: string) {
    streamsRef.current.get(jobId)?.abort();
    await fetch(`/api/pipeline/${jobId}`, { method: "DELETE" });
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }

  // ── 批量清除已完成 ────────────────────────────────────────────────────
  async function clearDone() {
    const doneIds = jobs.filter((j) => j.status === "done").map((j) => j.id);
    await Promise.all(
      doneIds.map((id) => fetch(`/api/pipeline/${id}`, { method: "DELETE" })),
    );
    setJobs((prev) => prev.filter((j) => j.status !== "done"));
  }

  // ── 统计 ─────────────────────────────────────────────────────────────
  const pending = jobs.filter((j) => j.status === "pending").length;
  const running = jobs.filter((j) => j.status === "running").length;
  const done = jobs.filter((j) => j.status === "done").length;
  const errored = jobs.filter((j) => j.status === "error").length;

  return (
    <main className="page-wrap space-y-5">
      <h1 className="title-lg">一键评分上传</h1>

      {/* 题目库警告 */}
      {topicCount === 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <span className="text-amber-500 text-xl leading-none mt-0.5">⚠</span>
          <div className="text-sm text-amber-800">
            <strong>题目库为空！</strong>
            题目匹配步骤将会失败，评分也会缺少题目上下文。
            请先前往{" "}
            <Link href="/topics" className="underline font-semibold">
              题目库
            </Link>{" "}
            导入题目，再开始评分流程。
          </div>
        </div>
      )}

      {/* 上传表单 */}
      <form onSubmit={handleUpload} className="glass-card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">添加任务</h2>
          <span className="text-xs subtle">
            最多 {MAX_CONCURRENT} 篇同时处理
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="field"
            disabled={uploading}
          >
            <option value="">请选择学生</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <select
            value={groupMode}
            onChange={(e) =>
              setGroupMode(
                e.target.value as
                  | "filename-prefix"
                  | "single-essay"
                  | "one-image-one-essay",
              )
            }
            className="field"
            disabled={uploading}
          >
            <option value="filename-prefix">按文件名前缀分组（推荐）</option>
            <option value="single-essay">所有文件合并为同一篇</option>
            <option value="one-image-one-essay">每张图单独成篇</option>
          </select>
        </div>

        <input
          id="qup-files"
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => setFiles(e.target.files)}
          className="field"
          disabled={uploading}
        />

        <input
          value={essayTitle}
          onChange={(e) => setEssayTitle(e.target.value)}
          placeholder="可选：作文标题前缀"
          className="field"
          disabled={uploading}
        />

        <div className="flex items-center gap-3">
          <button
            className="btn btn-primary"
            type="submit"
            disabled={uploading}
          >
            {uploading ? "处理中…" : "上传并加入队列"}
          </button>
          {uploadMsg && <span className="text-sm subtle">{uploadMsg}</span>}
        </div>
      </form>

      {/* 队列统计 */}
      {jobs.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2 text-sm">
            {pending > 0 && (
              <Chip color="slate">{pending} 等待</Chip>
            )}
            {running > 0 && (
              <Chip color="blue">{running} 处理中</Chip>
            )}
            {done > 0 && (
              <Chip color="green">{done} 完成</Chip>
            )}
            {errored > 0 && (
              <Chip color="red">{errored} 出错</Chip>
            )}
          </div>
          {done > 0 && (
            <button
              onClick={clearDone}
              className="btn btn-secondary text-xs py-1 px-3"
            >
              清除已完成
            </button>
          )}
        </div>
      )}

      {/* 任务列表 */}
      <div className="space-y-3">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            onRetry={() => retryJob(job.id)}
            onDelete={() => deleteJob(job.id)}
          />
        ))}
        {jobs.length === 0 && (
          <p className="text-sm subtle text-center py-8">
            暂无任务——上传扫描图后自动开始评分
          </p>
        )}
      </div>
    </main>
  );
}

// ─── 子组件：标签 ──────────────────────────────────────────────────────
function Chip({
  color,
  children,
}: {
  color: "slate" | "blue" | "green" | "red";
  children: React.ReactNode;
}) {
  const cls = {
    slate: "bg-slate-100 text-slate-600",
    blue: "bg-blue-100 text-blue-700",
    green: "bg-green-100 text-green-700",
    red: "bg-red-100 text-red-700",
  }[color];
  return (
    <span className={`rounded-full px-3 py-0.5 font-medium ${cls}`}>
      {children}
    </span>
  );
}

// ─── 子组件：旋转图标 ─────────────────────────────────────────────────
function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`inline-block animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

// ─── 子组件：任务卡 ────────────────────────────────────────────────────
const STEP_LABELS = {
  ocr: "OCR 识字",
  matching: "题目匹配",
  scoring: "AI 评分",
  done: "完成",
  error: "出错",
} as const;

const STEPS = ["ocr", "matching", "scoring", "done"] as const;

function stepOrder(step: string): number {
  return STEPS.indexOf(step as (typeof STEPS)[number]);
}

function JobCard({
  job,
  onRetry,
  onDelete,
}: {
  job: JobView;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const live = job.live;
  const dbStatus = job.status;

  const currentStep: string =
    live?.step ?? (dbStatus === "done" ? "done" : dbStatus === "error" ? "error" : "ocr");
  const isActive = live?.streaming ?? false;
  const isDone = dbStatus === "done" || currentStep === "done";
  const isError = dbStatus === "error" || currentStep === "error";
  const isPending = dbStatus === "pending" && !isActive;

  // 分数来源：优先 live（流式积累），其次 DB
  const scoresFromDb: Partial<Record<DimKey, { score: number; brief: string }>> =
    {};
  for (const r of job.essay.scoringResults) {
    scoresFromDb[r.dimension as DimKey] = { score: r.score, brief: r.brief };
  }
  const scores = isDone
    ? (Object.keys(live?.scores ?? {}).length > 0 ? live!.scores : scoresFromDb)
    : live?.scores ?? {};
  const totalScore =
    isDone && live?.totalScore != null
      ? live.totalScore
      : Object.values(scores).reduce((s, r) => s + (r?.score ?? 0), 0);

  const topicTitle =
    live?.topicTitle ?? job.essay.matchedTopic?.title ?? null;

  const statusLabel = isPending
    ? "等待中"
    : isError
      ? live?.errorMsg ?? job.errorMsg ?? "出错"
      : currentStep === "ocr"
        ? live?.ocrPhase
          ? `OCR（${live.ocrPhase}）`
          : "OCR 识字中"
        : currentStep === "matching"
          ? "题目匹配中"
          : currentStep === "scoring"
            ? `评分中（${live?.scoredCount ?? 0}/${live?.scoringTotal ?? 5}）`
            : "完成";

  return (
    <article className="glass-card p-4 space-y-3">
      {/* 标题行 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium truncate block">
            {job.essay.title ?? job.essay.id}
          </span>
          <span className="text-xs subtle">{job.essay.student.name}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              isDone
                ? "bg-green-100 text-green-700"
                : isError
                  ? "bg-red-100 text-red-700"
                  : isPending
                    ? "bg-slate-100 text-slate-500"
                    : "bg-blue-100 text-blue-700"
            }`}
          >
            {isActive && <Spinner className="h-3 w-3 mr-0.5" />}
            {statusLabel}
          </span>
          {isError && (
            <button
              onClick={onRetry}
              className="btn btn-warn text-xs py-0.5 px-2"
            >
              重试
            </button>
          )}
          {!isActive && (
            <button
              onClick={onDelete}
              className="btn btn-secondary text-xs py-0.5 px-2"
            >
              删除
            </button>
          )}
        </div>
      </div>

      {/* 阶段进度条 */}
      {!isPending && (
        <div className="flex items-center gap-1 text-xs">
          {STEPS.map((step, idx) => {
            const cur = stepOrder(currentStep);
            const pos = stepOrder(step);
            const state = isError
              ? pos < stepOrder(currentStep) || currentStep === step
                ? "done"
                : "inactive"
              : pos < cur
                ? "done"
                : pos === cur
                  ? "active"
                  : "inactive";
            return (
              <span key={step} className="flex items-center gap-1">
                {idx > 0 && (
                  <span
                    className={`h-px w-5 ${state === "done" || pos <= cur ? "bg-green-300" : "bg-slate-200"}`}
                  />
                )}
                <span
                  className={`rounded-full px-2 py-0.5 ${
                    isDone && step === "done"
                      ? "bg-green-100 text-green-700 font-semibold"
                      : state === "active"
                        ? "bg-blue-100 text-blue-700 font-semibold"
                        : state === "done"
                          ? "bg-green-50 text-green-600"
                          : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {step === "ocr" && isActive && currentStep === "ocr" && (
                    <Spinner className="h-2.5 w-2.5 mr-0.5" />
                  )}
                  {STEP_LABELS[step]}
                </span>
              </span>
            );
          })}
        </div>
      )}

      {/* 重试提示 */}
      {live?.retrying && (
        <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-1.5">
          ↻ {live.retrying}
        </p>
      )}

      {/* 出错详情 */}
      {isError && (live?.errorMsg || job.errorMsg) && (
        <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-1.5">
          {live?.errorMsg ?? job.errorMsg}
        </p>
      )}

      {/* 题目标签 */}
      {topicTitle && !isError && (
        <p className="text-xs subtle">
          题目：<span className="text-foreground font-medium">{topicTitle}</span>
        </p>
      )}

      {/* 评分结果 */}
      {(isDone || (currentStep === "scoring" && Object.keys(scores).length > 0)) && (
        <div className="space-y-1.5">
          {isDone && (
            <div className="text-base font-semibold text-blue-700">
              总分：<span className="text-2xl">{totalScore}</span>
              <span className="text-sm font-normal subtle ml-1">/ 60</span>
            </div>
          )}
          <table className="apple-table text-xs">
            <thead>
              <tr>
                <th className="text-left">维度</th>
                <th className="text-right">得分</th>
                <th className="text-right subtle">满分</th>
                <th className="text-left pl-3">简评</th>
              </tr>
            </thead>
            <tbody>
              {DIMENSIONS.map((dim) => {
                const r = scores[dim.key];
                if (!r && !isDone) return null;
                const score = r?.score ?? null;
                const brief = r?.brief ?? "—";
                const pct = score != null ? score / dim.max : 0;
                const bar =
                  pct >= 0.85
                    ? "bg-green-400"
                    : pct >= 0.6
                      ? "bg-blue-400"
                      : "bg-amber-400";
                return (
                  <tr key={dim.key}>
                    <td>{dim.label}</td>
                    <td className="text-right font-semibold">
                      {score ?? (
                        <span className="text-slate-300">
                          {isActive && currentStep === "scoring" ? (
                            <Spinner className="h-3 w-3" />
                          ) : (
                            "—"
                          )}
                        </span>
                      )}
                    </td>
                    <td className="text-right subtle">{dim.max}</td>
                    <td className="pl-3 max-w-xs">
                      {score != null && (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-14 rounded-full bg-slate-100 overflow-hidden flex-shrink-0">
                            <div
                              className={`h-full rounded-full ${bar}`}
                              style={{ width: `${pct * 100}%` }}
                            />
                          </div>
                          <span className="subtle truncate">{brief}</span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

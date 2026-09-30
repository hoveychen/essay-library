"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Essay,
  ScoringResult,
  Student,
  Topic,
  getEssays,
  getStudents,
  getTopics,
  getCurrentScoringPrompts,
} from "@/lib/client-api";

const ALL = "__all__";

const DIMENSIONS: Record<string, string> = {
  topic_adherence_and_task: "审题扣题与任务完成",
  thesis_and_theme: "论点与立意",
  evidence_and_material: "论据与素材",
  logic_and_structure: "逻辑与结构",
  language_and_expression: "语言与表达",
};

/** 各维度满分：12+13+12+15+8 = 60，得分已为该维度实分，总分直接相加 */
const DIM_MAX: Record<string, number> = {
  topic_adherence_and_task: 12,
  thesis_and_theme: 13,
  evidence_and_material: 12,
  logic_and_structure: 15,
  language_and_expression: 8,
};
const TOTAL_MAX = Object.values(DIM_MAX).reduce((a, b) => a + b, 0);

const DIM_KEYS = Object.keys(DIMENSIONS);

type SortKey = "total" | typeof DIM_KEYS[number];
type SortDir = "asc" | "desc";

type BatchProgress = { done: number; total: number } | null;

type ScoringSlotPhase = "idle" | "scoring" | "done" | "failed";

type ScoringSlot = {
  slotId: number;
  essayId?: string;
  studentName?: string;
  essayTitle?: string;
  dimension?: string;
  dimensionCn?: string;
  phase: ScoringSlotPhase;
  score?: number;
  brief?: string;
};

type SseEvent = {
  type: string;
  slotId?: number;
  essayId?: string;
  studentName?: string;
  essayTitle?: string;
  dimension?: string;
  dimensionCn?: string;
  phase?: string;
  score?: number;
  brief?: string;
  done?: number;
  total?: number;
  failed?: number;
  concurrency?: number;
};

export default function ScoringPage() {
  const [essays, setEssays] = useState<Essay[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [scoringResults, setScoringResults] = useState<ScoringResult[]>([]);
  const [currentPrompts, setCurrentPrompts] = useState<Record<string, string>>({});
  const [studentId, setStudentId] = useState(ALL);
  const [topicId, setTopicId] = useState(ALL);
  const [message, setMessage] = useState("就绪");
  const [batchProgress, setBatchProgress] = useState<BatchProgress>(null);
  const [batchSlots, setBatchSlots] = useState<ScoringSlot[]>([]);
  const [busyEssayId, setBusyEssayId] = useState<string | null>(null);
  const [rescoringIds, setRescoringIds] = useState<Set<string>>(new Set());
  const [selectedEssayId, setSelectedEssayId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  async function loadAll() {
    const [sData, tData, eData, prompts] = await Promise.all([
      getStudents(),
      getTopics(),
      getEssays(),
      getCurrentScoringPrompts(),
    ]);
    setStudents(sData);
    setTopics(tData);
    setEssays(eData);
    setCurrentPrompts(prompts);
    const res = await fetch("/api/scoring");
    if (res.ok) {
      setScoringResults(await res.json());
    }
  }

  useEffect(() => {
    loadAll().catch((e) => setMessage(`加载失败: ${String(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scoreMap = useMemo(() => {
    const map = new Map<string, Map<string, ScoringResult>>();
    for (const r of scoringResults) {
      if (!map.has(r.essayId)) map.set(r.essayId, new Map());
      map.get(r.essayId)!.set(r.dimension, r);
    }
    return map;
  }, [scoringResults]);

  const scorableEssays = useMemo(() => {
    let list = essays.filter((e) => e.ocrStatus === "DONE" && e.rawText?.trim());
    if (studentId !== ALL) {
      list = list.filter((e) => e.student.id === studentId);
    }
    if (topicId !== ALL) {
      list = list.filter(
        (e) =>
          e.matchedTopic?.id === topicId || e.suggestedTopic?.id === topicId,
      );
    }
    return list;
  }, [essays, studentId, topicId]);

  /** 已绑定题目、可进入批量队列的作文 */
  const scorableWithTopic = useMemo(
    () => scorableEssays.filter((e) => !!e.matchedTopic),
    [scorableEssays],
  );

  const missingTasks = useMemo(() => {
    const tasks: Array<{ essayId: string; dimension: string }> = [];
    for (const essay of scorableWithTopic) {
      const dimMap = scoreMap.get(essay.id);
      for (const dim of DIM_KEYS) {
        if (!dimMap?.has(dim)) {
          tasks.push({ essayId: essay.id, dimension: dim });
        }
      }
    }
    return tasks;
  }, [scorableWithTopic, scoreMap]);

  /** 有评分但 prompt 版本已过期的任务 */
  const staleTasks = useMemo(() => {
    if (Object.keys(currentPrompts).length === 0) return [];
    const tasks: Array<{ essayId: string; dimension: string }> = [];
    for (const essay of scorableWithTopic) {
      const dimMap = scoreMap.get(essay.id);
      for (const dim of DIM_KEYS) {
        const result = dimMap?.get(dim);
        if (result && result.promptSnapshot !== currentPrompts[dim]) {
          tasks.push({ essayId: essay.id, dimension: dim });
        }
      }
    }
    return tasks;
  }, [scorableWithTopic, scoreMap, currentPrompts]);

  const allPendingTasks = useMemo(
    () => [...missingTasks, ...staleTasks],
    [missingTasks, staleTasks],
  );

  function isDimStale(essayId: string, dim: string): boolean {
    if (Object.keys(currentPrompts).length === 0) return false;
    const result = scoreMap.get(essayId)?.get(dim);
    return !!result && result.promptSnapshot !== currentPrompts[dim];
  }

  const selectedEssay = scorableEssays.find((e) => e.id === selectedEssayId) ?? null;
  const selectedScores = selectedEssay ? scoreMap.get(selectedEssay.id) : undefined;

  async function scoreOne(essayId: string) {
    setBusyEssayId(essayId);
    setMessage("评分中…");
    try {
      const dimMap = scoreMap.get(essayId);
      const missingDims = DIM_KEYS.filter((k) => !dimMap?.has(k));
      if (missingDims.length === 0) {
        setMessage("该作文已全部评分");
        setBusyEssayId(null);
        return;
      }
      const res = await fetch(`/api/essays/${essayId}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dimensions: missingDims }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMessage(data.error || "评分失败");
      } else {
        setMessage("评分完成");
      }
    } catch (e) {
      setMessage(String(e));
    }
    await loadAll();
    setBusyEssayId(null);
  }

  async function rescoreOne(essayId: string) {
    setRescoringIds((prev) => new Set(prev).add(essayId));
    setMessage("重新评分中…");

    const tasks = DIM_KEYS.map((dim) => ({ essayId, dimension: dim }));

    try {
      const res = await fetch("/api/scoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks }),
      });

      if (!res.body) {
        setMessage("重新评分请求失败");
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
            let event: SseEvent;
            try {
              event = JSON.parse(part.slice(6)) as SseEvent;
            } catch {
              continue;
            }
            if (event.type === "complete") {
              setMessage(`重新评分完成：${event.done} 成功，${event.failed} 失败`);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (e) {
      setMessage(String(e));
    } finally {
      setRescoringIds((prev) => {
        const next = new Set(prev);
        next.delete(essayId);
        return next;
      });
    }

    await loadAll();
  }

  async function batchScore() {
    if (allPendingTasks.length === 0) {
      setMessage("没有需要评分的项目");
      return;
    }

    setBatchProgress({ done: 0, total: allPendingTasks.length });
    setBatchSlots([]);

    const res = await fetch("/api/scoring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasks: allPendingTasks.map((t) => ({
          essayId: t.essayId,
          dimension: t.dimension,
        })),
      }),
    });

    if (!res.body) {
      setMessage("批量评分请求失败");
      setBatchProgress(null);
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
          let event: SseEvent;
          try {
            event = JSON.parse(part.slice(6)) as SseEvent;
          } catch {
            continue;
          }

          if (event.type === "start") {
            setBatchSlots(
              Array.from({ length: event.concurrency as number }, (_, i) => ({
                slotId: i,
                phase: "idle" as ScoringSlotPhase,
              })),
            );
          } else if (event.type === "slot") {
            setBatchSlots((prev) =>
              prev.map((s) =>
                s.slotId === event.slotId
                  ? {
                      ...s,
                      essayId: event.essayId,
                      studentName: event.studentName,
                      essayTitle: event.essayTitle,
                      dimension: event.dimension,
                      dimensionCn: event.dimensionCn,
                      phase: event.phase as ScoringSlotPhase,
                      score: event.score,
                      brief: event.brief,
                    }
                  : s,
              ),
            );
          } else if (event.type === "progress") {
            setBatchProgress({
              done: event.done ?? 0,
              total: event.total ?? allPendingTasks.length,
            });
          } else if (event.type === "complete") {
            setMessage(
              `批量评分完成：${event.done} 成功，${event.failed} 失败`,
            );
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    setBatchProgress(null);
    setBatchSlots([]);
    await loadAll();
  }

  const batchBusy = !!batchProgress;

  function getScoreColor(score: number, dimKey: string): string {
    const max = DIM_MAX[dimKey] ?? 10;
    const ratio = max > 0 ? score / max : 0;
    if (ratio >= 0.85) return "bg-green-100 text-green-800";
    if (ratio >= 0.65) return "bg-blue-100 text-blue-800";
    if (ratio >= 0.45) return "bg-yellow-100 text-yellow-800";
    if (ratio >= 0.25) return "bg-orange-100 text-orange-800";
    return "bg-red-100 text-red-800";
  }

  function getTotalScoreColor(total: number): string {
    const ratio = total / TOTAL_MAX;
    if (ratio >= 0.9) return "bg-green-100 text-green-800";
    if (ratio >= 0.7) return "bg-blue-100 text-blue-800";
    if (ratio >= 0.5) return "bg-yellow-100 text-yellow-800";
    if (ratio >= 0.3) return "bg-orange-100 text-orange-800";
    return "bg-red-100 text-red-800";
  }

  /** 总分：各维度实分之和（每维已按满分 12/13/12/15/8 评定） */
  function getTotalScore(essayId: string): number | null {
    const dimMap = scoreMap.get(essayId);
    if (!dimMap || dimMap.size === 0) return null;
    let total = 0;
    let hasAny = false;
    for (const k of DIM_KEYS) {
      const r = dimMap.get(k);
      if (r) {
        total += r.score;
        hasAny = true;
      }
    }
    return hasAny ? total : null;
  }

  function getDimScore(essayId: string, dim: string): number | null {
    return scoreMap.get(essayId)?.get(dim)?.score ?? null;
  }

  function getMissingCount(essayId: string): number {
    const dimMap = scoreMap.get(essayId);
    return DIM_KEYS.filter((k) => !dimMap?.has(k)).length;
  }

  function getTopicTitle(essay: Essay): string {
    return essay.matchedTopic?.title ?? essay.suggestedTopic?.title ?? "";
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortedEssays = useMemo(() => {
    const list = [...scorableEssays];
    list.sort((a, b) => {
      let va: number | null;
      let vb: number | null;
      if (sortKey === "total") {
        va = getTotalScore(a.id);
        vb = getTotalScore(b.id);
      } else {
        va = getDimScore(a.id, sortKey);
        vb = getDimScore(b.id, sortKey);
      }
      // null sorts to bottom
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return sortDir === "desc" ? vb - va : va - vb;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scorableEssays, scoreMap, sortKey, sortDir]);

  // ── Layout: left list + right detail ──
  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left panel: compact list ── */}
      <div className="flex w-72 flex-shrink-0 flex-col overflow-hidden border-r border-gray-100 bg-gray-50/50">
        {/* Header + filters */}
        <div className="flex-shrink-0 space-y-2 border-b border-gray-100 px-4 py-4">
          <h1 className="text-lg font-bold text-gray-900">作文评分</h1>
          <p className="text-xs text-gray-500">{message}</p>
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-400 focus:outline-none"
          >
            <option value={ALL}>全部学生</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-400 focus:outline-none"
          >
            <option value={ALL}>全部题目</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={batchScore}
            disabled={batchBusy || allPendingTasks.length === 0}
            className="btn btn-primary w-full text-xs"
          >
            {batchProgress
              ? `评分中 ${batchProgress.done}/${batchProgress.total}…`
              : allPendingTasks.length === 0
                ? "全部已是最新"
                : `批量评分（${missingTasks.length > 0 ? `${missingTasks.length} 未评` : ""}${missingTasks.length > 0 && staleTasks.length > 0 ? " + " : ""}${staleTasks.length > 0 ? `${staleTasks.length} 旧版` : ""}）`}
          </button>
          {/* Sort controls */}
          <div className="flex flex-wrap gap-1">
            {[
              { key: "total" as SortKey, label: "总分" },
              ...DIM_KEYS.map((k) => ({ key: k as SortKey, label: DIMENSIONS[k].slice(0, 2) })),
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleSort(key)}
                className={`rounded px-1.5 py-0.5 text-xs transition-colors ${
                  sortKey === key
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {label}
                {sortKey === key && (sortDir === "desc" ? " ↓" : " ↑")}
              </button>
            ))}
          </div>
        </div>

        {/* Batch progress */}
        {batchProgress && (
          <div className="flex-shrink-0 border-b border-gray-100 px-4 py-3">
            <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
              <span>{batchSlots.length} 并发</span>
              <span>{Math.round((batchProgress.done / batchProgress.total) * 100)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-1.5 rounded-full bg-purple-500 transition-all duration-300"
                style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
              />
            </div>
            {batchSlots.filter((s) => s.phase === "scoring").length > 0 && (
              <div className="mt-2 space-y-1">
                {batchSlots
                  .filter((s) => s.phase === "scoring")
                  .map((slot) => (
                    <div key={slot.slotId} className="flex items-center gap-1.5 text-xs text-gray-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-purple-500 animate-pulse" />
                      <span className="truncate">
                        {slot.studentName} · {slot.dimensionCn}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Essay list */}
        <div className="flex-1 overflow-y-auto">
          {sortedEssays.map((essay) => {
            const dimMap = scoreMap.get(essay.id);
            const total = getTotalScore(essay.id);
            const isSelected = selectedEssayId === essay.id;
            const scoredCount = DIM_KEYS.filter((k) => dimMap?.has(k)).length;
            return (
              <button
                key={essay.id}
                type="button"
                onClick={() => setSelectedEssayId(isSelected ? null : essay.id)}
                className={`w-full border-b border-gray-100 px-4 py-3 text-left transition-colors ${
                  isSelected
                    ? "bg-blue-50 border-l-2 border-l-blue-500"
                    : "hover:bg-gray-100/60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {essay.student.name}
                  </span>
                  {total !== null ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${getTotalScoreColor(total)}`}>
                      {Math.round(total)}/{TOTAL_MAX}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs">
                  {essay.matchedTopic ? (
                    <span className="text-gray-500">{essay.matchedTopic.title}</span>
                  ) : (
                    <span className="text-red-400">未绑定题目</span>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  {DIM_KEYS.map((k) => {
                    const r = dimMap?.get(k);
                    const stale = r && isDimStale(essay.id, k);
                    return (
                      <span
                        key={k}
                        className={`inline-block h-5 w-5 rounded text-center text-xs leading-5 font-medium ${
                          r
                            ? stale
                              ? "bg-amber-100 text-amber-700 ring-1 ring-amber-300"
                              : getScoreColor(r.score, k)
                            : "bg-gray-100 text-gray-300"
                        }`}
                        title={r ? `${DIMENSIONS[k]}: ${r.score}/${DIM_MAX[k]}${stale ? "（旧版 prompt）" : ""}` : `${DIMENSIONS[k]}: 未评`}
                      >
                        {r ? r.score : "·"}
                      </span>
                    );
                  })}
                  <span className="ml-auto text-xs text-gray-400">
                    {scoredCount}/{DIM_KEYS.length}
                  </span>
                </div>
              </button>
            );
          })}
          {sortedEssays.length === 0 && (
            <p className="px-4 py-8 text-center text-xs text-gray-400">
              暂无可评分的作文
            </p>
          )}
        </div>
      </div>

      {/* ── Right panel: detail view ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {selectedEssay ? (
          <>
            {/* Detail header */}
            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-3">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-bold text-gray-900">
                  {selectedEssay.student.name}
                </h2>
                {selectedEssay.matchedTopic ? (
                  <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                    {selectedEssay.matchedTopic.title}
                  </span>
                ) : (
                  <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-600">
                    未绑定题目
                  </span>
                )}
                {(() => {
                  const isScoring = batchBusy || busyEssayId === selectedEssay.id;
                  const isRescoring = rescoringIds.has(selectedEssay.id);
                  const hasNoTopic = !selectedEssay.matchedTopic;
                  const missing = getMissingCount(selectedEssay.id);
                  const allScored = missing === 0;
                  return (
                    <div className="flex items-center gap-2">
                      {hasNoTopic ? (
                        <span
                          className="cursor-not-allowed rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-400"
                          title="请先在作文管理页完成题目匹配"
                        >
                          需先绑定题目
                        </span>
                      ) : missing > 0 ? (
                        <button
                          type="button"
                          onClick={() => scoreOne(selectedEssay.id)}
                          disabled={isScoring}
                          className="btn btn-primary px-3 py-1 text-xs"
                        >
                          {busyEssayId === selectedEssay.id ? "评分中…" : `评分（${missing}项）`}
                        </button>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500">已完成</span>
                      )}
                      {!hasNoTopic && allScored && (
                        <button
                          type="button"
                          onClick={() => rescoreOne(selectedEssay.id)}
                          disabled={isRescoring}
                          className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs text-gray-500 transition-colors hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isRescoring ? "评分中…" : "重新评分"}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Detail body: 3-column layout */}
            <div className="flex flex-1 overflow-hidden">
              {/* Col 1: Scores */}
              <div className="flex w-64 flex-shrink-0 flex-col overflow-y-auto border-r border-gray-100 px-4 py-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                  评分结果
                </p>
                <div className="space-y-2">
                  {DIM_KEYS.map((k) => {
                    const r = selectedScores?.get(k);
                    if (!r)
                      return (
                        <div
                          key={k}
                          className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3"
                        >
                          <div className="text-xs font-medium text-gray-400">
                            {DIMENSIONS[k]}
                          </div>
                          <div className="mt-1 text-xs text-gray-300">未评分</div>
                        </div>
                      );
                    let levelLabel: string | null = null;
                    if (r.extra) {
                      try {
                        const ex = JSON.parse(r.extra) as { level?: string };
                        if (typeof ex.level === "string") levelLabel = ex.level;
                      } catch {
                        /* ignore */
                      }
                    }
                    const dimStale = isDimStale(selectedEssay.id, k);
                    return (
                      <div
                        key={k}
                        className={`rounded-xl border p-3 ${dimStale ? "border-amber-200 bg-amber-50/60" : "border-white/80 bg-gray-50"}`}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-600">
                            {DIMENSIONS[k]}
                            <span className="ml-1 text-gray-400">({DIM_MAX[k]}分)</span>
                            {dimStale && (
                              <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700">
                                旧版
                              </span>
                            )}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-bold ${dimStale ? "bg-amber-100 text-amber-700" : getScoreColor(r.score, k)}`}
                          >
                            {r.score}/{DIM_MAX[k]}
                          </span>
                        </div>
                        {levelLabel ? (
                          <p className="mb-1 text-xs text-gray-500">等级：{levelLabel}</p>
                        ) : null}
                        <p className="text-xs leading-relaxed text-gray-600">
                          {r.brief}
                        </p>
                        <p className="mt-1.5 text-right text-[10px] text-gray-300">
                          {(() => {
                            const ts = r.updatedAt ?? r.createdAt;
                            const d = new Date(ts);
                            return isNaN(d.getTime()) ? "" : d.toLocaleString("zh-CN", {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            });
                          })()}
                        </p>
                      </div>
                    );
                  })}
                </div>
                {(() => {
                  const total = getTotalScore(selectedEssay.id);
                  return total !== null ? (
                    <div className="mt-3 flex items-center justify-between rounded-xl bg-gray-100 px-4 py-2">
                      <span className="text-xs font-medium text-gray-500">
                        总分
                      </span>
                      <span
                        className={`rounded-full px-3 py-0.5 text-sm font-bold ${getTotalScoreColor(total)}`}
                      >
                        {Math.round(total)}/{TOTAL_MAX}
                      </span>
                    </div>
                  ) : null;
                })()}
              </div>

              {/* Col 2: Essay text (takes remaining space) */}
              <div className="flex min-w-0 flex-1 flex-col overflow-y-auto border-r border-gray-100 px-5 py-4">
                <p className="mb-2 flex-shrink-0 text-xs font-medium uppercase tracking-wide text-gray-400">
                  作文正文
                </p>
                {selectedEssay.rawText ? (
                  <div className="whitespace-pre-wrap columns-2 gap-6 text-sm leading-loose text-gray-800">
                    {selectedEssay.rawText}
                  </div>
                ) : (
                  <div className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
                    暂无文本内容
                  </div>
                )}
              </div>

              {/* Col 3: Images (only if images exist) */}
              {selectedEssay.images && selectedEssay.images.length > 0 && (
                <div className="flex w-56 flex-shrink-0 flex-col overflow-y-auto px-3 py-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                    原图（{selectedEssay.images.length} 张）
                  </p>
                  <div className="space-y-2">
                    {selectedEssay.images.map((img) => (
                      <a
                        key={img.id}
                        href={img.publicPath}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.publicPath}
                          alt={img.originalName}
                          className="w-full rounded-lg border border-gray-100 object-contain shadow-sm"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-gray-400">
            <svg
              className="mb-3 h-12 w-12"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="text-sm">从左侧选择一篇作文查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}

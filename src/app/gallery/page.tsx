"use client";

import { useEffect, useState } from "react";
import { getEssays, getStudents, getTopics } from "@/lib/client-api";
import type { Essay, Student, Topic } from "@/lib/client-api";

export default function GalleryPage() {
  const [essays, setEssays] = useState<Essay[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterStudent, setFilterStudent] = useState<string>("all");
  const [filterTopic, setFilterTopic] = useState<string>("all");

  const [selectedEssay, setSelectedEssay] = useState<Essay | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);

  useEffect(() => {
    Promise.all([getEssays(), getStudents(), getTopics()]).then(
      ([e, s, t]) => {
        setEssays(e);
        setStudents(s);
        setTopics(t);
        setLoading(false);
      }
    );
  }, []);

  useEffect(() => {
    if (selectedEssay) {
      requestAnimationFrame(() => setDrawerVisible(true));
    } else {
      setDrawerVisible(false);
    }
  }, [selectedEssay]);

  function closeDrawer() {
    setDrawerVisible(false);
    setTimeout(() => setSelectedEssay(null), 300);
  }

  const filtered = essays.filter((e) => {
    if (filterStudent !== "all" && e.student?.id !== filterStudent) return false;
    const topicId = e.matchedTopic?.id ?? e.suggestedTopic?.id ?? null;
    if (filterTopic !== "all" && topicId !== filterTopic) return false;
    return true;
  });

  function getTopicLabel(essay: Essay): { text: string; color: string } {
    if (essay.matchedTopic) {
      return { text: essay.matchedTopic.title, color: "bg-green-100 text-green-700" };
    }
    if (essay.suggestedTopic) {
      return { text: essay.suggestedTopic.title, color: "bg-yellow-100 text-yellow-700" };
    }
    return { text: "未匹配题目", color: "bg-gray-100 text-gray-500" };
  }

  function getOcrBadge(essay: Essay): { text: string; color: string } | null {
    if (essay.ocrStatus === "DONE") return null;
    if (essay.ocrStatus === "PROCESSING") return { text: "识别中", color: "bg-blue-100 text-blue-600" };
    if (essay.ocrStatus === "FAILED") return { text: "识别失败", color: "bg-red-100 text-red-600" };
    return { text: "待识别", color: "bg-gray-100 text-gray-500" };
  }

  function getPreview(essay: Essay): string {
    const text = essay.rawText?.trim();
    if (!text) return "（暂无文本内容）";
    return text.length > 120 ? text.slice(0, 120) + "…" : text;
  }

  return (
    // 整页用 flex row，高度撑满视口内容区
    <div className="flex h-full overflow-hidden">

      {/* ── 左侧：卡片区域，flex-1 自动收窄 ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-8 md:px-8">

        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">作文板块</h1>
            <p className="mt-1 text-sm text-gray-500">
              共 {filtered.length} 篇作文
              {filtered.length !== essays.length && `（已从 ${essays.length} 篇中筛选）`}
            </p>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={filterStudent}
              onChange={(e) => setFilterStudent(e.target.value)}
            >
              <option value="all">全部学生</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            <select
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={filterTopic}
              onChange={(e) => setFilterTopic(e.target.value)}
            >
              <option value="all">全部题目</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>

            {(filterStudent !== "all" || filterTopic !== "all") && (
              <button
                onClick={() => { setFilterStudent("all"); setFilterTopic("all"); }}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-500 shadow-sm hover:bg-gray-50 hover:text-gray-700"
              >
                清除筛选
              </button>
            )}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <span className="ml-3 text-gray-500">加载中…</span>
          </div>
        )}

        {/* Empty */}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <svg className="mb-3 h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">暂无符合条件的作文</p>
          </div>
        )}

        {/* Cards Grid */}
        {!loading && filtered.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((essay) => {
              const topic = getTopicLabel(essay);
              const ocrBadge = getOcrBadge(essay);
              const isSelected = selectedEssay?.id === essay.id;
              return (
                <button
                  key={essay.id}
                  onClick={() => isSelected ? closeDrawer() : setSelectedEssay(essay)}
                  className={`group relative flex h-80 flex-col rounded-2xl border bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                    isSelected
                      ? "border-blue-400 ring-2 ring-blue-200"
                      : "border-gray-100 hover:border-blue-200"
                  }`}
                >
                  {/* Student name */}
                  <div className="mb-2 flex flex-shrink-0 items-center justify-between gap-2">
                    <span className="text-base font-semibold text-gray-900">
                      {essay.student?.name ?? "未知学生"}
                    </span>
                    {ocrBadge && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ocrBadge.color}`}>
                        {ocrBadge.text}
                      </span>
                    )}
                  </div>

                  {/* Topic badge */}
                  <span className={`mb-3 flex-shrink-0 self-start rounded-full px-2.5 py-0.5 text-xs font-medium ${topic.color}`}>
                    {topic.text}
                  </span>

                  {/* Preview: image if not OCR'd, text if OCR'd */}
                  {essay.rawText ? (
                    <p className="min-h-0 flex-1 overflow-hidden text-sm leading-relaxed text-gray-500 line-clamp-4">
                      {getPreview(essay)}
                    </p>
                  ) : essay.images && essay.images.length > 0 ? (
                    <div className="min-h-0 flex-1 overflow-hidden rounded-lg">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={essay.images[0].publicPath}
                        alt="作文图片"
                        className="h-full w-full object-cover object-top transition-transform group-hover:scale-[1.02]"
                      />
                    </div>
                  ) : (
                    <p className="flex-1 text-sm text-gray-400">（暂无内容）</p>
                  )}

                  <div className="absolute inset-0 rounded-2xl ring-0 transition group-hover:ring-1 group-hover:ring-blue-200" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 右侧：抽屉，宽度从 0 过渡到 480px ── */}
      <div
        className="flex-shrink-0 overflow-hidden border-l border-gray-100 bg-white transition-all duration-300 ease-in-out"
        style={{ width: drawerVisible ? "480px" : "0px" }}
      >
        {selectedEssay && (
          <div className="flex h-full w-[480px] flex-col">
            {/* Drawer Header */}
            <div className="flex flex-shrink-0 items-start justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {selectedEssay.student?.name ?? "未知学生"} 的作文
                </h2>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {(() => {
                    const topic = getTopicLabel(selectedEssay);
                    return (
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${topic.color}`}>
                        {topic.text}
                      </span>
                    );
                  })()}
                  {selectedEssay.matchStatus === "CONFIRMED" && (
                    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                      已确认
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={closeDrawer}
                className="ml-4 flex-shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="关闭"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* Essay Text */}
              <div className="mb-5">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                  作文正文
                </p>
                {selectedEssay.rawText ? (
                  <div className="whitespace-pre-wrap rounded-xl bg-gray-50 px-4 py-3 text-sm leading-loose text-gray-800">
                    {selectedEssay.rawText}
                  </div>
                ) : (
                  <div className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
                    {selectedEssay.ocrStatus === "PROCESSING"
                      ? "正在识别中，请稍候…"
                      : selectedEssay.ocrStatus === "FAILED"
                      ? "OCR 识别失败，暂无文本"
                      : "暂无文本内容，请先进行 OCR 识别"}
                  </div>
                )}
              </div>

              {/* Suggested reason */}
              {selectedEssay.suggestedReason && (
                <div className="mb-5">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                    匹配理由
                  </p>
                  <p className="text-sm text-gray-600">{selectedEssay.suggestedReason}</p>
                </div>
              )}

              {/* Images */}
              {selectedEssay.images && selectedEssay.images.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                    原图（{selectedEssay.images.length} 张）
                  </p>
                  <div className="flex flex-col gap-3">
                    {selectedEssay.images.map((img) => (
                      <a key={img.id} href={img.publicPath} target="_blank" rel="noreferrer">
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
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Essay, Student, Topic, getEssays, getStudents, getTopics } from "@/lib/client-api";

type DrawerState = {
  studentName: string;
  topicTitle: string;
  essays: Essay[];
} | null;

export default function StatsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [essays, setEssays] = useState<Essay[]>([]);
  const [message, setMessage] = useState("就绪");
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [selectedEssay, setSelectedEssay] = useState<Essay | null>(null);

  useEffect(() => {
    Promise.all([getStudents(), getTopics(), getEssays()])
      .then(([studentData, topicData, essayData]) => {
        setStudents(studentData);
        setTopics(topicData);
        setEssays(essayData);
      })
      .catch((e) => setMessage(`加载失败: ${String(e)}`));
  }, []);

  useEffect(() => {
    if (drawer) {
      requestAnimationFrame(() => setDrawerVisible(true));
    } else {
      setDrawerVisible(false);
    }
  }, [drawer]);

  function closeDrawer() {
    setDrawerVisible(false);
    setTimeout(() => {
      setDrawer(null);
      setSelectedEssay(null);
    }, 300);
  }

  function openDrawer(studentName: string, topicTitle: string, targetEssays: Essay[]) {
    setSelectedEssay(null);
    setDrawer({ studentName, topicTitle, essays: targetEssays });
  }

  const essaysByStudent = useMemo(() => {
    const map = new Map<string, Essay[]>();
    for (const essay of essays) {
      const list = map.get(essay.student.id) || [];
      list.push(essay);
      map.set(essay.student.id, list);
    }
    return map;
  }, [essays]);

  function getTopicEssays(studentId: string, topicId: string) {
    const ownEssays = essaysByStudent.get(studentId) || [];
    return ownEssays.filter((essay) => essay.matchedTopic?.id === topicId);
  }

  function getUnmatchedEssays(studentId: string) {
    const ownEssays = essaysByStudent.get(studentId) || [];
    return ownEssays.filter((essay) => !essay.matchedTopic);
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左侧：表格区域 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-8 md:px-8">
        <h1 className="title-lg mb-1">学生-题目作文统计</h1>
        <p className="status-bar mb-4">{message}</p>
        <section className="glass-card overflow-x-auto p-1">
          <table className="apple-table min-w-full">
            <thead>
              <tr>
                <th className="text-left">学生</th>
                {topics.map((topic) => (
                  <th key={topic.id} className="text-center">
                    {topic.title}
                  </th>
                ))}
                <th className="text-center">未匹配</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id}>
                  <td className="font-medium">{student.name}</td>
                  {topics.map((topic) => {
                    const cellEssays = getTopicEssays(student.id, topic.id);
                    return (
                      <td key={`${student.id}-${topic.id}`} className="text-center">
                        {cellEssays.length > 0 ? (
                          <button
                            type="button"
                            className="inline-flex h-7 min-w-7 items-center justify-center rounded-lg bg-blue-50 px-2 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-100"
                            onClick={() => openDrawer(student.name, topic.title, cellEssays)}
                          >
                            {cellEssays.length}
                          </button>
                        ) : (
                          <span className="text-zinc-300">-</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-center">
                    {(() => {
                      const unmatched = getUnmatchedEssays(student.id);
                      return unmatched.length > 0 ? (
                        <button
                          type="button"
                          className="inline-flex h-7 min-w-7 items-center justify-center rounded-lg bg-amber-50 px-2 text-xs font-semibold text-amber-600 transition-colors hover:bg-amber-100"
                          onClick={() => openDrawer(student.name, "未匹配作文", unmatched)}
                        >
                          {unmatched.length}
                        </button>
                      ) : (
                        <span className="text-zinc-300">-</span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
              {students.length === 0 ? (
                <tr>
                  <td className="py-3 text-center text-zinc-500" colSpan={topics.length + 2}>
                    暂无学生数据
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>

      {/* 右侧：抽屉 */}
      <div
        className="flex-shrink-0 overflow-hidden border-l border-gray-100 bg-white transition-all duration-300 ease-in-out"
        style={{ width: drawerVisible ? "480px" : "0px" }}
      >
        {drawer && (
          <div className="flex h-full w-[480px] flex-col">
            {/* Drawer Header */}
            <div className="flex flex-shrink-0 items-start justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {drawer.studentName} - {drawer.topicTitle}
                </h2>
                <p className="mt-1 text-sm text-gray-500">{drawer.essays.length} 篇作文</p>
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
            <div className="flex-1 overflow-y-auto">
              {selectedEssay ? (
                /* 单篇作文详情 */
                <div className="px-6 py-5">
                  <button
                    type="button"
                    onClick={() => setSelectedEssay(null)}
                    className="mb-4 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    返回列表
                  </button>

                  <h3 className="mb-4 text-base font-semibold text-gray-900">
                    {selectedEssay.title || "未命名作文"}
                  </h3>

                  {/* 文本 */}
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
                        暂无文本内容
                      </div>
                    )}
                  </div>

                  {/* 扫描图 */}
                  {selectedEssay.images && selectedEssay.images.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                        原图（{selectedEssay.images.length} 张）
                      </p>
                      <div className="flex flex-col gap-3">
                        {selectedEssay.images.map((img) => (
                          <a key={img.id} href={img.publicPath} target="_blank" rel="noreferrer">
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
              ) : (
                /* 作文列表 */
                <div className="flex flex-col">
                  {drawer.essays.map((essay) => (
                    <button
                      key={essay.id}
                      type="button"
                      onClick={() => setSelectedEssay(essay)}
                      className="flex items-center gap-3 border-b border-gray-50 px-6 py-4 text-left transition-colors hover:bg-gray-50"
                    >
                      {/* 缩略图 */}
                      {essay.images && essay.images.length > 0 ? (
                        <img
                          src={essay.images[0].publicPath}
                          alt="缩略图"
                          className="h-14 w-14 flex-shrink-0 rounded-lg border border-gray-100 object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400">
                          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900">
                          {essay.title || "未命名作文"}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-gray-500">
                          {essay.rawText
                            ? (essay.rawText.length > 60 ? essay.rawText.slice(0, 60) + "…" : essay.rawText)
                            : "暂无文本"}
                        </div>
                      </div>
                      <svg className="h-4 w-4 flex-shrink-0 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

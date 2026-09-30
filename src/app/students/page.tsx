"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Essay, Student, getEssays, getStudents } from "@/lib/client-api";

type StudentStats = {
  total: number;
  matched: number;
  unmatched: number;
};

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [essays, setEssays] = useState<Essay[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("就绪");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [studentData, essayData] = await Promise.all([getStudents(), getEssays()]);
    setStudents(studentData);
    setEssays(essayData);
  }

  function getStats(studentId: string): StudentStats {
    const ownEssays = essays.filter((essay) => essay.student.id === studentId);
    const matched = ownEssays.filter((essay) => Boolean(essay.matchedTopic)).length;
    return {
      total: ownEssays.length,
      matched,
      unmatched: ownEssays.length - matched,
    };
  }

  useEffect(() => {
    load().catch((e) => setMessage(`加载失败: ${String(e)}`));
  }, []);

  function startEdit(student: Student) {
    setEditingId(student.id);
    setEditingName(student.name);
    setTimeout(() => editInputRef.current?.focus(), 0);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName("");
  }

  async function saveEdit(id: string) {
    if (!editingName.trim()) return;
    const res = await fetch(`/api/students/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingName.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "改名失败");
      return;
    }
    setMessage("姓名已更新");
    setEditingId(null);
    setEditingName("");
    await load();
  }

  async function createStudent(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const res = await fetch("/api/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "新增失败");
      return;
    }
    setName("");
    setMessage("学生已创建");
    await load();
  }

  return (
    <main className="page-wrap space-y-4">
      <h1 className="title-lg">学生库</h1>
      <p className="status-bar">{message}</p>
      <form onSubmit={createStudent} className="glass-card space-y-2 p-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field"
          placeholder="学生姓名"
        />
        <button className="btn btn-primary" type="submit">
          新增学生
        </button>
      </form>
      <section className="space-y-3">
        <h2 className="font-semibold">学生列表</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {students.map((s) => (
            <article key={s.id} className="glass-card p-4">
              {editingId === s.id ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={editInputRef}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit(s.id);
                      if (e.key === "Escape") cancelEdit();
                    }}
                    className="field flex-1 text-base font-semibold"
                  />
                  <button
                    className="btn btn-primary px-2 py-1 text-xs"
                    onClick={() => saveEdit(s.id)}
                  >
                    保存
                  </button>
                  <button
                    className="btn px-2 py-1 text-xs"
                    onClick={cancelEdit}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="text-base font-semibold">{s.name}</div>
                  <button
                    className="btn px-2 py-1 text-xs"
                    onClick={() => startEdit(s)}
                    title="改名"
                  >
                    改名
                  </button>
                </div>
              )}
              <div className="mt-1 text-xs subtle">ID: {s.id.slice(0, 8)}</div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-xl bg-white/70 p-2">
                  <div className="subtle">总作文</div>
                  <div className="text-lg font-semibold">{getStats(s.id).total}</div>
                </div>
                <div className="rounded-xl bg-white/70 p-2">
                  <div className="subtle">已匹配</div>
                  <div className="text-lg font-semibold text-emerald-700">
                    {getStats(s.id).matched}
                  </div>
                </div>
                <div className="rounded-xl bg-white/70 p-2">
                  <div className="subtle">未匹配</div>
                  <div className="text-lg font-semibold text-amber-700">
                    {getStats(s.id).unmatched}
                  </div>
                </div>
              </div>
            </article>
          ))}
          {students.length === 0 ? <p className="text-sm">暂无学生</p> : null}
        </div>
      </section>
    </main>
  );
}

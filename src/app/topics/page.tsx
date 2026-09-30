"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Topic, getTopics } from "@/lib/client-api";

type EditDraft = { title: string; requirements: string };

export default function TopicsPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [title, setTitle] = useState("");
  const [requirements, setRequirements] = useState("");
  const [message, setMessage] = useState("就绪");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>({ title: "", requirements: "" });
  const editTitleRef = useRef<HTMLInputElement>(null);

  async function load() {
    setTopics(await getTopics());
  }

  useEffect(() => {
    load().catch((e) => setMessage(`加载失败: ${String(e)}`));
  }, []);

  function startEdit(topic: Topic) {
    setEditingId(topic.id);
    setDraft({ title: topic.title, requirements: topic.requirements });
    setTimeout(() => editTitleRef.current?.focus(), 0);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft({ title: "", requirements: "" });
  }

  async function saveEdit(id: string) {
    if (!draft.title.trim() || !draft.requirements.trim()) return;
    const res = await fetch(`/api/topics/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: draft.title.trim(), requirements: draft.requirements.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "修改失败");
      return;
    }
    setMessage("题目已更新");
    setEditingId(null);
    setDraft({ title: "", requirements: "" });
    await load();
  }

  async function createTopic(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !requirements.trim()) return;
    const res = await fetch("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), requirements: requirements.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "新增失败");
      return;
    }
    setTitle("");
    setRequirements("");
    setMessage("题目已创建");
    await load();
  }

  return (
    <main className="page-wrap space-y-4">
      <h1 className="title-lg">题目库</h1>
      <p className="status-bar">{message}</p>
      <form onSubmit={createTopic} className="glass-card space-y-2 p-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="field"
          placeholder="题目标题"
        />
        <textarea
          value={requirements}
          onChange={(e) => setRequirements(e.target.value)}
          className="field h-28"
          placeholder="题目要求"
        />
        <button className="btn btn-primary" type="submit">
          新增题目
        </button>
      </form>
      <section className="glass-card p-4">
        <h2 className="mb-2 font-semibold">题目列表</h2>
        <div className="space-y-2">
          {topics.map((t) => (
            <article key={t.id} className="rounded-xl bg-white/70 p-3">
              {editingId === t.id ? (
                <div className="space-y-2">
                  <input
                    ref={editTitleRef}
                    value={draft.title}
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    className="field font-medium"
                    placeholder="题目标题"
                  />
                  <textarea
                    value={draft.requirements}
                    onChange={(e) => setDraft((d) => ({ ...d, requirements: e.target.value }))}
                    className="field h-24 text-sm"
                    placeholder="题目要求"
                  />
                  <div className="flex gap-2">
                    <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => saveEdit(t.id)}>
                      保存
                    </button>
                    <button className="btn px-2 py-1 text-xs" onClick={cancelEdit}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">{t.title}</div>
                    <button
                      className="btn shrink-0 px-2 py-1 text-xs"
                      onClick={() => startEdit(t)}
                    >
                      编辑
                    </button>
                  </div>
                  <div className="text-sm subtle">{t.requirements}</div>
                </div>
              )}
            </article>
          ))}
          {topics.length === 0 ? <p className="text-sm">暂无题目</p> : null}
        </div>
      </section>
    </main>
  );
}

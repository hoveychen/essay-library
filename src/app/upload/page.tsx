"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRef } from "react";
import { Student, getStudents } from "@/lib/client-api";

type ReviewSegment = {
  studentId: string;
  studentName: string;
  article: string;
  sourceHeader: string;
  chineseChars: number;
  totalChars: number;
  warnings: string[];
  canImport: boolean;
};

export default function UploadPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [textFiles, setTextFiles] = useState<FileList | null>(null);
  const [groupMode, setGroupMode] = useState<
    "filename-prefix" | "single-essay" | "one-image-one-essay"
  >("filename-prefix");
  const [essayTitle, setEssayTitle] = useState("");
  const [batchPaste, setBatchPaste] = useState("");
  const [message, setMessage] = useState("就绪");
  const [reviewSegments, setReviewSegments] = useState<ReviewSegment[]>([]);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const reviewRef = useRef<HTMLElement | null>(null);

  async function loadStudents() {
    const data = await getStudents();
    setStudents(data);
    if (data.length && !studentId) setStudentId(data[0].id);
  }

  useEffect(() => {
    loadStudents().catch((e) => setMessage(`加载失败: ${String(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!studentId || !files?.length) {
      setMessage("请选择学生并上传图片");
      return;
    }

    const form = new FormData();
    form.append("studentId", studentId);
    form.append("groupMode", groupMode);
    if (essayTitle.trim()) form.append("essayTitle", essayTitle.trim());
    Array.from(files).forEach((f) => form.append("images", f));

    const res = await fetch("/api/essays", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "上传失败");
      return;
    }

    setMessage(`上传完成，共创建 ${data.createdCount} 篇作文`);
    setEssayTitle("");
    setFiles(null);
    const input = document.getElementById("upload-files") as HTMLInputElement;
    if (input) input.value = "";
  }

  async function uploadTextFiles(e: FormEvent) {
    e.preventDefault();
    if (!studentId || !textFiles?.length) {
      setMessage("请选择学生并上传至少一个文本文件");
      return;
    }

    const form = new FormData();
    form.append("studentId", studentId);
    Array.from(textFiles).forEach((f) => form.append("texts", f));

    const res = await fetch("/api/essays/text-upload", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "文本上传失败");
      return;
    }

    setMessage(
      `文本导入完成：新增 ${data.createdCount} 篇，跳过 ${data.skippedCount} 个空文件`,
    );
    setTextFiles(null);
    const input = document.getElementById("upload-text-files") as HTMLInputElement;
    if (input) input.value = "";
  }

  async function importByPasteFormat(e: FormEvent) {
    e.preventDefault();
    if (!batchPaste.trim()) {
      setMessage("请先粘贴内容");
      return;
    }

    const res = await fetch("/api/essays/paste-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payload: batchPaste,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "解析失败");
      return;
    }

    const segments = (Array.isArray(data.segments) ? data.segments : []).map(
      (seg: Partial<ReviewSegment>) =>
        ({
          studentId: seg.studentId || "",
          studentName: seg.studentName || "未知学生",
          article: seg.article || "",
          sourceHeader: seg.sourceHeader || "",
          chineseChars: typeof seg.chineseChars === "number" ? seg.chineseChars : 0,
          totalChars: typeof seg.totalChars === "number" ? seg.totalChars : 0,
          warnings: Array.isArray(seg.warnings) ? seg.warnings : [],
          canImport: Boolean(seg.canImport),
        }) satisfies ReviewSegment,
    );
    setReviewSegments(segments);
    setSelectedIndexes(
      segments
        .map((seg: ReviewSegment, idx: number) => ({ idx, canImport: seg.canImport }))
        .filter((item: { idx: number; canImport: boolean }) => item.canImport)
        .map((item: { idx: number; canImport: boolean }) => item.idx),
    );
    setMessage(
      `解析完成：共 ${data.parsedCount} 段，可导入 ${data.importableCount} 段。已生成 Review，请在下方确认后导入。`,
    );
    setTimeout(() => {
      reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }

  function toggleSegment(index: number) {
    setSelectedIndexes((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  }

  async function confirmImportReviewed() {
    const selected = selectedIndexes
      .map((idx) => reviewSegments[idx])
      .filter((seg) => seg && seg.canImport)
      .map((seg) => ({
        studentId: seg.studentId,
        studentName: seg.studentName,
        article: seg.article,
        sourceHeader: seg.sourceHeader,
      }));

    if (selected.length === 0) {
      setMessage("请至少勾选一篇可导入作文");
      return;
    }

    const res = await fetch("/api/essays/paste-import/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "确认导入失败");
      return;
    }

    setMessage(`导入完成：成功导入 ${data.importedCount} 篇作文`);
    setBatchPaste("");
    setReviewSegments([]);
    setSelectedIndexes([]);
  }

  return (
    <main className="page-wrap space-y-6">
      <h1 className="title-lg">上传作文扫描图</h1>
      <p className="status-bar">{message}</p>
      <form onSubmit={upload} className="glass-card space-y-3 p-4">
        <h2 className="font-semibold">图片上传（OCR前）</h2>
        <select
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          className="field"
        >
          <option value="">请选择学生</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          id="upload-files"
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => setFiles(e.target.files)}
          className="field"
        />
        <div className="space-y-1">
          <div className="text-sm subtle">分组方式</div>
          <select
            value={groupMode}
            onChange={(e) =>
              setGroupMode(
                e.target.value as "filename-prefix" | "single-essay" | "one-image-one-essay",
              )
            }
            className="field"
          >
            <option value="filename-prefix">按文件名前缀分组（推荐）</option>
            <option value="single-essay">所有文件合并为同一篇</option>
            <option value="one-image-one-essay">每张图单独成篇</option>
          </select>
          <p className="text-xs subtle">
            按前缀分组规则：文件名形如 `gs_1.jpg`、`gs_2.jpg`，会归为同一篇“gs”，并按 1/2/3
            页顺序排序。
          </p>
        </div>
        <input
          value={essayTitle}
          onChange={(e) => setEssayTitle(e.target.value)}
          placeholder="可选：作文标题前缀（按前缀分组时会变成 你的标题-文件前缀）"
          className="field"
        />
        <button className="btn btn-primary" type="submit">
          上传
        </button>
      </form>

      <form onSubmit={uploadTextFiles} className="glass-card space-y-3 p-4">
        <h2 className="font-semibold">文本文件上传（等效 OCR 结果）</h2>
        <select
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          className="field"
        >
          <option value="">请选择学生</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          id="upload-text-files"
          type="file"
          multiple
          accept=".txt,.md,text/plain,text/markdown"
          onChange={(e) => setTextFiles(e.target.files)}
          className="field"
        />
        <p className="text-xs subtle">
          你可以一次上传多个文本文件，每个文件会作为一篇作文直接入库（跳过 OCR）。
        </p>
        <button className="btn btn-success" type="submit">
          批量上传文本
        </button>
      </form>

      <form onSubmit={importByPasteFormat} className="glass-card space-y-3 p-4">
        <h2 className="font-semibold">快捷粘贴导入（按【学生名】分段）</h2>
        <p className="text-xs subtle">
          直接粘贴多篇长文本，系统会通过“学生姓名匹配”进行自动分段；并按启发式规则做质量检查（如中文字符不能过短/过长）。
          先 review，再手工确认导入。
        </p>
        <textarea
          value={batchPaste}
          onChange={(e) => setBatchPaste(e.target.value)}
          className="field h-64"
          placeholder="【张三】
这里是张三的作文全文...
【李四】
这里是李四的作文全文..."
        />
        <button className="btn btn-warn" type="submit">
          解析并生成 Review
        </button>
        {reviewSegments.length > 0 ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
            已生成 {reviewSegments.length} 条 Review，已自动勾选 {selectedIndexes.length} 条可导入内容。
          </div>
        ) : null}
      </form>

      {reviewSegments.length > 0 ? (
        <section ref={reviewRef} className="glass-card space-y-3 p-4">
          <h3 className="font-semibold">Review（确认后才导入）</h3>
          <div className="space-y-3">
            {reviewSegments.map((seg, idx) => {
              const selected = selectedIndexes.includes(idx);
              return (
                <article
                  key={`${seg.studentId}-${idx}`}
                  className={`rounded-2xl border p-3 ${
                    seg.canImport ? "border-slate-300 bg-white/70" : "border-red-300 bg-red-50/80"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm">
                      <strong>{seg.studentName}</strong> ｜ 中文字数 {seg.chineseChars} ｜ 总字符{" "}
                      {seg.totalChars}
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!seg.canImport}
                        onChange={() => toggleSegment(idx)}
                      />
                      选中导入
                    </label>
                  </div>
                  <div className="text-xs subtle">分段头：{seg.sourceHeader}</div>
                  {seg.warnings.length > 0 ? (
                    <div className="mt-1 text-xs text-red-600">规则提示：{seg.warnings.join("；")}</div>
                  ) : null}
                  <pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-white p-2 text-xs whitespace-pre-wrap">
                    {seg.article.slice(0, 800)}
                    {seg.article.length > 800 ? "\n...(已截断)" : ""}
                  </pre>
                </article>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" type="button" onClick={confirmImportReviewed}>
              确认导入选中项
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => {
                setReviewSegments([]);
                setSelectedIndexes([]);
              }}
            >
              清空 Review
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}

import { NextResponse } from "next/server";
import { validateSegmentContent } from "@/lib/paste-import";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type ConfirmItem = {
  studentId?: string;
  studentName?: string;
  article?: string;
  sourceHeader?: string;
};

type Body = {
  selected?: ConfirmItem[];
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const selected = Array.isArray(body.selected) ? body.selected : [];
  if (selected.length === 0) {
    return NextResponse.json({ error: "请至少选择一篇作文进行导入" }, { status: 400 });
  }

  const studentIds = [...new Set(selected.map((item) => item.studentId).filter(Boolean))] as string[];
  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, name: true },
  });
  const studentMap = new Map(students.map((s) => [s.id, s]));

  const invalidStudents = studentIds.filter((id) => !studentMap.has(id));
  if (invalidStudents.length > 0) {
    return NextResponse.json(
      { error: `找不到学生ID：${invalidStudents.join("、")}` },
      { status: 400 },
    );
  }

  const invalidSegments: Array<{ index: number; reason: string }> = [];
  const rows = selected.map((item, index) => {
    const studentId = item.studentId?.trim() || "";
    const articleRaw = item.article || "";
    const valid = validateSegmentContent(articleRaw);
    if (!studentId) {
      invalidSegments.push({ index, reason: "缺少 studentId" });
      return null;
    }
    if (!valid.canImport) {
      invalidSegments.push({
        index,
        reason: valid.warnings.join("；"),
      });
      return null;
    }

    return {
      studentId,
      title: `粘贴导入-${studentMap.get(studentId)?.name || "未知学生"}-${new Date().toISOString()}`,
      rawText: valid.normalized,
      ocrStatus: "DONE" as const,
      ocrPromptSnapshot: `PASTE_IMPORT_REVIEW:${item.sourceHeader || "UNKNOWN"}`,
      matchStatus: "PENDING" as const,
    };
  });

  if (invalidSegments.length > 0) {
    return NextResponse.json(
      {
        error: "存在不满足启发式规则的段落，请先调整后再导入",
        invalidSegments,
      },
      { status: 400 },
    );
  }

  await prisma.$transaction(
    rows
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map((row) => prisma.essay.create({ data: row })),
  );

  return NextResponse.json({
    importedCount: rows.length,
  });
}

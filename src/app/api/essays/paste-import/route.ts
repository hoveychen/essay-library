import { NextResponse } from "next/server";
import { buildReviewSegments } from "@/lib/paste-import";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Body = {
  payload?: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const payload = body.payload?.trim();
  if (!payload) {
    return NextResponse.json({ error: "payload 不能为空" }, { status: 400 });
  }

  const students = await prisma.student.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  const reviewSegments = buildReviewSegments(payload, students);
  if (!reviewSegments.length) {
    return NextResponse.json(
      {
        error:
          "未解析到有效内容。请确保每段以学生姓名开头，并且正文长度合理。",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    parsedCount: reviewSegments.length,
    importableCount: reviewSegments.filter((s) => s.canImport).length,
    blockedCount: reviewSegments.filter((s) => !s.canImport).length,
    segments: reviewSegments,
  });
}

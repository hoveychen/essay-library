import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const studentId = form.get("studentId")?.toString();
  const files = form.getAll("texts").filter((f): f is File => f instanceof File);

  if (!studentId) {
    return NextResponse.json({ error: "必须选择学生" }, { status: 400 });
  }
  if (!files.length) {
    return NextResponse.json({ error: "请至少上传一个文本文件" }, { status: 400 });
  }

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) {
    return NextResponse.json({ error: "学生不存在" }, { status: 404 });
  }

  let createdCount = 0;
  const skippedFiles: string[] = [];

  for (const file of files) {
    const content = (await file.text()).trim();
    if (!content) {
      skippedFiles.push(file.name);
      continue;
    }

    await prisma.essay.create({
      data: {
        studentId,
        title: file.name,
        rawText: content,
        ocrStatus: "DONE",
        ocrPromptSnapshot: "TEXT_UPLOAD",
        matchStatus: "PENDING",
      },
    });
    createdCount += 1;
  }

  return NextResponse.json({
    createdCount,
    skippedCount: skippedFiles.length,
    skippedFiles,
  });
}

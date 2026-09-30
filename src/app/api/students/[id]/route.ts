import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { name?: string };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "学生姓名不能为空" }, { status: 400 });
  }

  const student = await prisma.student.update({
    where: { id },
    data: { name: body.name.trim() },
  });
  return NextResponse.json(student);
}

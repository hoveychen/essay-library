import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const students = await prisma.student.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(students);
}

export async function POST(req: Request) {
  const body = (await req.json()) as { name?: string };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "学生姓名不能为空" }, { status: 400 });
  }

  const student = await prisma.student.create({
    data: { name: body.name.trim() },
  });
  return NextResponse.json(student);
}

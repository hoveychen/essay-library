import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { title?: string; requirements?: string };

  if (body.title !== undefined && !body.title.trim()) {
    return NextResponse.json({ error: "题目标题不能为空" }, { status: 400 });
  }
  if (body.requirements !== undefined && !body.requirements.trim()) {
    return NextResponse.json({ error: "题目要求不能为空" }, { status: 400 });
  }

  const topic = await prisma.topic.update({
    where: { id },
    data: {
      ...(body.title !== undefined && { title: body.title.trim() }),
      ...(body.requirements !== undefined && { requirements: body.requirements.trim() }),
    },
  });
  return NextResponse.json(topic);
}

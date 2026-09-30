import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const body = (await req.json()) as { topicId?: string };
  const topicId = body.topicId?.trim();
  if (!topicId) {
    return NextResponse.json({ error: "topicId 不能为空" }, { status: 400 });
  }

  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic) {
    return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  }

  const essay = await prisma.essay.findUnique({ where: { id } });
  if (!essay) {
    return NextResponse.json({ error: "作文不存在" }, { status: 404 });
  }

  const updated = await prisma.essay.update({
    where: { id },
    data: {
      matchedTopicId: topicId,
      matchStatus: "CONFIRMED",
    },
    include: {
      student: true,
      images: true,
      suggestedTopic: true,
      matchedTopic: true,
    },
  });

  return NextResponse.json(updated);
}

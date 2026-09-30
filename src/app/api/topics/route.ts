import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const topics = await prisma.topic.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(topics);
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    title?: string;
    requirements?: string;
  };

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "题目标题不能为空" }, { status: 400 });
  }
  if (!body.requirements?.trim()) {
    return NextResponse.json({ error: "题目要求不能为空" }, { status: 400 });
  }

  const topic = await prisma.topic.create({
    data: {
      title: body.title.trim(),
      requirements: body.requirements.trim(),
    },
  });

  return NextResponse.json(topic);
}

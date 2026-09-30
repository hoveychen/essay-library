import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = (await req.json()) as { action?: string };

  if (body.action === "retry") {
    const job = await prisma.pipelineJob.update({
      where: { id },
      data: { status: "pending", errorMsg: null },
      include: {
        essay: { include: { student: true, matchedTopic: true, scoringResults: true } },
      },
    });
    return NextResponse.json(job);
  }

  return NextResponse.json({ error: "未知 action" }, { status: 400 });
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  await prisma.pipelineJob.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

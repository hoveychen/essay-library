import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const essayInclude = {
  student: true,
  matchedTopic: true,
  scoringResults: true,
} as const;

export async function GET() {
  const jobs = await prisma.pipelineJob.findMany({
    orderBy: { createdAt: "desc" },
    include: { essay: { include: essayInclude } },
  });
  return NextResponse.json(jobs);
}

export async function POST(req: Request) {
  const body = (await req.json()) as { essayIds?: string[] };
  const essayIds = body.essayIds ?? [];

  if (!essayIds.length) {
    return NextResponse.json({ error: "essayIds 不能为空" }, { status: 400 });
  }

  const jobs = await Promise.all(
    essayIds.map((essayId) =>
      prisma.pipelineJob.create({
        data: { essayId, status: "pending" },
        include: { essay: { include: essayInclude } },
      }),
    ),
  );

  return NextResponse.json(jobs);
}

import { NextResponse } from "next/server";
import { runMatchForEssay } from "@/lib/essay-ai";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  const { id } = await params;
  try {
    const updated = await runMatchForEssay(id);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "匹配失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

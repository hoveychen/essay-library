import { NextResponse } from "next/server";
import { runBatchMatchForStudent } from "@/lib/essay-ai";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  const { id } = await params;
  try {
    const result = await runBatchMatchForStudent(id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "匹配失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

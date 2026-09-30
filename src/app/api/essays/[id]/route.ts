import { unlink } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveUploadPath } from "@/lib/storage";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { rawText?: string };

  const updated = await prisma.essay.update({
    where: { id },
    data: { rawText: body.rawText ?? "" },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const essay = await prisma.essay.findUnique({
    where: { id },
    include: { images: true },
  });

  if (!essay) {
    return NextResponse.json({ error: "作文不存在" }, { status: 404 });
  }

  for (const image of essay.images) {
    try {
      await unlink(resolveUploadPath(image.publicPath));
    } catch {
      // 文件不存在或无法删除时跳过，不阻断数据库删除流程
    }
  }

  await prisma.essay.delete({
    where: { id },
  });

  return NextResponse.json({ ok: true });
}

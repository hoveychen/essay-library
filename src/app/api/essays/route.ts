import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { saveUpload } from "@/lib/storage";

export const runtime = "nodejs";

type StoredImage = {
  fileName: string;
  publicPath: string;
  originalName: string;
};

function parsePrefixAndPage(fileName: string) {
  const noExt = fileName.replace(/\.[^/.]+$/, "");
  const match = noExt.match(/^(.*)_(\d+)$/);
  if (!match) {
    return {
      prefix: noExt,
      page: Number.MAX_SAFE_INTEGER,
    };
  }
  const prefix = match[1].trim() || noExt;
  const page = Number.parseInt(match[2], 10);
  return {
    prefix,
    page: Number.isFinite(page) ? page : Number.MAX_SAFE_INTEGER,
  };
}

async function createSingleEssay(
  studentId: string,
  title: string,
  images: StoredImage[],
) {
  return prisma.essay.create({
    data: {
      studentId,
      title,
      images: {
        create: images.map((img) => ({
          fileName: img.fileName,
          publicPath: img.publicPath,
          originalName: img.originalName,
        })),
      },
    },
    include: {
      student: true,
      images: true,
      suggestedTopic: true,
      matchedTopic: true,
    },
  });
}

export async function GET() {
  const essays = await prisma.essay.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      student: true,
      images: true,
      suggestedTopic: true,
      matchedTopic: true,
    },
  });
  return NextResponse.json(essays);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const studentId = form.get("studentId")?.toString();
  const groupMode = form.get("groupMode")?.toString() || "one-image-one-essay";
  const essayTitle = form.get("essayTitle")?.toString().trim();
  const files = form.getAll("images").filter((f): f is File => f instanceof File);

  if (!studentId) {
    return NextResponse.json({ error: "必须选择学生" }, { status: 400 });
  }
  if (!files.length) {
    return NextResponse.json({ error: "请至少上传一张图片" }, { status: 400 });
  }

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) {
    return NextResponse.json({ error: "学生不存在" }, { status: 404 });
  }

  const storedImages: StoredImage[] = [];
  for (const file of files) {
    const stored = await saveUpload(file);
    storedImages.push(stored);
  }

  const created = [];
  if (groupMode === "single-essay") {
    const essay = await createSingleEssay(
      studentId,
      essayTitle || `作文-${new Date().toISOString()}`,
      storedImages,
    );
    created.push(essay);
  } else if (groupMode === "filename-prefix") {
    const groupMap = new Map<
      string,
      Array<{ image: StoredImage; page: number; index: number }>
    >();
    storedImages.forEach((img, index) => {
      const { prefix, page } = parsePrefixAndPage(img.originalName);
      const list = groupMap.get(prefix) || [];
      list.push({ image: img, page, index });
      groupMap.set(prefix, list);
    });

    for (const [prefix, list] of groupMap.entries()) {
      const ordered = [...list]
        .sort((a, b) => (a.page === b.page ? a.index - b.index : a.page - b.page))
        .map((item) => item.image);
      const title = essayTitle ? `${essayTitle}-${prefix}` : prefix;
      const essay = await createSingleEssay(studentId, title, ordered);
      created.push(essay);
    }
  } else {
    for (const stored of storedImages) {
      const displayTitle = essayTitle || stored.originalName;
      const essay = await createSingleEssay(studentId, displayTitle, [stored]);
      created.push(essay);
    }
  }

  return NextResponse.json({ createdCount: created.length, essays: created });
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ensureAppConfig } from "@/lib/config";
import { callDeepSeek } from "@/lib/deepseek";
import { prisma } from "@/lib/prisma";

const OCR_MAX_SIDE = 1800;
const OCR_JPEG_QUALITY = 85;

export type OcrProgressEvent =
  | { phase: "reading" }
  | { phase: "uploading"; fileSizeBytes: number }
  | { phase: "llm" };

const essayInclude = {
  student: true,
  images: true,
  suggestedTopic: true,
  matchedTopic: true,
} as const;

type MatchResponse = {
  topicId: string;
  reason: string;
  confidence: number;
};

type BatchMatchItem = {
  essayId: string;
  topicId: string | null;
  reason: string;
  confidence: number;
};


function safeParseBatchMatch(content: string): BatchMatchItem[] {
  const parsed = JSON.parse(content) as { matches?: Partial<BatchMatchItem>[] };
  if (!Array.isArray(parsed.matches)) return [];
  return parsed.matches.map((m) => ({
    essayId: (m.essayId || "").trim(),
    topicId: m.topicId ? m.topicId.trim() : null,
    reason: (m.reason || "模型未给出原因").trim(),
    confidence:
      typeof m.confidence === "number" ? Math.max(0, Math.min(1, m.confidence)) : 0,
  }));
}

function safeParseMatch(content: string): MatchResponse {
  const parsed = JSON.parse(content) as Partial<MatchResponse>;
  return {
    topicId: (parsed.topicId || "").trim(),
    reason: (parsed.reason || "模型未给出原因").trim(),
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0,
  };
}

export async function runOcrForEssay(
  essayId: string,
  onProgress?: (event: OcrProgressEvent) => void,
) {
  const essay = await prisma.essay.findUnique({
    where: { id: essayId },
    include: { images: true },
  });
  if (!essay) {
    throw new Error("作文不存在");
  }
  if (!essay.images.length) {
    throw new Error("作文没有图片");
  }

  const config = await ensureAppConfig();
  await prisma.essay.update({
    where: { id: essayId },
    data: { ocrStatus: "PROCESSING", ocrError: null },
  });

  try {
    onProgress?.({ phase: "reading" });

    const imageContents: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [];
    let fileSizeBytes = 0;

    for (const img of essay.images) {
      const safePublicPath = img.publicPath.startsWith("/")
        ? img.publicPath.slice(1)
        : img.publicPath;
      const absPath = path.join(process.cwd(), "public", safePublicPath);
      const raw = await readFile(absPath);
      const compressed = await sharp(raw)
        .rotate()
        .resize(OCR_MAX_SIDE, OCR_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: OCR_JPEG_QUALITY })
        .toBuffer();
      fileSizeBytes += compressed.length;
      imageContents.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${compressed.toString("base64")}` },
      });
    }

    onProgress?.({ phase: "uploading", fileSizeBytes });

    const text = await callDeepSeek({
      model: config.ocrModel,
      messages: [
        { role: "system", content: "你是严格的OCR助手。" },
        {
          role: "user",
          content: [{ type: "text", text: config.ocrPrompt }, ...imageContents],
        },
      ],
      onUploadComplete: () => onProgress?.({ phase: "llm" }),
    });

    return prisma.essay.update({
      where: { id: essayId },
      data: {
        rawText: text,
        ocrStatus: "DONE",
        ocrPromptSnapshot: config.ocrPrompt,
      },
      include: essayInclude,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OCR失败";
    await prisma.essay.update({
      where: { id: essayId },
      data: { ocrStatus: "FAILED", ocrError: message },
    });
    throw new Error(message);
  }
}

export async function runMatchForEssay(essayId: string) {
  const essay = await prisma.essay.findUnique({
    where: { id: essayId },
  });
  if (!essay) {
    throw new Error("作文不存在");
  }
  if (!essay.rawText?.trim()) {
    throw new Error("请先完成OCR");
  }

  const topics = await prisma.topic.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, requirements: true },
  });
  if (!topics.length) {
    throw new Error("题目库为空，无法匹配");
  }

  const config = await ensureAppConfig();
  await prisma.essay.update({
    where: { id: essayId },
    data: { matchStatus: "PROCESSING" },
  });

  try {
    const content = await callDeepSeek({
      model: config.matchModel,
      responseFormatJson: true,
      messages: [
        { role: "system", content: "你是作文题目匹配助手，必须返回JSON。" },
        {
          role: "user",
          content: `${config.matchPrompt}

作文文本：
${essay.rawText}

题目列表（JSON）：
${JSON.stringify(topics, null, 2)}`,
        },
      ],
    });

    const result = safeParseMatch(content);
    const validTopic = topics.find((t) => t.id === result.topicId);
    return prisma.essay.update({
      where: { id: essayId },
      data: {
        matchStatus: validTopic ? "SUGGESTED" : "FAILED",
        suggestedTopicId: validTopic?.id || null,
        suggestedReason: result.reason,
        suggestedConfidence: result.confidence,
      },
      include: essayInclude,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "匹配失败";
    await prisma.essay.update({
      where: { id: essayId },
      data: {
        matchStatus: "FAILED",
        suggestedReason: message,
      },
    });
    throw new Error(message);
  }
}

export async function runBatchMatchForStudent(
  studentId: string,
): Promise<{ matched: number; failed: number }> {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) throw new Error("学生不存在");

  const essays = await prisma.essay.findMany({
    where: {
      studentId,
      ocrStatus: "DONE",
      matchStatus: { not: "CONFIRMED" },
      rawText: { not: null },
    },
  });

  if (!essays.length) return { matched: 0, failed: 0 };

  const confirmedEssays = await prisma.essay.findMany({
    where: { studentId, matchStatus: "CONFIRMED", matchedTopicId: { not: null } },
    select: { matchedTopicId: true },
  });
  const confirmedTopicIds = new Set(confirmedEssays.map((e) => e.matchedTopicId!));

  const allTopics = await prisma.topic.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, requirements: true },
  });
  const availableTopics = allTopics.filter((t) => !confirmedTopicIds.has(t.id));

  await prisma.essay.updateMany({
    where: { id: { in: essays.map((e) => e.id) } },
    data: { matchStatus: "PROCESSING" },
  });

  if (!availableTopics.length) {
    await prisma.essay.updateMany({
      where: { id: { in: essays.map((e) => e.id) } },
      data: { matchStatus: "FAILED", suggestedReason: "没有可用的题目" },
    });
    return { matched: 0, failed: essays.length };
  }

  const config = await ensureAppConfig();

  const essayList = essays.map((e) => ({
    id: e.id,
    title: e.title,
    rawText: e.rawText,
  }));

  try {
    const content = await callDeepSeek({
      model: config.matchModel,
      responseFormatJson: true,
      messages: [
        { role: "system", content: "你是作文题目匹配助手，必须返回JSON。" },
        {
          role: "user",
          content: `${config.matchPrompt}

请为以下每篇作文从题目列表中选择最合适的题目，进行一对一匹配：每篇作文最多匹配一个题目，每个题目最多被一篇作文匹配。若某篇作文确实找不到合适的题目，topicId 填 null。

作文列表（JSON）：
${JSON.stringify(essayList, null, 2)}

题目列表（JSON）：
${JSON.stringify(availableTopics, null, 2)}

请返回如下格式的JSON：
{
  "matches": [
    { "essayId": "作文id", "topicId": "题目id或null", "reason": "匹配理由", "confidence": 0.0到1.0之间的数字 }
  ]
}`,
        },
      ],
    });

    const items = safeParseBatchMatch(content);
    const matchMap = new Map(items.map((m) => [m.essayId, m]));

    const usedTopicIds = new Set<string>();
    let matched = 0;
    let failed = 0;

    for (const essay of essays) {
      const m = matchMap.get(essay.id);
      if (!m) {
        await prisma.essay.update({
          where: { id: essay.id },
          data: { matchStatus: "FAILED", suggestedReason: "模型未返回该作文的匹配结果" },
        });
        failed++;
        continue;
      }

      const topicValid =
        m.topicId &&
        !usedTopicIds.has(m.topicId) &&
        availableTopics.some((t) => t.id === m.topicId);

      if (topicValid) {
        usedTopicIds.add(m.topicId!);
        await prisma.essay.update({
          where: { id: essay.id },
          data: {
            matchStatus: "SUGGESTED",
            suggestedTopicId: m.topicId,
            suggestedReason: m.reason,
            suggestedConfidence: m.confidence,
          },
        });
        matched++;
      } else {
        await prisma.essay.update({
          where: { id: essay.id },
          data: {
            matchStatus: "FAILED",
            suggestedTopicId: null,
            suggestedReason: m.reason || "无合适题目",
            suggestedConfidence: 0,
          },
        });
        failed++;
      }
    }

    return { matched, failed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "匹配失败";
    await prisma.essay.updateMany({
      where: { id: { in: essays.map((e) => e.id) } },
      data: { matchStatus: "FAILED", suggestedReason: message },
    });
    throw new Error(message);
  }
}

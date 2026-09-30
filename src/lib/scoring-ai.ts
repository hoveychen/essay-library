import {
  ensureAppConfig,
  getScoringPrompt,
  SCORING_DIMENSION_MAX,
  SCORING_DIMENSIONS,
  type ScoringDimensionKey,
} from "@/lib/config";
import { callDeepSeek } from "@/lib/deepseek";
import { prisma } from "@/lib/prisma";

const SCORING_LEVELS = ["一等", "二等", "三等", "四等"] as const;

type ScoringResponse = {
  score: number;
  brief: string;
  [key: string]: unknown;
};

function safeParseScoringResponse(
  content: string,
  dimension: ScoringDimensionKey,
): ScoringResponse {
  const parsed = JSON.parse(content) as Partial<ScoringResponse>;
  const max = SCORING_DIMENSION_MAX[dimension];
  const raw = parsed.score;
  // Prompt asks model for 0-100; stored score = round(raw × dimMax/100), clamped to [0, dimMax]
  const score =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.max(0, Math.min(max, Math.round(raw * (max / 100))))
      : -1;
  const brief = typeof parsed.brief === "string" ? parsed.brief.trim() : "";

  const { score: _s, brief: _b, level, ...rest } = parsed;
  const extra: Record<string, unknown> = { ...rest };
  if (typeof level === "string") {
    const t = level.trim();
    if ((SCORING_LEVELS as readonly string[]).includes(t)) {
      extra.level = t;
    }
  }
  // Preserve the model's original 0-100 score for audit purposes
  if (typeof raw === "number" && Number.isFinite(raw)) {
    extra.rawScore = raw;
  }

  return { score, brief, ...extra };
}

function buildUserMessage(essay: {
  rawText: string | null;
  matchedTopic?: { title: string; requirements: string } | null;
}): string {
  const parts: string[] = [];
  if (essay.matchedTopic) {
    parts.push(`## 作文题目：${essay.matchedTopic.title}\n\n### 题目要求：\n${essay.matchedTopic.requirements}`);
  }
  parts.push(`## 学生作文：\n\n${essay.rawText || ""}`);
  return parts.join("\n\n");
}

export async function scoreEssay(
  essayId: string,
  dimension: ScoringDimensionKey,
): Promise<{ score: number; brief: string; extra: string | null }> {
  const essay = await prisma.essay.findUnique({
    where: { id: essayId },
    include: { matchedTopic: true },
  });
  if (!essay) throw new Error("作文不存在");
  if (!essay.rawText?.trim()) throw new Error("作文没有OCR文本，请先完成OCR");
  if (!essay.matchedTopic) throw new Error("作文尚未绑定题目，请先在作文管理页完成题目匹配");

  const config = await ensureAppConfig();
  const prompt = getScoringPrompt(config, dimension);
  if (!prompt) throw new Error(`评分维度 ${dimension} 的 prompt 为空`);

  const userMessage = buildUserMessage(essay);

  const content = await callDeepSeek({
    model: config.scoringModel,
    responseFormatJson: true,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: userMessage },
    ],
  });

  const result = safeParseScoringResponse(content, dimension);
  if (result.score < 0) throw new Error("模型返回的分数无效");

  const { score, brief, ...extraFields } = result;
  const extra =
    Object.keys(extraFields).length > 0 ? JSON.stringify(extraFields) : null;

  await prisma.scoringResult.upsert({
    where: { essayId_dimension: { essayId, dimension } },
    create: {
      essayId,
      dimension,
      score,
      brief,
      extra,
      model: config.scoringModel,
      promptSnapshot: prompt,
    },
    update: {
      score,
      brief,
      extra,
      model: config.scoringModel,
      promptSnapshot: prompt,
    },
  });

  return { score, brief, extra };
}

export async function scoreEssayAllDimensions(essayId: string) {
  const results: Record<
    string,
    { score: number; brief: string; extra: string | null } | { error: string }
  > = {};
  for (const dim of Object.keys(SCORING_DIMENSIONS) as ScoringDimensionKey[]) {
    try {
      results[dim] = await scoreEssay(essayId, dim);
    } catch (e) {
      results[dim] = { error: e instanceof Error ? e.message : "评分失败" };
    }
  }
  return results;
}

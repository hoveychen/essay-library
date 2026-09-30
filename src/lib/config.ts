import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";

const DEFAULT_OCR_PROMPT = `你是一个中文作文OCR助手。请准确识别图片中的手写作文内容，要求：
1. 仅输出作文正文，不要加解释；
2. 保留自然分段；
3. 若有不确定文字，用【?】标记；
4. 不要补写原文中不存在的内容。`;

const DEFAULT_MATCH_PROMPT = `你是作文题目匹配助手。你会收到：
- 一篇作文文本；
- 一个题目列表（每个题目有 id、title、requirements）。

请判断最可能对应的题目，输出 JSON：
{
  "topicId": "题目id或空字符串",
  "reason": "简洁说明理由",
  "confidence": 0到1之间的小数
}

若无法判断，topicId 置为空字符串。`;

// --- Scoring dimensions ---

export const SCORING_DIMENSIONS = {
  topic_adherence_and_task: "审题扣题与任务完成",
  thesis_and_theme: "论点与立意",
  evidence_and_material: "论据与素材",
  logic_and_structure: "逻辑与结构",
  language_and_expression: "语言与表达",
} as const;

export type ScoringDimensionKey = keyof typeof SCORING_DIMENSIONS;

/** 各维度满分（总分 60），与等级量表一致 */
export const SCORING_DIMENSION_MAX: Record<ScoringDimensionKey, number> = {
  topic_adherence_and_task: 12,
  thesis_and_theme: 13,
  evidence_and_material: 12,
  logic_and_structure: 15,
  language_and_expression: 8,
};

// Map dimension key -> AppConfig field name
const DIMENSION_CONFIG_FIELD: Record<ScoringDimensionKey, string> = {
  topic_adherence_and_task: "scoringPromptTopicAdherence",
  thesis_and_theme: "scoringPromptThesis",
  evidence_and_material: "scoringPromptEvidence",
  logic_and_structure: "scoringPromptLogic",
  language_and_expression: "scoringPromptLanguage",
};

function loadDefaultScoringPrompt(dimKey: string): string {
  try {
    const filePath = path.join(process.cwd(), "scoring", "prompts", `${dimKey}.md`);
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

export function getScoringPrompt(
  config: Awaited<ReturnType<typeof ensureAppConfig>>,
  dimKey: ScoringDimensionKey,
): string {
  const fieldName = DIMENSION_CONFIG_FIELD[dimKey] as keyof typeof config;
  const value = config[fieldName] as string;
  return value || loadDefaultScoringPrompt(dimKey);
}

export async function ensureAppConfig() {
  const existing = await prisma.appConfig.findUnique({
    where: { id: 1 },
  });
  if (existing) {
    return existing;
  }

  return prisma.appConfig.create({
    data: {
      id: 1,
      ocrPrompt: DEFAULT_OCR_PROMPT,
      matchPrompt: DEFAULT_MATCH_PROMPT,
      ocrModel: "deepseek-flash",
      matchModel: "deepseek-flash",
      scoringModel: "deepseek-flash",
      scoringPromptTopicAdherence: loadDefaultScoringPrompt("topic_adherence_and_task"),
      scoringPromptThesis: loadDefaultScoringPrompt("thesis_and_theme"),
      scoringPromptEvidence: loadDefaultScoringPrompt("evidence_and_material"),
      scoringPromptLogic: loadDefaultScoringPrompt("logic_and_structure"),
      scoringPromptLanguage: loadDefaultScoringPrompt("language_and_expression"),
    },
  });
}

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "../src/generated/prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const prisma = new PrismaClient({
  datasourceUrl: process.env.SEED_DATABASE_URL,
  log: [],
});

const promptsDir = join(ROOT, "scoring", "prompts");

function readPrompt(name: string): string {
  try {
    return readFileSync(join(promptsDir, `${name}.md`), "utf8");
  } catch {
    return "";
  }
}

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

async function main() {
  await prisma.appConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      ocrPrompt: DEFAULT_OCR_PROMPT,
      matchPrompt: DEFAULT_MATCH_PROMPT,
      ocrModel: "moonshotai/kimi-k2",
      matchModel: "moonshotai/kimi-k2",
      scoringModel: "moonshotai/kimi-k2",
      scoringPromptTopicAdherence: readPrompt("topic_adherence_and_task"),
      scoringPromptThesis: readPrompt("thesis_and_theme"),
      scoringPromptEvidence: readPrompt("evidence_and_material"),
      scoringPromptLogic: readPrompt("logic_and_structure"),
      scoringPromptLanguage: readPrompt("language_and_expression"),
    },
    update: {},
  });
  await prisma.$disconnect();
  console.log("Template DB seeded.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

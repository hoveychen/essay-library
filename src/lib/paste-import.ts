type StudentLite = {
  id: string;
  name: string;
};

export type ReviewSegment = {
  studentId: string;
  studentName: string;
  article: string;
  sourceHeader: string;
  chineseChars: number;
  totalChars: number;
  warnings: string[];
  canImport: boolean;
};

const MIN_CHINESE_CHARS = 100;
const MAX_CHINESE_CHARS = 3000;

function countChineseChars(text: string) {
  const m = text.match(/[\p{Script=Han}]/gu);
  return m ? m.length : 0;
}

function normalizeArticle(text: string) {
  return text.replace(/^【文章】\s*\n?/, "").trim();
}

function buildWarnings(article: string) {
  const chineseChars = countChineseChars(article);
  const totalChars = article.length;
  const warnings: string[] = [];

  if (chineseChars < MIN_CHINESE_CHARS) {
    warnings.push(`中文字符过少（${chineseChars} < ${MIN_CHINESE_CHARS}）`);
  }
  if (chineseChars > MAX_CHINESE_CHARS) {
    warnings.push(`中文字符过多（${chineseChars} > ${MAX_CHINESE_CHARS}）`);
  }
  if (totalChars < 120) {
    warnings.push(`总字符过少（${totalChars}）`);
  }
  if (totalChars > 6000) {
    warnings.push(`总字符过多（${totalChars}）`);
  }

  return {
    chineseChars,
    totalChars,
    warnings,
    canImport:
      chineseChars >= MIN_CHINESE_CHARS &&
      chineseChars <= MAX_CHINESE_CHARS &&
      totalChars >= 120 &&
      totalChars <= 6000,
  };
}

export function buildReviewSegments(
  payload: string,
  students: StudentLite[],
): ReviewSegment[] {
  const normalized = payload.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const studentsByName = new Map(students.map((s) => [s.name, s]));
  const sortedStudents = [...students].sort((a, b) => b.name.length - a.name.length);

  type Candidate = {
    student: StudentLite;
    lineStart: number;
    lineEnd: number;
    headerText: string;
  };

  const candidates: Candidate[] = [];
  let cursor = 0;
  for (const rawLine of lines) {
    const lineStart = cursor;
    const lineEnd = cursor + rawLine.length;
    cursor = lineEnd + 1;

    const trimmedLeft = rawLine.trimStart();
    if (!trimmedLeft) continue;

    let matchedStudent: StudentLite | null = null;
    for (const student of sortedStudents) {
      const idx = trimmedLeft.indexOf(student.name);
      if (idx >= 0 && idx <= 4) {
        matchedStudent = student;
        break;
      }
    }
    if (!matchedStudent) continue;

    candidates.push({
      student: matchedStudent,
      lineStart,
      lineEnd,
      headerText: rawLine.trim(),
    });
  }

  if (candidates.length === 0) {
    return [];
  }

  const results: ReviewSegment[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const current = candidates[i];
    const next = candidates[i + 1];
    const articleStart = Math.min(current.lineEnd + 1, normalized.length);
    const articleEnd = next ? next.lineStart : normalized.length;
    const rawArticle = normalized.slice(articleStart, articleEnd).trim();
    const article = normalizeArticle(rawArticle);
    if (!article) continue;

    const student = studentsByName.get(current.student.name);
    if (!student) continue;

    const metrics = buildWarnings(article);
    results.push({
      studentId: student.id,
      studentName: student.name,
      article,
      sourceHeader: current.headerText,
      chineseChars: metrics.chineseChars,
      totalChars: metrics.totalChars,
      warnings: metrics.warnings,
      canImport: metrics.canImport,
    });
  }

  return results;
}

export function validateSegmentContent(article: string) {
  const normalized = normalizeArticle(article);
  const metrics = buildWarnings(normalized);
  return {
    normalized,
    ...metrics,
  };
}

"use client";

export type Student = {
  id: string;
  name: string;
};

export type Topic = {
  id: string;
  title: string;
  requirements: string;
};

export type Essay = {
  id: string;
  title: string | null;
  rawText: string | null;
  ocrStatus: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  ocrError: string | null;
  matchStatus: "PENDING" | "PROCESSING" | "SUGGESTED" | "CONFIRMED" | "FAILED";
  suggestedReason: string | null;
  suggestedConfidence: number | null;
  suggestedTopic: Topic | null;
  matchedTopic: Topic | null;
  student: Student;
  images: Array<{ id: string; publicPath: string; originalName: string }>;
};

export type AppConfig = {
  ocrPrompt: string;
  matchPrompt: string;
  ocrModel: string;
  matchModel: string;
  scoringModel: string;
  apiKey: string;
};

export async function getStudents(): Promise<Student[]> {
  const res = await fetch("/api/students");
  return res.json();
}

export async function getTopics(): Promise<Topic[]> {
  const res = await fetch("/api/topics");
  return res.json();
}

export async function getEssays(): Promise<Essay[]> {
  const res = await fetch("/api/essays");
  return res.json();
}

export type ScoringResult = {
  id: string;
  essayId: string;
  dimension: string;
  score: number;
  brief: string;
  extra: string | null;
  model: string;
  promptSnapshot: string;
  createdAt: string;
  updatedAt: string | null;
};

export type EssayWithScores = Essay & {
  scoringResults: ScoringResult[];
};

export async function getSettings(): Promise<AppConfig> {
  const res = await fetch("/api/settings");
  return res.json();
}

export async function getCurrentScoringPrompts(): Promise<Record<string, string>> {
  const res = await fetch("/api/scoring/current-prompts");
  return res.json();
}

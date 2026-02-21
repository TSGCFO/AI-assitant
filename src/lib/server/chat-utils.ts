import type { Citation } from "@/lib/types";

export const needsWebSearch = (input: string): boolean => {
  const normalized = input.toLowerCase();
  const triggers = [
    "today",
    "latest",
    "current",
    "news",
    "weather",
    "price",
    "stock",
    "score",
    "election",
    "update",
    "2026",
  ];
  return triggers.some((keyword) => normalized.includes(keyword));
};

export const detectLanguageCode = (input: string): string => {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return "en";
  if (/[ء-ي]/.test(normalized)) return "ar";
  if (/[а-яё]/i.test(normalized)) return "ru";
  if (/[一-龥]/.test(normalized)) return "zh";
  if (/[ぁ-んァ-ン]/.test(normalized)) return "ja";
  if (/[가-힣]/.test(normalized)) return "ko";
  if (/\b(hola|gracias|por favor|buenos)\b/.test(normalized)) return "es";
  if (/\b(bonjour|merci|s'il|salut)\b/.test(normalized)) return "fr";
  if (/\b(hallo|danke|bitte|guten)\b/.test(normalized)) return "de";
  if (/\b(urdu|شکریہ|براہ)\b/.test(normalized)) return "ur";
  return "en";
};

export const parseReminderIntent = (
  input: string
): { title: string; dueAtIso: string | null } | null => {
  const normalized = input.trim();
  const reminderMatch = normalized.match(/remind me to (.+?)(?: at (.+)| on (.+)|$)/i);
  if (!reminderMatch) return null;

  const title = reminderMatch[1]?.trim();
  if (!title) return null;

  const timePart = reminderMatch[2] ?? reminderMatch[3];
  if (!timePart) {
    return { title, dueAtIso: null };
  }

  const parsed = new Date(timePart);
  if (Number.isNaN(parsed.getTime())) {
    return { title, dueAtIso: null };
  }
  return { title, dueAtIso: parsed.toISOString() };
};

export const extractCitationsFromResponse = (response: {
  output?: unknown[];
}): Omit<Citation, "id" | "messageId" | "userId" | "createdAt">[] => {
  const citations: Omit<Citation, "id" | "messageId" | "userId" | "createdAt">[] = [];
  if (!Array.isArray(response.output)) return citations;

  for (const outputItem of response.output) {
    const contentItems =
      outputItem && typeof outputItem === "object" && Array.isArray((outputItem as { content?: unknown[] }).content)
        ? ((outputItem as { content: unknown[] }).content ?? [])
        : [];
    for (const content of contentItems) {
      const annotations =
        content && typeof content === "object"
          ? ((content as { annotations?: unknown[] }).annotations ?? [])
          : [];
      if (!Array.isArray(annotations)) continue;
      for (const annotation of annotations) {
        if (!annotation || typeof annotation !== "object") continue;
        const url = String((annotation as { url?: string }).url ?? "").trim();
        if (!url) continue;
        citations.push({
          title: String((annotation as { title?: string }).title ?? "Source"),
          url,
          source: String((annotation as { source?: string }).source ?? "web"),
          snippet: String((annotation as { text?: string }).text ?? ""),
        });
      }
    }
  }

  const dedup = new Map<string, Omit<Citation, "id" | "messageId" | "userId" | "createdAt">>();
  for (const entry of citations) {
    if (!dedup.has(entry.url)) dedup.set(entry.url, entry);
  }
  return [...dedup.values()];
};

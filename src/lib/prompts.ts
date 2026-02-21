import { getPersona } from "@/lib/personas";
import type { ChatMessage, PersonaId, RetrievedContext } from "@/lib/types";

const truncate = (text: string, maxChars: number): string =>
  text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;

export const buildSystemPrompt = ({
  workingMemory,
  retrievedContext,
  personaId,
  preferredLanguage,
  includeWebSearch,
}: {
  workingMemory: string;
  retrievedContext: RetrievedContext[];
  personaId?: PersonaId;
  preferredLanguage?: string | null;
  includeWebSearch?: boolean;
}): string => {
  const persona = getPersona(personaId);
  const memoryBlock = workingMemory.trim()
    ? `Working memory summary:\n${truncate(workingMemory, 1_500)}`
    : "Working memory summary:\nNone";

  const semanticBlock =
    retrievedContext.length === 0
      ? "Relevant past memory:\nNone"
      : `Relevant past memory:\n${retrievedContext
          .map(
            (entry, idx) =>
              `${idx + 1}. score=${entry.finalScore.toFixed(3)} | ${truncate(entry.chunk.textChunk, 500)}`
          )
          .join("\n")}`;

  return [
    "You are a daily assistant optimized for Android mobile interaction and concise execution.",
    `Persona mode: ${persona.name}`,
    `Persona instruction: ${persona.systemInstruction}`,
    "Be concise, practical, and action-oriented.",
    "Format rich responses using markdown when helpful (headings, lists, tables, fenced code blocks).",
    "If web search is used, cite sources with short markdown links in the response.",
    preferredLanguage
      ? `Respond in language code "${preferredLanguage}" unless the user explicitly asks for another language.`
      : "Auto-detect language from user input and respond in the same language.",
    includeWebSearch
      ? "You may rely on web search results for time-sensitive information."
      : "Prefer internal memory/context before suggesting web lookup.",
    "Respect user privacy and never invent past facts that are not in memory.",
    "When memory is uncertain, ask a brief follow-up question.",
    memoryBlock,
    semanticBlock,
  ].join("\n\n");
};

export const buildRollingSummary = (messages: ChatMessage[]): string => {
  if (messages.length === 0) {
    return "";
  }

  const latest = messages.slice(-10);
  const lines = latest.map((msg) => `${msg.role}: ${truncate(msg.content, 180)}`);

  return `Recent dialogue snapshot:\n${lines.join("\n")}`;
};

import type { ChatMessage, RetrievedContext } from "@/lib/types";

const truncate = (text: string, maxChars: number): string =>
  text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;

export const buildSystemPrompt = ({
  workingMemory,
  retrievedContext,
}: {
  workingMemory: string;
  retrievedContext: RetrievedContext[];
}): string => {
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
    "You are a daily assistant optimized for Android mobile interaction.",
    "Be concise, practical, and action-oriented.",
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
  const lines = latest.map((msg) => `${msg.role}: ${truncate(msg.content, 240)}`);

  return `Recent dialogue snapshot:\n${lines.join("\n")}`;
};


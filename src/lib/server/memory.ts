import { env } from "@/lib/env";
import { getOpenAiClient, hasOpenAiKey } from "@/lib/server/openai";
import { addSemanticChunk, searchSemanticMemory } from "@/lib/server/repository";
import type { RetrievedContext } from "@/lib/types";

const chunkText = (text: string, size = 450): string[] => {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + size, normalized.length);
    chunks.push(normalized.slice(start, end));
    start = end;
  }
  return chunks;
};

const fallbackEmbedding = (text: string): number[] => {
  const vector = new Array<number>(32).fill(0);
  for (let idx = 0; idx < text.length; idx += 1) {
    vector[idx % vector.length] += text.charCodeAt(idx);
  }
  return vector.map((value) => value / Math.max(text.length, 1));
};

export const embedText = async (input: string): Promise<number[]> => {
  if (!hasOpenAiKey()) {
    return fallbackEmbedding(input);
  }

  const client = getOpenAiClient();
  const response = await client.embeddings.create({
    model: env.openaiEmbeddingModel,
    input,
  });
  return response.data[0].embedding;
};

export const persistSemanticMemory = async ({
  userId,
  sessionId,
  messageId,
  content,
}: {
  userId: string;
  sessionId: string;
  messageId: string;
  content: string;
}): Promise<void> => {
  const chunks = chunkText(content);
  for (const chunk of chunks) {
    const embedding = await embedText(chunk);
    await addSemanticChunk({
      userId,
      sessionId,
      messageIds: [messageId],
      textChunk: chunk,
      embedding,
    });
  }
};

export const retrieveContext = async ({
  userId,
  query,
  limit = 6,
}: {
  userId: string;
  query: string;
  limit?: number;
}): Promise<RetrievedContext[]> => {
  const embedding = await embedText(query);
  return searchSemanticMemory({
    userId,
    queryEmbedding: embedding,
    count: limit,
  });
};

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import type {
  ChatMessage,
  ChatRole,
  ChatSession,
  RetrievedContext,
  SemanticMemoryChunk,
  WorkingMemoryState,
} from "@/lib/types";

const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let idx = 0; idx < a.length; idx += 1) {
    dot += a[idx] * b[idx];
    normA += a[idx] * a[idx];
    normB += b[idx] * b[idx];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / Math.sqrt(normA * normB);
};

const nowIso = (): string => new Date().toISOString();

const createId = (): string => crypto.randomUUID();

interface MemoryStore {
  sessions: ChatSession[];
  messages: ChatMessage[];
  semanticMemory: SemanticMemoryChunk[];
  workingMemory: WorkingMemoryState[];
}

declare global {
  var __assistantMemoryStore: MemoryStore | undefined;
}

const memoryStore: MemoryStore =
  globalThis.__assistantMemoryStore ??
  (globalThis.__assistantMemoryStore = {
    sessions: [],
    messages: [],
    semanticMemory: [],
    workingMemory: [],
  });

const hasSupabase = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);

let supabaseSingleton: SupabaseClient | null = null;

const supabase = (): SupabaseClient => {
  if (!supabaseSingleton) {
    supabaseSingleton = createClient(
      env.supabaseUrl as string,
      env.supabaseServiceRoleKey as string,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );
  }
  return supabaseSingleton;
};

const toSession = (row: Record<string, unknown>): ChatSession => ({
  id: String(row.id),
  userId: String(row.user_id),
  title: String(row.title),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  mode: row.mode === "voice" ? "voice" : "text",
});

const toMessage = (row: Record<string, unknown>): ChatMessage => ({
  id: String(row.id),
  sessionId: String(row.session_id),
  userId: String(row.user_id),
  role: String(row.role) as ChatRole,
  content: String(row.content),
  createdAt: String(row.created_at),
  audioUrl: row.audio_url ? String(row.audio_url) : null,
});

const toChunk = (row: Record<string, unknown>): SemanticMemoryChunk => ({
  id: String(row.id),
  sessionId: String(row.session_id),
  userId: String(row.user_id),
  messageIds: Array.isArray(row.message_ids)
    ? (row.message_ids as string[])
    : [],
  textChunk: String(row.text_chunk),
  embedding: Array.isArray(row.embedding) ? (row.embedding as number[]) : [],
  createdAt: String(row.created_at),
});

export const listSessions = async (userId: string): Promise<ChatSession[]> => {
  if (!hasSupabase) {
    return memoryStore.sessions
      .filter((session) => session.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  const { data, error } = await supabase()
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => toSession(row));
};

export const createSession = async ({
  userId,
  title,
  mode = "text",
}: {
  userId: string;
  title?: string;
  mode?: "text" | "voice";
}): Promise<ChatSession> => {
  const payload: ChatSession = {
    id: createId(),
    userId,
    title: title?.trim() || "New conversation",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    mode,
  };

  if (!hasSupabase) {
    memoryStore.sessions.push(payload);
    return payload;
  }

  const { data, error } = await supabase()
    .from("sessions")
    .insert({
      id: payload.id,
      user_id: payload.userId,
      title: payload.title,
      mode: payload.mode,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create session");
  }

  return toSession(data);
};

export const touchSession = async (sessionId: string): Promise<void> => {
  if (!hasSupabase) {
    const session = memoryStore.sessions.find((item) => item.id === sessionId);
    if (session) {
      session.updatedAt = nowIso();
    }
    return;
  }

  const { error } = await supabase()
    .from("sessions")
    .update({ updated_at: nowIso() })
    .eq("id", sessionId);

  if (error) {
    throw new Error(error.message);
  }
};

export const getMessages = async ({
  userId,
  sessionId,
}: {
  userId: string;
  sessionId: string;
}): Promise<ChatMessage[]> => {
  if (!hasSupabase) {
    return memoryStore.messages
      .filter(
        (message) => message.userId === userId && message.sessionId === sessionId
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  const { data, error } = await supabase()
    .from("messages")
    .select("*")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => toMessage(row));
};

export const addMessage = async ({
  userId,
  sessionId,
  role,
  content,
  audioUrl,
}: {
  userId: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  audioUrl?: string | null;
}): Promise<ChatMessage> => {
  const payload: ChatMessage = {
    id: createId(),
    sessionId,
    userId,
    role,
    content,
    createdAt: nowIso(),
    audioUrl: audioUrl ?? null,
  };

  if (!hasSupabase) {
    memoryStore.messages.push(payload);
    await touchSession(sessionId);
    return payload;
  }

  const { data, error } = await supabase()
    .from("messages")
    .insert({
      id: payload.id,
      session_id: payload.sessionId,
      user_id: payload.userId,
      role: payload.role,
      content: payload.content,
      audio_url: payload.audioUrl,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to store message");
  }

  await touchSession(sessionId);
  return toMessage(data);
};

export const deleteSession = async ({
  userId,
  sessionId,
}: {
  userId: string;
  sessionId: string;
}): Promise<void> => {
  if (!hasSupabase) {
    memoryStore.sessions = memoryStore.sessions.filter(
      (session) => !(session.userId === userId && session.id === sessionId)
    );
    memoryStore.messages = memoryStore.messages.filter(
      (message) => !(message.userId === userId && message.sessionId === sessionId)
    );
    memoryStore.semanticMemory = memoryStore.semanticMemory.filter(
      (chunk) => !(chunk.userId === userId && chunk.sessionId === sessionId)
    );
    memoryStore.workingMemory = memoryStore.workingMemory.filter(
      (item) => !(item.userId === userId && item.sessionId === sessionId)
    );
    return;
  }

  const { error } = await supabase()
    .from("sessions")
    .delete()
    .eq("user_id", userId)
    .eq("id", sessionId);

  if (error) {
    throw new Error(error.message);
  }
};

export const upsertWorkingMemory = async ({
  userId,
  sessionId,
  rollingSummary,
  activeEntities,
}: {
  userId: string;
  sessionId: string;
  rollingSummary: string;
  activeEntities: string[];
}): Promise<WorkingMemoryState> => {
  const payload: WorkingMemoryState = {
    sessionId,
    userId,
    rollingSummary,
    activeEntities,
    updatedAt: nowIso(),
  };

  if (!hasSupabase) {
    const index = memoryStore.workingMemory.findIndex(
      (item) => item.userId === userId && item.sessionId === sessionId
    );
    if (index === -1) {
      memoryStore.workingMemory.push(payload);
    } else {
      memoryStore.workingMemory[index] = payload;
    }
    return payload;
  }

  const { data, error } = await supabase()
    .from("working_memory")
    .upsert(
      {
        user_id: userId,
        session_id: sessionId,
        rolling_summary: rollingSummary,
        active_entities: activeEntities,
        updated_at: nowIso(),
      },
      { onConflict: "user_id,session_id" }
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to update working memory");
  }

  return {
    userId: String(data.user_id),
    sessionId: String(data.session_id),
    rollingSummary: String(data.rolling_summary),
    activeEntities: Array.isArray(data.active_entities)
      ? (data.active_entities as string[])
      : [],
    updatedAt: String(data.updated_at),
  };
};

export const getWorkingMemory = async ({
  userId,
  sessionId,
}: {
  userId: string;
  sessionId: string;
}): Promise<WorkingMemoryState | null> => {
  if (!hasSupabase) {
    return (
      memoryStore.workingMemory.find(
        (item) => item.userId === userId && item.sessionId === sessionId
      ) ?? null
    );
  }

  const { data, error } = await supabase()
    .from("working_memory")
    .select("*")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return {
    userId: String(data.user_id),
    sessionId: String(data.session_id),
    rollingSummary: String(data.rolling_summary),
    activeEntities: Array.isArray(data.active_entities)
      ? (data.active_entities as string[])
      : [],
    updatedAt: String(data.updated_at),
  };
};

export const addSemanticChunk = async ({
  userId,
  sessionId,
  textChunk,
  messageIds,
  embedding,
}: {
  userId: string;
  sessionId: string;
  textChunk: string;
  messageIds: string[];
  embedding: number[];
}): Promise<SemanticMemoryChunk> => {
  const payload: SemanticMemoryChunk = {
    id: createId(),
    userId,
    sessionId,
    textChunk,
    messageIds,
    embedding,
    createdAt: nowIso(),
  };

  if (!hasSupabase) {
    memoryStore.semanticMemory.push(payload);
    return payload;
  }

  const { data, error } = await supabase()
    .from("semantic_memory")
    .insert({
      id: payload.id,
      user_id: payload.userId,
      session_id: payload.sessionId,
      text_chunk: payload.textChunk,
      message_ids: payload.messageIds,
      embedding: payload.embedding,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to store semantic memory chunk");
  }

  return toChunk(data);
};

export const searchSemanticMemory = async ({
  userId,
  queryEmbedding,
  count = 6,
}: {
  userId: string;
  queryEmbedding: number[];
  count?: number;
}): Promise<RetrievedContext[]> => {
  if (!hasSupabase) {
    return memoryStore.semanticMemory
      .filter((chunk) => chunk.userId === userId)
      .map((chunk) => {
        const similarityScore = cosineSimilarity(chunk.embedding, queryEmbedding);
        const ageMs = Date.now() - new Date(chunk.createdAt).getTime();
        const recencyScore = Math.max(0, 1 - ageMs / (1000 * 60 * 60 * 24 * 30));
        const finalScore = similarityScore * 0.8 + recencyScore * 0.2;
        return { chunk, similarityScore, recencyScore, finalScore };
      })
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, count);
  }

  const { data, error } = await supabase().rpc("match_semantic_memory", {
    p_user_id: userId,
    query_embedding: queryEmbedding,
    match_count: count,
    match_threshold: 0.2,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    chunk: {
      id: String(row.id),
      userId,
      sessionId: String(row.session_id),
      textChunk: String(row.text_chunk),
      messageIds: Array.isArray(row.message_ids) ? (row.message_ids as string[]) : [],
      embedding: [],
      createdAt: String(row.created_at),
    },
    similarityScore: Number(row.similarity_score ?? 0),
    recencyScore: Number(row.recency_score ?? 0),
    finalScore: Number(row.final_score ?? 0),
  }));
};

export const isSupabaseEnabled = (): boolean => hasSupabase;

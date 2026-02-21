import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { DEFAULT_LANGUAGE, DEFAULT_PERSONA_ID } from "@/lib/personas";
import { getSupabaseAdminClient, hasSupabaseAdmin } from "@/lib/server/supabase";
import type {
  Attachment,
  Briefing,
  ChatMessage,
  ChatRole,
  ChatSession,
  Citation,
  FeatureFlag,
  MessageFormat,
  MessageReaction,
  MessageTranslation,
  NotificationItem,
  ProductEvent,
  PushSubscription,
  Reminder,
  RetrievedContext,
  SavedMessage,
  SemanticMemoryChunk,
  Task,
  TaskStatus,
  WorkingMemoryState,
} from "@/lib/types";

type SearchCacheEntry = {
  query: string;
  answer: string;
  citations: Omit<Citation, "id" | "messageId" | "userId" | "createdAt">[];
  createdAt: string;
};

interface Store {
  sessions: ChatSession[];
  messages: ChatMessage[];
  semanticMemory: SemanticMemoryChunk[];
  workingMemory: WorkingMemoryState[];
  savedMessages: SavedMessage[];
  reactions: MessageReaction[];
  translations: MessageTranslation[];
  citations: Citation[];
  attachments: Attachment[];
  tasks: Task[];
  reminders: Reminder[];
  briefings: Briefing[];
  pushSubscriptions: PushSubscription[];
  notifications: NotificationItem[];
  featureFlags: FeatureFlag[];
  events: ProductEvent[];
  searchCache: SearchCacheEntry[];
}

declare global {
  var __assistantMemoryStore: Store | undefined;
}

const store: Store =
  globalThis.__assistantMemoryStore ??
  (globalThis.__assistantMemoryStore = {
    sessions: [],
    messages: [],
    semanticMemory: [],
    workingMemory: [],
    savedMessages: [],
    reactions: [],
    translations: [],
    citations: [],
    attachments: [],
    tasks: [],
    reminders: [],
    briefings: [],
    pushSubscriptions: [],
    notifications: [],
    featureFlags: [],
    events: [],
    searchCache: [],
  });

const hasSupabase = hasSupabaseAdmin();
const nowIso = (): string => new Date().toISOString();
const createId = (): string => crypto.randomUUID();
const supabase = (): SupabaseClient => getSupabaseAdminClient();
const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const normalizeSession = (session: ChatSession): ChatSession => ({
  ...session,
  summary: session.summary ?? "",
  summaryUpdatedAt: session.summaryUpdatedAt ?? null,
  personaId: session.personaId ?? DEFAULT_PERSONA_ID,
  preferredLanguage: session.preferredLanguage ?? DEFAULT_LANGUAGE,
  isTitleCustom: Boolean(session.isTitleCustom),
});

const toSession = (row: Record<string, unknown>): ChatSession =>
  normalizeSession({
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title ?? "New conversation"),
    summary: String(row.summary ?? ""),
    summaryUpdatedAt: row.summary_updated_at ? String(row.summary_updated_at) : null,
    isTitleCustom: Boolean(row.is_title_custom),
    personaId: (row.persona_id as ChatSession["personaId"]) ?? DEFAULT_PERSONA_ID,
    preferredLanguage: row.preferred_language ? String(row.preferred_language) : null,
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
  format: (row.format as MessageFormat) ?? "text",
  metadata: toRecord(row.metadata),
  editedAt: row.edited_at ? String(row.edited_at) : null,
  editedFromMessageId: row.edited_from_message_id
    ? String(row.edited_from_message_id)
    : null,
  regenerationRootId: row.regeneration_root_id
    ? String(row.regeneration_root_id)
    : null,
  createdAt: String(row.created_at),
  audioUrl: row.audio_url ? String(row.audio_url) : null,
});

export const listSessions = async (
  userId: string,
  options: {
    query?: string;
    savedOnly?: boolean;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<ChatSession[]> => {
  const query = options.query?.trim().toLowerCase();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  if (!hasSupabase) {
    const sessionIdsWithSaved = new Set(
      store.savedMessages.filter((s) => s.userId === userId).map((s) => s.sessionId)
    );
    return store.sessions
      .filter((s) => s.userId === userId)
      .filter((s) => !options.savedOnly || sessionIdsWithSaved.has(s.id))
      .filter((s) => {
        if (!query) return true;
        const inSession =
          s.title.toLowerCase().includes(query) ||
          (s.summary ?? "").toLowerCase().includes(query);
        if (inSession) return true;
        return store.messages.some(
          (m) =>
            m.userId === userId &&
            m.sessionId === s.id &&
            m.content.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(offset, offset + pageSize)
      .map(normalizeSession);
  }

  let idsFromSearch: string[] | null = null;
  if (query) {
    const escaped = query.replaceAll("%", "\\%").replaceAll("_", "\\_");
    const [{ data: bySession }, { data: byMessage }] = await Promise.all([
      supabase()
        .from("sessions")
        .select("id")
        .eq("user_id", userId)
        .or(`title.ilike.%${escaped}%,summary.ilike.%${escaped}%`),
      supabase()
        .from("messages")
        .select("session_id")
        .eq("user_id", userId)
        .ilike("content", `%${escaped}%`)
        .limit(300),
    ]);
    idsFromSearch = [
      ...new Set([
        ...(bySession ?? []).map((r) => String((r as Record<string, unknown>).id)),
        ...(byMessage ?? []).map((r) => String((r as Record<string, unknown>).session_id)),
      ]),
    ];
    if (idsFromSearch.length === 0) {
      return [];
    }
  }

  let builder = supabase()
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (idsFromSearch) {
    builder = builder.in("id", idsFromSearch);
  }

  if (options.savedOnly) {
    const { data, error } = await supabase()
      .from("saved_messages")
      .select("session_id")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    const ids = [...new Set((data ?? []).map((r) => String(r.session_id)))];
    if (ids.length === 0) return [];
    builder = builder.in("id", ids);
  }

  const { data, error } = await builder.range(offset, offset + pageSize - 1);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toSession(row));
};

export const getSessionById = async ({
  userId,
  sessionId,
}: {
  userId: string;
  sessionId: string;
}): Promise<ChatSession | null> => {
  if (!hasSupabase) {
    return (
      store.sessions.find((s) => s.userId === userId && s.id === sessionId) ?? null
    );
  }
  const { data, error } = await supabase()
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toSession(data) : null;
};

export const createSession = async ({
  userId,
  title,
  mode = "text",
  personaId = DEFAULT_PERSONA_ID,
  preferredLanguage = DEFAULT_LANGUAGE,
}: {
  userId: string;
  title?: string;
  mode?: "text" | "voice";
  personaId?: ChatSession["personaId"];
  preferredLanguage?: string;
}): Promise<ChatSession> => {
  const session: ChatSession = normalizeSession({
    id: createId(),
    userId,
    title: title?.trim() || "New conversation",
    summary: "",
    summaryUpdatedAt: null,
    isTitleCustom: Boolean(title?.trim()),
    personaId,
    preferredLanguage,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    mode,
  });

  if (!hasSupabase) {
    store.sessions.push(session);
    return session;
  }
  const { data, error } = await supabase()
    .from("sessions")
    .insert({
      id: session.id,
      user_id: session.userId,
      title: session.title,
      summary: session.summary,
      summary_updated_at: session.summaryUpdatedAt,
      is_title_custom: session.isTitleCustom,
      persona_id: session.personaId,
      preferred_language: session.preferredLanguage,
      mode: session.mode,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create session");
  return toSession(data);
};

export const updateSession = async ({
  userId,
  sessionId,
  title,
  summary,
  personaId,
  preferredLanguage,
  isTitleCustom,
}: {
  userId: string;
  sessionId: string;
  title?: string;
  summary?: string;
  personaId?: ChatSession["personaId"];
  preferredLanguage?: string | null;
  isTitleCustom?: boolean;
}): Promise<ChatSession> => {
  if (!hasSupabase) {
    const existing = store.sessions.find((s) => s.userId === userId && s.id === sessionId);
    if (!existing) throw new Error("Session not found");
    if (title !== undefined) existing.title = title.trim() || "New conversation";
    if (summary !== undefined) {
      existing.summary = summary.trim();
      existing.summaryUpdatedAt = nowIso();
    }
    if (personaId !== undefined) existing.personaId = personaId;
    if (preferredLanguage !== undefined) existing.preferredLanguage = preferredLanguage;
    if (isTitleCustom !== undefined) existing.isTitleCustom = isTitleCustom;
    else if (title !== undefined) existing.isTitleCustom = true;
    existing.updatedAt = nowIso();
    return existing;
  }

  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (title !== undefined) patch.title = title.trim() || "New conversation";
  if (summary !== undefined) {
    patch.summary = summary.trim();
    patch.summary_updated_at = nowIso();
  }
  if (personaId !== undefined) patch.persona_id = personaId;
  if (preferredLanguage !== undefined) patch.preferred_language = preferredLanguage;
  if (isTitleCustom !== undefined) patch.is_title_custom = isTitleCustom;
  else if (title !== undefined) patch.is_title_custom = true;

  const { data, error } = await supabase()
    .from("sessions")
    .update(patch)
    .eq("user_id", userId)
    .eq("id", sessionId)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to update session");
  return toSession(data);
};

export const touchSession = async (sessionId: string): Promise<void> => {
  if (!hasSupabase) {
    const existing = store.sessions.find((s) => s.id === sessionId);
    if (existing) existing.updatedAt = nowIso();
    return;
  }
  const { error } = await supabase()
    .from("sessions")
    .update({ updated_at: nowIso() })
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
};

export const getMessages = async ({
  userId,
  sessionId,
}: {
  userId: string;
  sessionId: string;
}): Promise<ChatMessage[]> => {
  if (!hasSupabase) {
    return store.messages
      .filter((m) => m.userId === userId && m.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  const { data, error } = await supabase()
    .from("messages")
    .select("*")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toMessage(row));
};

export const getMessageById = async ({
  userId,
  messageId,
}: {
  userId: string;
  messageId: string;
}): Promise<ChatMessage | null> => {
  if (!hasSupabase) {
    return (
      store.messages.find((m) => m.userId === userId && m.id === messageId) ?? null
    );
  }
  const { data, error } = await supabase()
    .from("messages")
    .select("*")
    .eq("user_id", userId)
    .eq("id", messageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toMessage(data) : null;
};

export const addMessage = async ({
  userId,
  sessionId,
  role,
  content,
  audioUrl,
  format = "text",
  metadata = {},
  editedAt = null,
  editedFromMessageId = null,
  regenerationRootId = null,
}: {
  userId: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  audioUrl?: string | null;
  format?: MessageFormat;
  metadata?: Record<string, unknown>;
  editedAt?: string | null;
  editedFromMessageId?: string | null;
  regenerationRootId?: string | null;
}): Promise<ChatMessage> => {
  const message: ChatMessage = {
    id: createId(),
    sessionId,
    userId,
    role,
    content,
    format,
    metadata,
    editedAt,
    editedFromMessageId,
    regenerationRootId,
    createdAt: nowIso(),
    audioUrl: audioUrl ?? null,
  };

  if (!hasSupabase) {
    store.messages.push(message);
    await touchSession(sessionId);
    return message;
  }
  const { data, error } = await supabase()
    .from("messages")
    .insert({
      id: message.id,
      session_id: message.sessionId,
      user_id: message.userId,
      role: message.role,
      content: message.content,
      format: message.format,
      metadata: message.metadata,
      edited_at: message.editedAt,
      edited_from_message_id: message.editedFromMessageId,
      regeneration_root_id: message.regenerationRootId,
      audio_url: message.audioUrl,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to store message");
  await touchSession(sessionId);
  return toMessage(data);
};

export const updateMessage = async ({
  userId,
  messageId,
  content,
  metadata,
}: {
  userId: string;
  messageId: string;
  content?: string;
  metadata?: Record<string, unknown>;
}): Promise<ChatMessage> => {
  if (!hasSupabase) {
    const existing = store.messages.find((m) => m.userId === userId && m.id === messageId);
    if (!existing) throw new Error("Message not found");
    if (content !== undefined) {
      existing.content = content;
      existing.editedAt = nowIso();
      existing.editedFromMessageId = existing.editedFromMessageId ?? existing.id;
    }
    if (metadata) {
      existing.metadata = { ...existing.metadata, ...metadata };
    }
    await touchSession(existing.sessionId);
    return existing;
  }
  const patch: Record<string, unknown> = {};
  if (content !== undefined) {
    patch.content = content;
    patch.edited_at = nowIso();
  }
  if (metadata) patch.metadata = metadata;
  const { data, error } = await supabase()
    .from("messages")
    .update(patch)
    .eq("user_id", userId)
    .eq("id", messageId)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to update message");
  await touchSession(String((data as Record<string, unknown>).session_id));
  return toMessage(data);
};

export const deleteMessagesAfter = async ({
  userId,
  sessionId,
  messageId,
}: {
  userId: string;
  sessionId: string;
  messageId: string;
}): Promise<void> => {
  const messages = await getMessages({ userId, sessionId });
  const index = messages.findIndex((m) => m.id === messageId);
  if (index === -1) throw new Error("Message not found in session");
  const ids = messages.slice(index + 1).map((m) => m.id);
  if (ids.length === 0) return;

  if (!hasSupabase) {
    store.messages = store.messages.filter((m) => !(m.userId === userId && ids.includes(m.id)));
    store.savedMessages = store.savedMessages.filter(
      (s) => !(s.userId === userId && ids.includes(s.messageId))
    );
    store.reactions = store.reactions.filter(
      (r) => !(r.userId === userId && ids.includes(r.messageId))
    );
    store.translations = store.translations.filter(
      (t) => !(t.userId === userId && ids.includes(t.messageId))
    );
    store.citations = store.citations.filter(
      (c) => !(c.userId === userId && ids.includes(c.messageId))
    );
    return;
  }
  const { error } = await supabase()
    .from("messages")
    .delete()
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw new Error(error.message);
};

export const deleteSession = async ({
  userId,
  sessionId,
}: {
  userId: string;
  sessionId: string;
}): Promise<void> => {
  if (!hasSupabase) {
    store.sessions = store.sessions.filter((s) => !(s.userId === userId && s.id === sessionId));
    store.messages = store.messages.filter(
      (m) => !(m.userId === userId && m.sessionId === sessionId)
    );
    return;
  }
  const { error } = await supabase()
    .from("sessions")
    .delete()
    .eq("user_id", userId)
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
};

export const refreshSessionSummary = async ({
  userId,
  sessionId,
}: {
  userId: string;
  sessionId: string;
}): Promise<string> => {
  const latest = (await getMessages({ userId, sessionId })).slice(-6);
  const summary = latest
    .map((m) => `${m.role}: ${m.content.replace(/\s+/g, " ").trim()}`)
    .join(" | ")
    .slice(0, 260);
  await updateSession({ userId, sessionId, summary });
  return summary;
};

export const listSavedMessages = async ({
  userId,
  sessionId,
}: {
  userId: string;
  sessionId?: string;
}): Promise<SavedMessage[]> => {
  if (!hasSupabase) {
    return store.savedMessages.filter(
      (s) => s.userId === userId && (!sessionId || s.sessionId === sessionId)
    );
  }
  let builder = supabase().from("saved_messages").select("*").eq("user_id", userId);
  if (sessionId) builder = builder.eq("session_id", sessionId);
  const { data, error } = await builder.order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    messageId: String(r.message_id),
    sessionId: String(r.session_id),
    createdAt: String(r.created_at),
  }));
};

export const saveMessageBookmark = async ({
  userId,
  sessionId,
  messageId,
}: {
  userId: string;
  sessionId: string;
  messageId: string;
}): Promise<SavedMessage> => {
  if (!hasSupabase) {
    const existing = store.savedMessages.find(
      (s) => s.userId === userId && s.messageId === messageId
    );
    if (existing) return existing;
    const saved: SavedMessage = {
      id: createId(),
      userId,
      sessionId,
      messageId,
      createdAt: nowIso(),
    };
    store.savedMessages.push(saved);
    return saved;
  }
  const { data, error } = await supabase()
    .from("saved_messages")
    .upsert(
      { user_id: userId, session_id: sessionId, message_id: messageId },
      { onConflict: "user_id,message_id" }
    )
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to bookmark");
  return {
    id: String(data.id),
    userId: String(data.user_id),
    sessionId: String(data.session_id),
    messageId: String(data.message_id),
    createdAt: String(data.created_at),
  };
};

export const removeMessageBookmark = async ({
  userId,
  messageId,
}: {
  userId: string;
  messageId: string;
}): Promise<void> => {
  if (!hasSupabase) {
    store.savedMessages = store.savedMessages.filter(
      (s) => !(s.userId === userId && s.messageId === messageId)
    );
    return;
  }
  const { error } = await supabase()
    .from("saved_messages")
    .delete()
    .eq("user_id", userId)
    .eq("message_id", messageId);
  if (error) throw new Error(error.message);
};

export const saveMessageReaction = async ({
  userId,
  messageId,
  sessionId,
  value,
  feedback,
}: {
  userId: string;
  messageId: string;
  sessionId: string;
  value: "up" | "down";
  feedback?: string | null;
}): Promise<MessageReaction> => {
  if (!hasSupabase) {
    const existing = store.reactions.find(
      (r) => r.userId === userId && r.messageId === messageId
    );
    if (existing) {
      existing.value = value;
      existing.feedback = feedback ?? null;
      existing.updatedAt = nowIso();
      return existing;
    }
    const reaction: MessageReaction = {
      id: createId(),
      userId,
      messageId,
      sessionId,
      value,
      feedback: feedback ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.reactions.push(reaction);
    return reaction;
  }
  const { data, error } = await supabase()
    .from("message_reactions")
    .upsert(
      {
        user_id: userId,
        message_id: messageId,
        session_id: sessionId,
        value,
        feedback: feedback ?? null,
        updated_at: nowIso(),
      },
      { onConflict: "user_id,message_id" }
    )
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to save reaction");
  return {
    id: String(data.id),
    userId: String(data.user_id),
    messageId: String(data.message_id),
    sessionId: String(data.session_id),
    value: (data.value as "up" | "down") ?? "up",
    feedback: data.feedback ? String(data.feedback) : null,
    createdAt: String(data.created_at),
    updatedAt: String(data.updated_at),
  };
};

export const saveMessageTranslation = async ({
  userId,
  messageId,
  targetLanguage,
  translatedText,
}: {
  userId: string;
  messageId: string;
  targetLanguage: string;
  translatedText: string;
}): Promise<MessageTranslation> => {
  if (!hasSupabase) {
    const existing = store.translations.find(
      (t) =>
        t.userId === userId &&
        t.messageId === messageId &&
        t.targetLanguage === targetLanguage
    );
    if (existing) {
      existing.translatedText = translatedText;
      return existing;
    }
    const translation: MessageTranslation = {
      id: createId(),
      userId,
      messageId,
      targetLanguage,
      translatedText,
      createdAt: nowIso(),
    };
    store.translations.push(translation);
    return translation;
  }
  const { data, error } = await supabase()
    .from("message_translations")
    .upsert(
      {
        user_id: userId,
        message_id: messageId,
        target_language: targetLanguage,
        translated_text: translatedText,
      },
      { onConflict: "user_id,message_id,target_language" }
    )
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to save translation");
  return {
    id: String(data.id),
    userId: String(data.user_id),
    messageId: String(data.message_id),
    targetLanguage: String(data.target_language),
    translatedText: String(data.translated_text),
    createdAt: String(data.created_at),
  };
};

export const addMessageCitations = async ({
  userId,
  messageId,
  citations,
}: {
  userId: string;
  messageId: string;
  citations: Omit<Citation, "id" | "messageId" | "userId" | "createdAt">[];
}): Promise<Citation[]> => {
  if (citations.length === 0) return [];
  if (!hasSupabase) {
    const rows = citations.map((entry) => ({
      id: createId(),
      messageId,
      userId,
      title: entry.title,
      url: entry.url,
      source: entry.source ?? null,
      snippet: entry.snippet ?? null,
      createdAt: nowIso(),
    }));
    store.citations.push(...rows);
    return rows;
  }
  const { data, error } = await supabase()
    .from("message_citations")
    .insert(
      citations.map((entry) => ({
        id: createId(),
        user_id: userId,
        message_id: messageId,
        title: entry.title,
        url: entry.url,
        source: entry.source ?? null,
        snippet: entry.snippet ?? null,
      }))
    )
    .select("*");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    messageId: String(row.message_id),
    userId: String(row.user_id),
    title: String(row.title),
    url: String(row.url),
    source: row.source ? String(row.source) : null,
    snippet: row.snippet ? String(row.snippet) : null,
    createdAt: String(row.created_at),
  }));
};

export const getMessageCitations = async ({
  userId,
  messageId,
}: {
  userId: string;
  messageId: string;
}): Promise<Citation[]> => {
  if (!hasSupabase) {
    return store.citations.filter((c) => c.userId === userId && c.messageId === messageId);
  }
  const { data, error } = await supabase()
    .from("message_citations")
    .select("*")
    .eq("user_id", userId)
    .eq("message_id", messageId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    messageId: String(row.message_id),
    userId: String(row.user_id),
    title: String(row.title),
    url: String(row.url),
    source: row.source ? String(row.source) : null,
    snippet: row.snippet ? String(row.snippet) : null,
    createdAt: String(row.created_at),
  }));
};

export const addAttachment = async ({
  userId,
  sessionId,
  messageId,
  name,
  mimeType,
  sizeBytes,
  storagePath,
  url,
  kind,
}: {
  userId: string;
  sessionId: string;
  messageId?: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  url: string;
  kind: Attachment["kind"];
}): Promise<Attachment> => {
  const payload: Attachment = {
    id: createId(),
    userId,
    sessionId,
    messageId: messageId ?? null,
    name,
    mimeType,
    sizeBytes,
    storagePath,
    url,
    kind,
    createdAt: nowIso(),
  };

  if (!hasSupabase) {
    store.attachments.push(payload);
    return payload;
  }
  const { data, error } = await supabase()
    .from("attachments")
    .insert({
      id: payload.id,
      user_id: payload.userId,
      session_id: payload.sessionId,
      message_id: payload.messageId,
      name: payload.name,
      mime_type: payload.mimeType,
      size_bytes: payload.sizeBytes,
      storage_path: payload.storagePath,
      url: payload.url,
      kind: payload.kind,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to save attachment");
  return {
    id: String(data.id),
    sessionId: String(data.session_id),
    userId: String(data.user_id),
    messageId: data.message_id ? String(data.message_id) : null,
    name: String(data.name),
    mimeType: String(data.mime_type),
    sizeBytes: Number(data.size_bytes ?? 0),
    storagePath: String(data.storage_path),
    url: String(data.url),
    kind: (data.kind as Attachment["kind"]) ?? "other",
    createdAt: String(data.created_at),
  };
};

export const getAttachment = async ({
  userId,
  attachmentId,
}: {
  userId: string;
  attachmentId: string;
}): Promise<Attachment | null> => {
  if (!hasSupabase) {
    return (
      store.attachments.find((a) => a.userId === userId && a.id === attachmentId) ?? null
    );
  }
  const { data, error } = await supabase()
    .from("attachments")
    .select("*")
    .eq("user_id", userId)
    .eq("id", attachmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: String(data.id),
    sessionId: String(data.session_id),
    userId: String(data.user_id),
    messageId: data.message_id ? String(data.message_id) : null,
    name: String(data.name),
    mimeType: String(data.mime_type),
    sizeBytes: Number(data.size_bytes ?? 0),
    storagePath: String(data.storage_path),
    url: String(data.url),
    kind: (data.kind as Attachment["kind"]) ?? "other",
    createdAt: String(data.created_at),
  };
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
    userId,
    sessionId,
    rollingSummary,
    activeEntities,
    updatedAt: nowIso(),
  };

  if (!hasSupabase) {
    const index = store.workingMemory.findIndex(
      (item) => item.userId === userId && item.sessionId === sessionId
    );
    if (index === -1) store.workingMemory.push(payload);
    else store.workingMemory[index] = payload;
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
        updated_at: payload.updatedAt,
      },
      { onConflict: "user_id,session_id" }
    )
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to update working memory");
  return {
    userId: String(data.user_id),
    sessionId: String(data.session_id),
    rollingSummary: String(data.rolling_summary),
    activeEntities: toStringArray(data.active_entities),
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
      store.workingMemory.find(
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
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    userId: String(data.user_id),
    sessionId: String(data.session_id),
    rollingSummary: String(data.rolling_summary),
    activeEntities: toStringArray(data.active_entities),
    updatedAt: String(data.updated_at),
  };
};

const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
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
    messageIds,
    textChunk,
    embedding,
    createdAt: nowIso(),
  };

  if (!hasSupabase) {
    store.semanticMemory.push(payload);
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
  if (error || !data) throw new Error(error?.message ?? "Failed to save semantic chunk");
  return {
    id: String(data.id),
    sessionId: String(data.session_id),
    userId: String(data.user_id),
    messageIds: toStringArray(data.message_ids),
    textChunk: String(data.text_chunk),
    embedding: Array.isArray(data.embedding) ? (data.embedding as number[]) : [],
    createdAt: String(data.created_at),
  };
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
    return store.semanticMemory
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
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    chunk: {
      id: String(row.id),
      sessionId: String(row.session_id),
      userId,
      messageIds: toStringArray(row.message_ids),
      textChunk: String(row.text_chunk),
      embedding: [],
      createdAt: String(row.created_at),
    },
    similarityScore: Number(row.similarity_score ?? 0),
    recencyScore: Number(row.recency_score ?? 0),
    finalScore: Number(row.final_score ?? 0),
  }));
};

export const getSearchCache = async ({
  query,
}: {
  query: string;
}): Promise<SearchCacheEntry | null> => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  if (!hasSupabase) {
    return store.searchCache.find((entry) => entry.query === normalized) ?? null;
  }
  const { data, error } = await supabase()
    .from("search_cache")
    .select("*")
    .eq("query", normalized)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    query: String(data.query),
    answer: String(data.answer),
    citations: Array.isArray(data.citations)
      ? (data.citations as SearchCacheEntry["citations"])
      : [],
    createdAt: String(data.created_at),
  };
};

export const saveSearchCache = async ({
  query,
  answer,
  citations,
}: {
  query: string;
  answer: string;
  citations: SearchCacheEntry["citations"];
}): Promise<void> => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return;

  if (!hasSupabase) {
    const idx = store.searchCache.findIndex((entry) => entry.query === normalized);
    const next: SearchCacheEntry = {
      query: normalized,
      answer,
      citations,
      createdAt: nowIso(),
    };
    if (idx === -1) store.searchCache.push(next);
    else store.searchCache[idx] = next;
    return;
  }
  const { error } = await supabase()
    .from("search_cache")
    .upsert(
      {
        query: normalized,
        answer,
        citations,
        created_at: nowIso(),
      },
      { onConflict: "query" }
    );
  if (error) throw new Error(error.message);
};

export const createTask = async ({
  userId,
  title,
  notes,
  dueAt,
}: {
  userId: string;
  title: string;
  notes?: string | null;
  dueAt?: string | null;
}): Promise<Task> => {
  const task: Task = {
    id: createId(),
    userId,
    title: title.trim(),
    notes: notes ?? null,
    dueAt: dueAt ?? null,
    status: "pending",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  if (!hasSupabase) {
    store.tasks.push(task);
    return task;
  }
  const { data, error } = await supabase()
    .from("tasks")
    .insert({
      id: task.id,
      user_id: task.userId,
      title: task.title,
      notes: task.notes,
      due_at: task.dueAt,
      status: task.status,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create task");
  return {
    id: String(data.id),
    userId: String(data.user_id),
    title: String(data.title),
    notes: data.notes ? String(data.notes) : null,
    dueAt: data.due_at ? String(data.due_at) : null,
    status: (data.status as TaskStatus) ?? "pending",
    createdAt: String(data.created_at),
    updatedAt: String(data.updated_at),
  };
};

export const listTasks = async ({
  userId,
  status,
}: {
  userId: string;
  status?: TaskStatus;
}): Promise<Task[]> => {
  if (!hasSupabase) {
    return store.tasks.filter((t) => t.userId === userId && (!status || t.status === status));
  }
  let builder = supabase().from("tasks").select("*").eq("user_id", userId);
  if (status) builder = builder.eq("status", status);
  const { data, error } = await builder.order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    title: String(r.title),
    notes: r.notes ? String(r.notes) : null,
    dueAt: r.due_at ? String(r.due_at) : null,
    status: (r.status as TaskStatus) ?? "pending",
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
};

export const updateTask = async ({
  userId,
  taskId,
  title,
  notes,
  dueAt,
  status,
}: {
  userId: string;
  taskId: string;
  title?: string;
  notes?: string | null;
  dueAt?: string | null;
  status?: TaskStatus;
}): Promise<Task> => {
  if (!hasSupabase) {
    const task = store.tasks.find((t) => t.userId === userId && t.id === taskId);
    if (!task) throw new Error("Task not found");
    if (title !== undefined) task.title = title.trim();
    if (notes !== undefined) task.notes = notes;
    if (dueAt !== undefined) task.dueAt = dueAt;
    if (status !== undefined) task.status = status;
    task.updatedAt = nowIso();
    return task;
  }
  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (title !== undefined) patch.title = title.trim();
  if (notes !== undefined) patch.notes = notes;
  if (dueAt !== undefined) patch.due_at = dueAt;
  if (status !== undefined) patch.status = status;
  const { data, error } = await supabase()
    .from("tasks")
    .update(patch)
    .eq("user_id", userId)
    .eq("id", taskId)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to update task");
  return {
    id: String(data.id),
    userId: String(data.user_id),
    title: String(data.title),
    notes: data.notes ? String(data.notes) : null,
    dueAt: data.due_at ? String(data.due_at) : null,
    status: (data.status as TaskStatus) ?? "pending",
    createdAt: String(data.created_at),
    updatedAt: String(data.updated_at),
  };
};

export const createReminder = async ({
  userId,
  taskId,
  text,
  dueAt,
}: {
  userId: string;
  taskId?: string | null;
  text: string;
  dueAt: string;
}): Promise<Reminder> => {
  const reminder: Reminder = {
    id: createId(),
    userId,
    taskId: taskId ?? null,
    text,
    dueAt,
    deliveredAt: null,
    createdAt: nowIso(),
  };
  if (!hasSupabase) {
    store.reminders.push(reminder);
    return reminder;
  }
  const { data, error } = await supabase()
    .from("reminders")
    .insert({
      id: reminder.id,
      user_id: reminder.userId,
      task_id: reminder.taskId,
      text: reminder.text,
      due_at: reminder.dueAt,
      delivered_at: reminder.deliveredAt,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create reminder");
  return {
    id: String(data.id),
    userId: String(data.user_id),
    taskId: data.task_id ? String(data.task_id) : null,
    text: String(data.text),
    dueAt: String(data.due_at),
    deliveredAt: data.delivered_at ? String(data.delivered_at) : null,
    createdAt: String(data.created_at),
  };
};

export const listReminders = async ({
  userId,
}: {
  userId: string;
}): Promise<Reminder[]> => {
  if (!hasSupabase) {
    return store.reminders.filter((r) => r.userId === userId);
  }
  const { data, error } = await supabase()
    .from("reminders")
    .select("*")
    .eq("user_id", userId)
    .order("due_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    taskId: r.task_id ? String(r.task_id) : null,
    text: String(r.text),
    dueAt: String(r.due_at),
    deliveredAt: r.delivered_at ? String(r.delivered_at) : null,
    createdAt: String(r.created_at),
  }));
};

export const listDueReminders = async ({ at }: { at: string }): Promise<Reminder[]> => {
  if (!hasSupabase) {
    return store.reminders.filter((r) => !r.deliveredAt && r.dueAt <= at);
  }
  const { data, error } = await supabase()
    .from("reminders")
    .select("*")
    .lte("due_at", at)
    .is("delivered_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    taskId: r.task_id ? String(r.task_id) : null,
    text: String(r.text),
    dueAt: String(r.due_at),
    deliveredAt: r.delivered_at ? String(r.delivered_at) : null,
    createdAt: String(r.created_at),
  }));
};

export const markReminderDelivered = async ({
  reminderId,
}: {
  reminderId: string;
}): Promise<void> => {
  if (!hasSupabase) {
    const reminder = store.reminders.find((r) => r.id === reminderId);
    if (reminder) reminder.deliveredAt = nowIso();
    return;
  }
  const { error } = await supabase()
    .from("reminders")
    .update({ delivered_at: nowIso() })
    .eq("id", reminderId);
  if (error) throw new Error(error.message);
};

export const createBriefing = async ({
  userId,
  briefingDate,
  timezone,
  content,
  topics,
}: {
  userId: string;
  briefingDate: string;
  timezone: string;
  content: string;
  topics: string[];
}): Promise<Briefing> => {
  const briefing: Briefing = {
    id: createId(),
    userId,
    briefingDate,
    timezone,
    content,
    topics,
    createdAt: nowIso(),
  };
  if (!hasSupabase) {
    store.briefings.push(briefing);
    return briefing;
  }
  const { data, error } = await supabase()
    .from("briefings")
    .insert({
      id: briefing.id,
      user_id: briefing.userId,
      briefing_date: briefing.briefingDate,
      timezone: briefing.timezone,
      content: briefing.content,
      topics: briefing.topics,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create briefing");
  return {
    id: String(data.id),
    userId: String(data.user_id),
    briefingDate: String(data.briefing_date),
    timezone: String(data.timezone),
    content: String(data.content),
    topics: toStringArray(data.topics),
    createdAt: String(data.created_at),
  };
};

export const getTodayBriefing = async ({
  userId,
  briefingDate,
}: {
  userId: string;
  briefingDate: string;
}): Promise<Briefing | null> => {
  if (!hasSupabase) {
    return (
      store.briefings.find((b) => b.userId === userId && b.briefingDate === briefingDate) ??
      null
    );
  }
  const { data, error } = await supabase()
    .from("briefings")
    .select("*")
    .eq("user_id", userId)
    .eq("briefing_date", briefingDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: String(data.id),
    userId: String(data.user_id),
    briefingDate: String(data.briefing_date),
    timezone: String(data.timezone),
    content: String(data.content),
    topics: toStringArray(data.topics),
    createdAt: String(data.created_at),
  };
};

export const upsertPushSubscription = async ({
  userId,
  endpoint,
  p256dh,
  auth,
}: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<PushSubscription> => {
  if (!hasSupabase) {
    const existing = store.pushSubscriptions.find(
      (s) => s.userId === userId && s.endpoint === endpoint
    );
    if (existing) {
      existing.p256dh = p256dh;
      existing.auth = auth;
      return existing;
    }
    const subscription: PushSubscription = {
      id: createId(),
      userId,
      endpoint,
      p256dh,
      auth,
      createdAt: nowIso(),
    };
    store.pushSubscriptions.push(subscription);
    return subscription;
  }
  const { data, error } = await supabase()
    .from("push_subscriptions")
    .upsert(
      { user_id: userId, endpoint, p256dh, auth },
      { onConflict: "user_id,endpoint" }
    )
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to save push subscription");
  return {
    id: String(data.id),
    userId: String(data.user_id),
    endpoint: String(data.endpoint),
    p256dh: String(data.p256dh),
    auth: String(data.auth),
    createdAt: String(data.created_at),
  };
};

export const removePushSubscription = async ({
  userId,
  endpoint,
}: {
  userId: string;
  endpoint: string;
}): Promise<void> => {
  if (!hasSupabase) {
    store.pushSubscriptions = store.pushSubscriptions.filter(
      (s) => !(s.userId === userId && s.endpoint === endpoint)
    );
    return;
  }
  const { error } = await supabase()
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint", endpoint);
  if (error) throw new Error(error.message);
};

export const createNotification = async ({
  userId,
  title,
  body,
  linkUrl,
}: {
  userId: string;
  title: string;
  body: string;
  linkUrl?: string | null;
}): Promise<NotificationItem> => {
  const notification: NotificationItem = {
    id: createId(),
    userId,
    title,
    body,
    linkUrl: linkUrl ?? null,
    readAt: null,
    createdAt: nowIso(),
  };
  if (!hasSupabase) {
    store.notifications.push(notification);
    return notification;
  }
  const { data, error } = await supabase()
    .from("notifications")
    .insert({
      id: notification.id,
      user_id: notification.userId,
      title: notification.title,
      body: notification.body,
      link_url: notification.linkUrl,
      read_at: notification.readAt,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create notification");
  return {
    id: String(data.id),
    userId: String(data.user_id),
    title: String(data.title),
    body: String(data.body),
    linkUrl: data.link_url ? String(data.link_url) : null,
    readAt: data.read_at ? String(data.read_at) : null,
    createdAt: String(data.created_at),
  };
};

export const listNotifications = async ({
  userId,
}: {
  userId: string;
}): Promise<NotificationItem[]> => {
  if (!hasSupabase) {
    return store.notifications.filter((n) => n.userId === userId);
  }
  const { data, error } = await supabase()
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    body: String(row.body),
    linkUrl: row.link_url ? String(row.link_url) : null,
    readAt: row.read_at ? String(row.read_at) : null,
    createdAt: String(row.created_at),
  }));
};

export const trackProductEvent = async ({
  userId,
  eventType,
  payload,
}: {
  userId?: string | null;
  eventType: string;
  payload?: Record<string, unknown>;
}): Promise<ProductEvent> => {
  const event: ProductEvent = {
    id: createId(),
    userId: userId ?? null,
    eventType,
    payload: payload ?? {},
    createdAt: nowIso(),
  };
  if (!hasSupabase) {
    store.events.push(event);
    return event;
  }
  const { data, error } = await supabase()
    .from("product_events")
    .insert({
      id: event.id,
      user_id: event.userId,
      event_type: event.eventType,
      payload: event.payload,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to save event");
  return {
    id: String(data.id),
    userId: data.user_id ? String(data.user_id) : null,
    eventType: String(data.event_type),
    payload: toRecord(data.payload),
    createdAt: String(data.created_at),
  };
};

export const getFeatureFlag = async ({
  key,
  userId,
}: {
  key: string;
  userId?: string;
}): Promise<boolean> => {
  if (env.featureAllOn) return true;

  if (!hasSupabase) {
    const scoped = store.featureFlags.find(
      (flag) => flag.key === key && flag.userId === (userId ?? null)
    );
    if (scoped) return scoped.enabled;
    const global = store.featureFlags.find((flag) => flag.key === key && !flag.userId);
    return Boolean(global?.enabled);
  }
  if (userId) {
    const { data } = await supabase()
      .from("feature_flags")
      .select("enabled")
      .eq("key", key)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return Boolean(data.enabled);
  }
  const { data, error } = await supabase()
    .from("feature_flags")
    .select("enabled")
    .eq("key", key)
    .is("user_id", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.enabled);
};

export const setFeatureFlag = async ({
  key,
  enabled,
  userId,
  rollout,
}: {
  key: string;
  enabled: boolean;
  userId?: string | null;
  rollout?: Record<string, unknown>;
}): Promise<FeatureFlag> => {
  const payload: FeatureFlag = {
    key,
    userId: userId ?? null,
    enabled,
    rollout: rollout ?? {},
    updatedAt: nowIso(),
  };
  if (!hasSupabase) {
    const idx = store.featureFlags.findIndex(
      (flag) => flag.key === payload.key && flag.userId === payload.userId
    );
    if (idx === -1) store.featureFlags.push(payload);
    else store.featureFlags[idx] = payload;
    return payload;
  }
  const { data, error } = await supabase()
    .from("feature_flags")
    .upsert(
      {
        key: payload.key,
        user_id: payload.userId,
        enabled: payload.enabled,
        rollout: payload.rollout,
        updated_at: payload.updatedAt,
      },
      { onConflict: "key,user_id" }
    )
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to save feature flag");
  return {
    key: String(data.key),
    userId: data.user_id ? String(data.user_id) : null,
    enabled: Boolean(data.enabled),
    rollout: toRecord(data.rollout),
    updatedAt: String(data.updated_at),
  };
};

export const migrateGuestDataToUser = async ({
  guestUserId,
  authenticatedUserId,
}: {
  guestUserId: string;
  authenticatedUserId: string;
}): Promise<void> => {
  if (!guestUserId || guestUserId === authenticatedUserId) return;

  if (!hasSupabase) {
    const swap = <T extends { userId: string }>(items: T[]) => {
      items.forEach((item) => {
        if (item.userId === guestUserId) item.userId = authenticatedUserId;
      });
    };
    swap(store.sessions);
    swap(store.messages);
    swap(store.semanticMemory);
    swap(store.workingMemory);
    swap(store.savedMessages);
    swap(store.reactions);
    swap(store.translations);
    swap(store.citations);
    swap(store.attachments);
    swap(store.tasks);
    swap(store.reminders);
    swap(store.briefings);
    swap(store.pushSubscriptions);
    swap(store.notifications);
    return;
  }
  const tables = [
    "sessions",
    "messages",
    "semantic_memory",
    "working_memory",
    "saved_messages",
    "message_reactions",
    "message_translations",
    "message_citations",
    "attachments",
    "tasks",
    "reminders",
    "briefings",
    "push_subscriptions",
    "notifications",
    "product_events",
  ];
  for (const table of tables) {
    const { error } = await supabase()
      .from(table)
      .update({ user_id: authenticatedUserId })
      .eq("user_id", guestUserId);
    if (error) throw new Error(`Migration failed for ${table}: ${error.message}`);
  }
};

export const isSupabaseEnabled = (): boolean => hasSupabase;

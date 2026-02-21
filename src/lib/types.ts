export type ChatRole = "user" | "assistant" | "system";
export type MessageFormat = "text" | "markdown" | "image" | "attachment";
export type PersonaId =
  | "default"
  | "creative-writer"
  | "code-helper"
  | "fitness-coach"
  | "tutor";

export interface Citation {
  id: string;
  messageId: string;
  userId: string;
  title: string;
  url: string;
  source?: string | null;
  snippet?: string | null;
  createdAt: string;
}

export interface Attachment {
  id: string;
  sessionId: string;
  userId: string;
  messageId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  url: string;
  kind: "image" | "pdf" | "document" | "audio" | "other";
  createdAt: string;
}

export interface MessageMetadata {
  language?: string;
  personaId?: PersonaId;
  citations?: Citation[];
  attachments?: Attachment[];
  toolsUsed?: string[];
  searchQuery?: string;
  searchCacheHit?: boolean;
  reactionSummary?: {
    up: number;
    down: number;
  };
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  summary: string;
  summaryUpdatedAt: string | null;
  isTitleCustom: boolean;
  personaId: PersonaId;
  preferredLanguage: string | null;
  createdAt: string;
  updatedAt: string;
  mode: "text" | "voice";
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  userId: string;
  role: ChatRole;
  content: string;
  format: MessageFormat;
  metadata: MessageMetadata;
  editedAt: string | null;
  editedFromMessageId: string | null;
  regenerationRootId: string | null;
  createdAt: string;
  audioUrl: string | null;
}

export interface SavedMessage {
  id: string;
  userId: string;
  messageId: string;
  sessionId: string;
  createdAt: string;
}

export interface MessageReaction {
  id: string;
  userId: string;
  messageId: string;
  sessionId: string;
  value: "up" | "down";
  feedback: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageTranslation {
  id: string;
  userId: string;
  messageId: string;
  targetLanguage: string;
  translatedText: string;
  createdAt: string;
}

export type TaskStatus = "pending" | "in_progress" | "done" | "cancelled";

export interface Task {
  id: string;
  userId: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Reminder {
  id: string;
  userId: string;
  taskId: string | null;
  text: string;
  dueAt: string;
  deliveredAt: string | null;
  createdAt: string;
}

export interface Briefing {
  id: string;
  userId: string;
  briefingDate: string;
  timezone: string;
  content: string;
  topics: string[];
  createdAt: string;
}

export interface PushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  body: string;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface FeatureFlag {
  key: string;
  userId: string | null;
  enabled: boolean;
  rollout: Record<string, unknown>;
  updatedAt: string;
}

export interface ProductEvent {
  id: string;
  userId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WorkingMemoryState {
  sessionId: string;
  userId: string;
  rollingSummary: string;
  activeEntities: string[];
  updatedAt: string;
}

export interface SemanticMemoryChunk {
  id: string;
  sessionId: string;
  userId: string;
  messageIds: string[];
  textChunk: string;
  embedding: number[];
  createdAt: string;
}

export interface RetrievedContext {
  chunk: SemanticMemoryChunk;
  similarityScore: number;
  recencyScore: number;
  finalScore: number;
}

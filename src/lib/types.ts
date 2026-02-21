export type ChatRole = "user" | "assistant" | "system";

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
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
  createdAt: string;
  audioUrl: string | null;
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

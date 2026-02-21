"use client";

import type { ChatMessage, ChatSession } from "@/lib/types";

const DEVICE_ID_KEY = "assistant_device_id";
const CACHE_KEY = "assistant_local_cache_v1";
const OUTBOX_KEY = "assistant_outbox_v1";

export interface LocalCache {
  sessions: ChatSession[];
  messagesBySession: Record<string, ChatMessage[]>;
}

export interface OutboxItem {
  id: string;
  sessionId: string;
  content: string;
  createdAt: string;
}

const safeParse = <T>(raw: string | null, fallback: T): T => {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const generateId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

export const getDeviceId = (): string => {
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }
  const next = generateId();
  window.localStorage.setItem(DEVICE_ID_KEY, next);
  return next;
};

export const readLocalCache = (): LocalCache =>
  safeParse<LocalCache>(window.localStorage.getItem(CACHE_KEY), {
    sessions: [],
    messagesBySession: {},
  });

export const writeLocalCache = (cache: LocalCache): void => {
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
};

export const readOutbox = (): OutboxItem[] =>
  safeParse<OutboxItem[]>(window.localStorage.getItem(OUTBOX_KEY), []);

export const writeOutbox = (items: OutboxItem[]): void => {
  window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
};

export const enqueueOutbox = (payload: Omit<OutboxItem, "id" | "createdAt">) => {
  const current = readOutbox();
  const next: OutboxItem = {
    id: generateId(),
    createdAt: new Date().toISOString(),
    ...payload,
  };
  writeOutbox([...current, next]);
  return next;
};

export const removeOutboxItem = (id: string): void => {
  const current = readOutbox();
  writeOutbox(current.filter((item) => item.id !== id));
};


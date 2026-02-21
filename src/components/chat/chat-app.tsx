"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import { PERSONAS } from "@/lib/personas";
import type {
  Attachment,
  Briefing,
  ChatMessage,
  ChatSession,
  NotificationItem,
  PersonaId,
  Task,
} from "@/lib/types";
import {
  enqueueOutbox,
  getDeviceId,
  readLocalCache,
  readOutbox,
  removeOutboxItem,
  writeLocalCache,
} from "@/lib/client/storage";

type UiMessage = ChatMessage & {
  pending?: boolean;
  streaming?: boolean;
};

type VoiceMode = "idle" | "recording" | "playing" | "realtime";

const createTempId = (): string =>
  `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const nowIso = (): string => new Date().toISOString();

const headersForDevice = (deviceId: string): HeadersInit => ({
  "Content-Type": "application/json",
  "x-device-id": deviceId,
});

const parseSseChunk = (raw: string): { event: string; data: Record<string, unknown> }[] => {
  return raw
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));
      const event = eventLine?.replace("event: ", "").trim() ?? "message";
      const rawData = dataLine?.replace("data: ", "").trim() ?? "{}";
      try {
        return { event, data: JSON.parse(rawData) as Record<string, unknown> };
      } catch {
        return { event, data: {} };
      }
    });
};

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const suggestedPromptsForPersona = (personaId: string): string[] =>
  PERSONAS.find((persona) => persona.id === personaId)?.suggestedPrompts ??
  PERSONAS[0].suggestedPrompts;

const toUint8 = (base64: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(normalized);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i);
  return bytes;
};

const imageFromMessage = (message: UiMessage): string | null => {
  if (message.format !== "image") return null;
  const attachments = Array.isArray(message.metadata?.attachments)
    ? (message.metadata.attachments as Attachment[])
    : [];
  return attachments[0]?.url ?? null;
};

export function ChatApp() {
  const [deviceId, setDeviceId] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [translated, setTranslated] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Loading...");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("idle");
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);
  const [personaId, setPersonaId] = useState<PersonaId>("default");
  const [preferredLanguage, setPreferredLanguage] = useState("en");
  const [ttsAutoplay, setTtsAutoplay] = useState(false);
  const [ttsVoice, setTtsVoice] = useState("alloy");
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDueAt, setNewTaskDueAt] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const realtimePcRef = useRef<RTCPeerConnection | null>(null);
  const realtimeStreamRef = useRef<MediaStream | null>(null);
  const realtimeAudioRef = useRef<HTMLAudioElement | null>(null);
  const realtimeDataChannelRef = useRef<RTCDataChannel | null>(null);

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );

  const persistLocalSnapshot = useCallback(
    (nextSessions: ChatSession[], nextMessages: UiMessage[], sessionId: string) => {
      const cache = readLocalCache();
      cache.sessions = nextSessions;
      cache.messagesBySession[sessionId] = nextMessages.map((item) => ({
        id: item.id,
        sessionId: item.sessionId,
        userId: item.userId,
        role: item.role,
        content: item.content,
        format: item.format,
        metadata: item.metadata,
        editedAt: item.editedAt,
        editedFromMessageId: item.editedFromMessageId,
        regenerationRootId: item.regenerationRootId,
        createdAt: item.createdAt,
        audioUrl: item.audioUrl,
      }));
      writeLocalCache(cache);
    },
    []
  );

  const loadSidebarData = useCallback(async (idForHeaders: string) => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const [tasksResp, notificationsResp, briefingResp] = await Promise.allSettled([
      fetch("/api/tasks", { headers: { "x-device-id": idForHeaders } }),
      fetch("/api/notifications", { headers: { "x-device-id": idForHeaders } }),
      fetch(`/api/briefings/today?timezone=${encodeURIComponent(timezone)}`, {
        headers: { "x-device-id": idForHeaders },
      }),
    ]);

    if (tasksResp.status === "fulfilled" && tasksResp.value.ok) {
      const data = (await tasksResp.value.json()) as { tasks: Task[] };
      setTasks(data.tasks ?? []);
    }
    if (notificationsResp.status === "fulfilled" && notificationsResp.value.ok) {
      const data = (await notificationsResp.value.json()) as {
        notifications: NotificationItem[];
      };
      setNotifications(data.notifications ?? []);
    }
    if (briefingResp.status === "fulfilled" && briefingResp.value.ok) {
      const data = (await briefingResp.value.json()) as { briefing: Briefing | null };
      setBriefing(data.briefing ?? null);
    }
  }, []);

  const loadMessages = useCallback(
    async (sessionId: string, idForHeaders: string) => {
      try {
        const [messagesResp, savedResp] = await Promise.all([
          fetch(`/api/sessions/${sessionId}/messages`, {
            headers: { "x-device-id": idForHeaders },
          }),
          fetch(`/api/saved-messages?sessionId=${encodeURIComponent(sessionId)}`, {
            headers: { "x-device-id": idForHeaders },
          }),
        ]);
        if (!messagesResp.ok) throw new Error("Message fetch failed");
        const data = (await messagesResp.json()) as { messages: UiMessage[] };
        const savedData = savedResp.ok
          ? ((await savedResp.json()) as { saved: { messageId: string }[] })
          : { saved: [] };
        setSavedIds(new Set((savedData.saved ?? []).map((entry) => entry.messageId)));
        setMessages(data.messages);
        persistLocalSnapshot(sessions, data.messages, sessionId);
      } catch {
        const cache = readLocalCache();
        setMessages(cache.messagesBySession[sessionId] ?? []);
      }
    },
    [persistLocalSnapshot, sessions]
  );

  const loadSessions = useCallback(
    async (idForHeaders: string, query = sessionQuery, onlySaved = savedOnly) => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      if (onlySaved) params.set("savedOnly", "1");
      const path = `/api/sessions${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(path, { headers: { "x-device-id": idForHeaders } });
      if (!response.ok) throw new Error("Session fetch failed");
      const data = (await response.json()) as { sessions: ChatSession[] };
      setSessions(data.sessions);
      if (!activeSessionId && data.sessions[0]) {
        setActiveSessionId(data.sessions[0].id);
        await loadMessages(data.sessions[0].id, idForHeaders);
      }
      setStatus("Ready");
    },
    [activeSessionId, loadMessages, savedOnly, sessionQuery]
  );

  const createSession = useCallback(
    async (idForHeaders: string): Promise<ChatSession> => {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: headersForDevice(idForHeaders),
        body: JSON.stringify({
          title: "New conversation",
          mode: "text",
          personaId,
          preferredLanguage,
        }),
      });
      if (!response.ok) throw new Error("Failed to create session");
      const data = (await response.json()) as { session: ChatSession };
      setSessions((prev) => [data.session, ...prev]);
      setActiveSessionId(data.session.id);
      setMessages([]);
      return data.session;
    },
    [personaId, preferredLanguage]
  );

  const playTts = useCallback(
    async (input: string) => {
      try {
        setVoiceMode("playing");
        const response = await fetch("/api/voice/synthesize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input, voice: ttsVoice }),
        });
        if (!response.ok) throw new Error("TTS failed");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        await audio.play();
        audio.onended = () => {
          URL.revokeObjectURL(url);
          setVoiceMode("idle");
        };
      } catch {
        setVoiceMode("idle");
      }
    },
    [ttsVoice]
  );

  const streamReply = useCallback(
    async ({ sessionId, userContent }: { sessionId: string; userContent: string }) => {
      const streamMessageId = createTempId();
      setMessages((prev) => [
        ...prev,
        {
          id: streamMessageId,
          sessionId,
          userId: "assistant",
          role: "assistant",
          content: "",
          format: "markdown",
          metadata: {},
          editedAt: null,
          editedFromMessageId: null,
          regenerationRootId: null,
          createdAt: nowIso(),
          audioUrl: null,
          streaming: true,
        },
      ]);

      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: headersForDevice(deviceId),
        body: JSON.stringify({
          sessionId,
          message: userContent,
          personaId,
          preferredLanguage,
        }),
      });
      if (!response.ok || !response.body) throw new Error("Streaming request failed");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const events = parseSseChunk(frame);
          for (const event of events) {
            if (event.event === "delta") {
              const text = String(event.data.text ?? "");
              finalText += text;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === streamMessageId
                    ? { ...msg, content: `${msg.content}${text}` }
                    : msg
                )
              );
            }
            if (event.event === "done") {
              const assistant = event.data.assistantMessage as UiMessage | undefined;
              if (assistant) {
                finalText = assistant.content;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === streamMessageId
                      ? { ...assistant, streaming: false }
                      : msg
                  )
                );
              } else {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === streamMessageId ? { ...msg, streaming: false } : msg
                  )
                );
              }
            }
          }
        }
      }

      if (ttsAutoplay && finalText.trim()) await playTts(finalText);
    },
    [deviceId, personaId, playTts, preferredLanguage, ttsAutoplay]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || sending || !deviceId) return;
      setSending(true);
      setStatus(navigator.onLine ? "Thinking..." : "Offline - queued");
      const text = content.trim();
      try {
        const sessionId = activeSessionId || (await createSession(deviceId)).id;
        setMessages((prev) => [
          ...prev,
          {
            id: createTempId(),
            sessionId,
            userId: `guest:${deviceId}`,
            role: "user",
            content: text,
            format: "text",
            metadata: { language: preferredLanguage, personaId },
            editedAt: null,
            editedFromMessageId: null,
            regenerationRootId: null,
            createdAt: nowIso(),
            audioUrl: null,
            pending: !navigator.onLine,
          },
        ]);
        if (!navigator.onLine) {
          enqueueOutbox({ sessionId, content: text });
          return;
        }
        await streamReply({ sessionId, userContent: text });
        await loadSessions(deviceId);
        await loadMessages(sessionId, deviceId);
      } catch {
        if (activeSessionId) enqueueOutbox({ sessionId: activeSessionId, content: text });
        setStatus("Network issue - queued");
      } finally {
        setSending(false);
      }
    },
    [activeSessionId, createSession, deviceId, loadMessages, loadSessions, personaId, preferredLanguage, sending, streamReply]
  );

  const flushOutbox = useCallback(async () => {
    if (!navigator.onLine || !deviceId) return;
    const items = readOutbox();
    for (const item of items) {
      try {
        await streamReply({ sessionId: item.sessionId, userContent: item.content });
        removeOutboxItem(item.id);
      } catch {
        break;
      }
    }
  }, [deviceId, streamReply]);

  const transcribeAudio = useCallback(async (blob: Blob): Promise<string> => {
    const form = new FormData();
    form.append("audio", blob, "voice.webm");
    const response = await fetch("/api/voice/transcribe", { method: "POST", body: form });
    if (!response.ok) throw new Error("Transcription failed");
    const data = (await response.json()) as { text: string };
    return data.text;
  }, []);

  const startHoldToTalk = useCallback(async () => {
    if (realtimeEnabled || voiceMode === "recording") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recordChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordChunksRef.current.push(event.data);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setVoiceMode("recording");
    } catch {
      setStatus("Microphone unavailable");
    }
  }, [realtimeEnabled, voiceMode]);

  const stopHoldToTalk = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    recorder.stop();
    mediaRecorderRef.current = null;
    setVoiceMode("idle");
    const blob = await new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const done = new Blob(recordChunksRef.current, { type: "audio/webm" });
        recorder.stream.getTracks().forEach((track) => track.stop());
        resolve(done.size ? done : null);
      };
    });
    if (!blob) return;
    try {
      const text = await transcribeAudio(blob);
      if (text.trim()) {
        setDraft(text);
        await sendMessage(text);
      }
    } catch {
      setStatus("Voice transcription failed");
    }
  }, [sendMessage, transcribeAudio]);

  const stopRealtime = useCallback(() => {
    realtimeDataChannelRef.current?.close();
    realtimePcRef.current?.close();
    realtimeStreamRef.current?.getTracks().forEach((track) => track.stop());
    realtimeDataChannelRef.current = null;
    realtimePcRef.current = null;
    realtimeStreamRef.current = null;
    setRealtimeEnabled(false);
    setVoiceMode("idle");
  }, []);

  const startRealtime = useCallback(async () => {
    if (realtimeEnabled) return;
    try {
      const tokenResp = await fetch("/api/realtime/session", { method: "POST" });
      if (!tokenResp.ok) throw new Error("Token request failed");
      const tokenData = (await tokenResp.json()) as {
        model?: string;
        client_secret?: { value?: string };
      };
      const ephemeralKey = tokenData.client_secret?.value;
      const model = tokenData.model ?? "gpt-4o-realtime-preview";
      if (!ephemeralKey) throw new Error("Missing ephemeral key");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const pc = new RTCPeerConnection();
      const dc = pc.createDataChannel("oai-events");
      realtimeDataChannelRef.current = dc;
      realtimePcRef.current = pc;
      realtimeStreamRef.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const remoteAudio = new Audio();
      remoteAudio.autoplay = true;
      pc.ontrack = (event) => {
        remoteAudio.srcObject = event.streams[0];
      };
      realtimeAudioRef.current = remoteAudio;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
        }
      );
      if (!sdpResponse.ok) throw new Error("Realtime negotiation failed");
      const answer = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      setRealtimeEnabled(true);
      setVoiceMode("realtime");
    } catch {
      stopRealtime();
    }
  }, [realtimeEnabled, stopRealtime]);

  const toggleBookmark = useCallback(
    async (messageId: string) => {
      const isSaved = savedIds.has(messageId);
      const method = isSaved ? "DELETE" : "POST";
      const response = await fetch(`/api/messages/${messageId}/bookmark`, {
        method,
        headers: method === "POST" ? headersForDevice(deviceId) : { "x-device-id": deviceId },
        body: method === "POST" ? JSON.stringify({ sessionId: activeSessionId }) : undefined,
      });
      if (!response.ok) return;
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (isSaved) next.delete(messageId);
        else next.add(messageId);
        return next;
      });
    },
    [activeSessionId, deviceId, savedIds]
  );

  const reactToMessage = useCallback(
    async (messageId: string, value: "up" | "down") => {
      await fetch(`/api/messages/${messageId}/reaction`, {
        method: "POST",
        headers: headersForDevice(deviceId),
        body: JSON.stringify({ value }),
      });
    },
    [deviceId]
  );

  const translateMessage = useCallback(
    async (messageId: string) => {
      const targetLanguage = window.prompt("Translate to language code:", "en");
      if (!targetLanguage) return;
      const response = await fetch(`/api/messages/${messageId}/translate`, {
        method: "POST",
        headers: headersForDevice(deviceId),
        body: JSON.stringify({ targetLanguage }),
      });
      if (!response.ok) return;
      const data = (await response.json()) as { translation?: { translatedText: string } };
      if (!data.translation) return;
      setTranslated((prev) => ({ ...prev, [messageId]: data.translation!.translatedText }));
    },
    [deviceId]
  );

  const editAndRegenerate = useCallback(
    async (message: UiMessage) => {
      const nextContent = window.prompt("Edit your message:", message.content)?.trim();
      if (!nextContent || nextContent === message.content) return;
      await fetch(`/api/messages/${message.id}`, {
        method: "PATCH",
        headers: headersForDevice(deviceId),
        body: JSON.stringify({ content: nextContent }),
      });
      await fetch(`/api/messages/${message.id}/regenerate`, {
        method: "POST",
        headers: headersForDevice(deviceId),
        body: JSON.stringify({}),
      });
      await loadMessages(message.sessionId, deviceId);
      await loadSessions(deviceId);
    },
    [deviceId, loadMessages, loadSessions]
  );

  const exportSession = useCallback(
    async (format: "markdown" | "text", copyOnly = false) => {
      if (!activeSessionId) return;
      const response = await fetch(`/api/sessions/${activeSessionId}/export?format=${format}`, {
        headers: { "x-device-id": deviceId },
      });
      if (!response.ok) return;
      const content = await response.text();
      if (copyOnly) {
        await navigator.clipboard.writeText(content);
        setStatus("Copied export to clipboard");
        return;
      }
      const blob = new Blob([content], {
        type: format === "text" ? "text/plain" : "text/markdown",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `session-${activeSessionId}.${format === "text" ? "txt" : "md"}`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [activeSessionId, deviceId]
  );

  const uploadAndAnalyze = useCallback(
    async (file: File) => {
      if (!deviceId) return;
      const sessionId = activeSessionId || (await createSession(deviceId)).id;
      const form = new FormData();
      form.append("file", file);
      form.append("sessionId", sessionId);
      const uploadResp = await fetch("/api/files/upload", {
        method: "POST",
        headers: { "x-device-id": deviceId },
        body: form,
      });
      if (!uploadResp.ok) return;
      const uploadData = (await uploadResp.json()) as { attachment: Attachment };
      await fetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: headersForDevice(deviceId),
        body: JSON.stringify({
          role: "user",
          content: `Uploaded file: ${uploadData.attachment.name}`,
          format: "attachment",
          metadata: { attachments: [uploadData.attachment] },
        }),
      });
      const analysisResp = await fetch("/api/files/analyze", {
        method: "POST",
        headers: headersForDevice(deviceId),
        body: JSON.stringify({
          attachmentId: uploadData.attachment.id,
          question: draft.trim() || undefined,
        }),
      });
      if (analysisResp.ok) {
        const analysis = (await analysisResp.json()) as {
          analysis: string;
          citations?: { title: string; url: string; source?: string }[];
        };
        await fetch(`/api/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: headersForDevice(deviceId),
          body: JSON.stringify({
            role: "assistant",
            content: analysis.analysis,
            format: "markdown",
            metadata: {
              citations: analysis.citations ?? [],
              attachments: [uploadData.attachment],
            },
          }),
        });
      }
      await loadMessages(sessionId, deviceId);
      await loadSessions(deviceId);
    },
    [activeSessionId, createSession, deviceId, draft, loadMessages, loadSessions]
  );

  const generateImage = useCallback(async () => {
    if (!draft.trim() || !deviceId) return;
    const sessionId = activeSessionId || (await createSession(deviceId)).id;
    const response = await fetch("/api/images/generate", {
      method: "POST",
      headers: headersForDevice(deviceId),
      body: JSON.stringify({ sessionId, prompt: draft.trim() }),
    });
    if (response.ok) {
      await loadMessages(sessionId, deviceId);
      await loadSessions(deviceId);
      setDraft("");
    }
  }, [activeSessionId, createSession, deviceId, draft, loadMessages, loadSessions]);

  const saveRename = useCallback(async () => {
    if (!renamingSessionId || !renamingTitle.trim()) return;
    const response = await fetch(`/api/sessions/${renamingSessionId}`, {
      method: "PATCH",
      headers: headersForDevice(deviceId),
      body: JSON.stringify({ title: renamingTitle.trim(), isTitleCustom: true }),
    });
    if (response.ok) {
      await loadSessions(deviceId);
      setRenamingSessionId(null);
      setRenamingTitle("");
    }
  }, [deviceId, loadSessions, renamingSessionId, renamingTitle]);

  const createTaskFromUi = useCallback(async () => {
    if (!newTaskTitle.trim()) return;
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: headersForDevice(deviceId),
      body: JSON.stringify({
        title: newTaskTitle.trim(),
        dueAt: newTaskDueAt ? new Date(newTaskDueAt).toISOString() : null,
      }),
    });
    if (response.ok) {
      setNewTaskTitle("");
      setNewTaskDueAt("");
      await loadSidebarData(deviceId);
    }
  }, [deviceId, loadSidebarData, newTaskDueAt, newTaskTitle]);

  const generateBriefing = useCallback(async () => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const response = await fetch("/api/briefings/generate", {
      method: "POST",
      headers: headersForDevice(deviceId),
      body: JSON.stringify({ timezone, force: true }),
    });
    if (response.ok) await loadSidebarData(deviceId);
  }, [deviceId, loadSidebarData]);

  useEffect(() => {
    if (!activeSession) return;
    setPersonaId(activeSession.personaId ?? "default");
    setPreferredLanguage(activeSession.preferredLanguage ?? "en");
  }, [activeSession]);

  useEffect(() => {
    const id = getDeviceId();
    setDeviceId(id);
    void loadSessions(id).catch(() => setStatus("Offline mode"));
    void loadSidebarData(id);
  }, [loadSessions, loadSidebarData]);

  useEffect(() => {
    if (!deviceId) return;
    const timer = setTimeout(() => {
      void loadSessions(deviceId).catch(() => setStatus("Offline mode"));
    }, 260);
    return () => clearTimeout(timer);
  }, [deviceId, sessionQuery, savedOnly, loadSessions]);

  useEffect(() => {
    const onOnline = () => {
      setStatus("Back online - syncing queue");
      void flushOutbox().then(() => setStatus("Ready"));
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushOutbox]);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !deviceId) return;
    const vapid = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
    if (!vapid || Notification.permission !== "granted") return;
    void navigator.serviceWorker.ready.then(async (registration) => {
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toUint8(vapid) as unknown as BufferSource,
        }));
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: headersForDevice(deviceId),
        body: JSON.stringify(subscription.toJSON()),
      });
    });
  }, [deviceId]);

  const suggestedPrompts = useMemo(() => suggestedPromptsForPersona(personaId), [personaId]);

  return (
    <div className="app-shell">
      <aside className={`session-drawer ${sidebarOpen ? "open" : ""}`}>
        <div className="session-drawer-header">
          <h2>Sessions</h2>
          <button type="button" onClick={() => setSidebarOpen(false)}>
            Close
          </button>
        </div>
        <div className="drawer-search-row">
          <input
            value={sessionQuery}
            onChange={(event) => setSessionQuery(event.target.value)}
            placeholder="Search sessions..."
          />
          <label>
            <input
              type="checkbox"
              checked={savedOnly}
              onChange={(event) => setSavedOnly(event.target.checked)}
            />{" "}
            Saved
          </label>
        </div>
        <button
          type="button"
          className="new-session-btn"
          onClick={async () => {
            const created = await createSession(deviceId);
            await loadMessages(created.id, deviceId);
          }}
        >
          New chat
        </button>
        <div className="session-list">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={session.id === activeSessionId ? "session-item active" : "session-item"}
            >
              <button
                type="button"
                className="session-select"
                onClick={async () => {
                  setActiveSessionId(session.id);
                  await loadMessages(session.id, deviceId);
                  setSidebarOpen(false);
                }}
              >
                <span className="title">{session.title}</span>
                <span className="time">{formatTime(session.updatedAt)}</span>
              </button>
              <div className="session-row-actions">
                <button
                  type="button"
                  onClick={() => {
                    setRenamingSessionId(session.id);
                    setRenamingTitle(session.title);
                  }}
                >
                  Rename
                </button>
              </div>
              {renamingSessionId === session.id ? (
                <div className="rename-row">
                  <input
                    value={renamingTitle}
                    onChange={(event) => setRenamingTitle(event.target.value)}
                  />
                  <button type="button" onClick={() => void saveRename()}>
                    Save
                  </button>
                  <button type="button" onClick={() => setRenamingSessionId(null)}>
                    Cancel
                  </button>
                </div>
              ) : null}
              {session.summary ? <span className="session-summary">{session.summary}</span> : null}
            </div>
          ))}
        </div>

        <div className="drawer-side-section">
          <h3>Tasks</h3>
          <div className="task-create-row">
            <input
              placeholder="New task..."
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value)}
            />
            <input
              type="datetime-local"
              value={newTaskDueAt}
              onChange={(event) => setNewTaskDueAt(event.target.value)}
            />
            <button type="button" onClick={() => void createTaskFromUi()}>
              Add
            </button>
          </div>
          {tasks.slice(0, 6).map((task) => (
            <div key={task.id} className="task-item">
              <strong>{task.title}</strong>
              <span>{task.status}</span>
            </div>
          ))}
        </div>

        <div className="drawer-side-section">
          <h3>Notifications</h3>
          {notifications.slice(0, 5).map((item) => (
            <div key={item.id} className="notif-item">
              <strong>{item.title}</strong>
              <span>{item.body}</span>
            </div>
          ))}
        </div>
      </aside>

      <header className="top-bar">
        <button type="button" onClick={() => setSidebarOpen((prev) => !prev)}>
          Sessions
        </button>
        <div className="top-meta">
          <strong>{activeSession?.title ?? "Assistant"}</strong>
          <span>{status}</span>
        </div>
        <div className="top-actions">
          <button type="button" onClick={() => void exportSession("markdown")}>
            Export MD
          </button>
          <button type="button" onClick={() => void exportSession("text")}>
            Export TXT
          </button>
          <button type="button" onClick={() => void exportSession("markdown", true)}>
            Copy
          </button>
          <button
            type="button"
            className={realtimeEnabled ? "realtime on" : "realtime"}
            onClick={() => (realtimeEnabled ? stopRealtime() : void startRealtime())}
          >
            {realtimeEnabled ? "Live On" : "Live Off"}
          </button>
          <select
            value={personaId}
            onChange={async (event) => {
              const value = event.target.value as PersonaId;
              setPersonaId(value);
              if (activeSessionId) {
                await fetch(`/api/sessions/${activeSessionId}`, {
                  method: "PATCH",
                  headers: headersForDevice(deviceId),
                  body: JSON.stringify({ personaId: value }),
                });
              }
            }}
          >
            {PERSONAS.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.name}
              </option>
            ))}
          </select>
          <select
            value={preferredLanguage}
            onChange={async (event) => {
              const value = event.target.value;
              setPreferredLanguage(value);
              if (activeSessionId) {
                await fetch(`/api/sessions/${activeSessionId}`, {
                  method: "PATCH",
                  headers: headersForDevice(deviceId),
                  body: JSON.stringify({ preferredLanguage: value }),
                });
              }
            }}
          >
            <option value="en">EN</option>
            <option value="es">ES</option>
            <option value="fr">FR</option>
            <option value="de">DE</option>
            <option value="ar">AR</option>
          </select>
          <select value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)}>
            <option value="alloy">alloy</option>
            <option value="verse">verse</option>
            <option value="nova">nova</option>
          </select>
        </div>
      </header>

      <main className="message-list">
        {briefing ? (
          <section className="briefing-card">
            <div className="briefing-header">
              <h3>Daily Briefing</h3>
              <button type="button" onClick={() => void generateBriefing()}>
                Refresh
              </button>
            </div>
            <p>{briefing.content}</p>
          </section>
        ) : null}
        {messages.length === 0 ? (
          <div className="empty-state">
            <h1>Daily Assistant</h1>
            <p>Tap a suggestion to start.</p>
            <div className="prompt-chips">
              {suggestedPrompts.map((prompt) => (
                <button key={prompt} type="button" onClick={() => void sendMessage(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={message.role === "user" ? "bubble bubble-user" : "bubble bubble-assistant"}
            >
              {imageFromMessage(message) ? (
                <Image
                  src={imageFromMessage(message) ?? ""}
                  alt="Generated"
                  className="bubble-image"
                  width={1024}
                  height={1024}
                  unoptimized
                />
              ) : message.role === "assistant" ? (
                message.streaming && !message.content ? (
                  <div className="typing-indicator">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                    {message.content}
                  </ReactMarkdown>
                )
              ) : (
                <p>{message.content}</p>
              )}
              {translated[message.id] ? <div className="translation-box">{translated[message.id]}</div> : null}
              <div className="message-actions">
                {message.role === "assistant" ? (
                  <>
                    <button type="button" onClick={() => void toggleBookmark(message.id)}>
                      {savedIds.has(message.id) ? "Unstar" : "Star"}
                    </button>
                    <button type="button" onClick={() => void reactToMessage(message.id, "up")}>
                      Up
                    </button>
                    <button type="button" onClick={() => void reactToMessage(message.id, "down")}>
                      Down
                    </button>
                    <button type="button" onClick={() => void playTts(message.content)}>
                      Speak
                    </button>
                    <button type="button" onClick={() => void translateMessage(message.id)}>
                      Translate
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => void editAndRegenerate(message)}>
                    Edit + Regenerate
                  </button>
                )}
              </div>
              <time>
                {formatTime(message.createdAt)}
                {message.pending ? " - queued" : ""}
              </time>
            </article>
          ))
        )}
      </main>

      <footer className="composer">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadAndAnalyze(file);
            if (event.target) event.target.value = "";
          }}
        />
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Message your assistant..."
          rows={1}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              const text = draft.trim();
              setDraft("");
              void sendMessage(text);
            }
          }}
        />
        <button
          type="button"
          disabled={sending}
          onClick={() => {
            const text = draft.trim();
            setDraft("");
            void sendMessage(text);
          }}
        >
          Send
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Attach
        </button>
        <button type="button" onClick={() => void generateImage()}>
          Image
        </button>
        <button
          type="button"
          className={voiceMode === "recording" ? "mic recording" : "mic"}
          onPointerDown={() => void startHoldToTalk()}
          onPointerUp={() => void stopHoldToTalk()}
          onPointerLeave={() => void stopHoldToTalk()}
          disabled={sending || realtimeEnabled}
        >
          Mic
        </button>
        <button type="button" onClick={() => setTtsAutoplay((prev) => !prev)}>
          {ttsAutoplay ? "Auto TTS On" : "Auto TTS Off"}
        </button>
      </footer>
    </div>
  );
}

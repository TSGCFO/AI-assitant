"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChatMessage, ChatSession } from "@/lib/types";
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

const createTempId = (): string => `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const nowIso = (): string => new Date().toISOString();

const headersForDevice = (deviceId: string): HeadersInit => ({
  "Content-Type": "application/json",
  "x-device-id": deviceId,
});

const parseSseChunk = (
  raw: string
): { event: string; data: Record<string, unknown> | null }[] => {
  const frames = raw.split("\n\n").filter(Boolean);
  return frames.map((frame) => {
    const lines = frame.split("\n");
    const eventLine = lines.find((line) => line.startsWith("event: "));
    const dataLine = lines.find((line) => line.startsWith("data: "));
    const event = eventLine?.replace("event: ", "").trim() ?? "message";
    const dataRaw = dataLine?.replace("data: ", "").trim() ?? "null";
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(dataRaw) as Record<string, unknown>;
    } catch {
      data = null;
    }
    return { event, data };
  });
};

export function ChatApp() {
  const [deviceId, setDeviceId] = useState<string>("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState<string>("");
  const [status, setStatus] = useState<string>("Loading...");
  const [sending, setSending] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("idle");
  const [realtimeEnabled, setRealtimeEnabled] = useState<boolean>(false);

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
        createdAt: item.createdAt,
        audioUrl: item.audioUrl,
      }));
      writeLocalCache(cache);
    },
    []
  );

  const loadMessages = useCallback(
    async (sessionId: string, idForHeaders: string) => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/messages`, {
          headers: { "x-device-id": idForHeaders },
        });
        if (!response.ok) {
          throw new Error("Message fetch failed");
        }
        const data = (await response.json()) as { messages: UiMessage[] };
        setMessages(data.messages);
        persistLocalSnapshot(sessions, data.messages, sessionId);
      } catch {
        const cache = readLocalCache();
        setMessages(cache.messagesBySession[sessionId] ?? []);
      }
    },
    [persistLocalSnapshot, sessions]
  );

  const createSession = useCallback(
    async (idForHeaders: string) => {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: headersForDevice(idForHeaders),
        body: JSON.stringify({ title: "New conversation", mode: "text" }),
      });
      if (!response.ok) {
        throw new Error("Failed to create session");
      }
      const data = (await response.json()) as { session: ChatSession };
      setSessions((prev) => {
        const next = [data.session, ...prev];
        persistLocalSnapshot(next, [], data.session.id);
        return next;
      });
      setActiveSessionId(data.session.id);
      setMessages([]);
      return data.session;
    },
    [persistLocalSnapshot]
  );

  const loadSessions = useCallback(
    async (idForHeaders: string) => {
      try {
        const response = await fetch("/api/sessions", {
          headers: { "x-device-id": idForHeaders },
        });
        if (!response.ok) {
          throw new Error("Session fetch failed");
        }
        const data = (await response.json()) as { sessions: ChatSession[] };
        setSessions(data.sessions);
        setStatus("Ready");
        if (data.sessions.length === 0) {
          await createSession(idForHeaders);
          return;
        }
        const sessionId = data.sessions[0].id;
        setActiveSessionId(sessionId);
        await loadMessages(sessionId, idForHeaders);
      } catch {
        const cache = readLocalCache();
        setSessions(cache.sessions);
        if (cache.sessions[0]) {
          setActiveSessionId(cache.sessions[0].id);
          setMessages(cache.messagesBySession[cache.sessions[0].id] ?? []);
        }
        setStatus("Offline mode");
      }
    },
    [createSession, loadMessages]
  );

  const playTts = useCallback(async (input: string) => {
    try {
      setVoiceMode("playing");
      const response = await fetch("/api/voice/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      if (!response.ok) {
        throw new Error("TTS failed");
      }
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
  }, []);

  const streamReply = useCallback(
    async ({
      sessionId,
      userContent,
      idForHeaders,
      shouldPlayTts,
    }: {
      sessionId: string;
      userContent: string;
      idForHeaders: string;
      shouldPlayTts: boolean;
    }) => {
      const streamMessageId = createTempId();
      setMessages((prev) => [
        ...prev,
        {
          id: streamMessageId,
          sessionId,
          userId: "assistant",
          role: "assistant",
          content: "",
          createdAt: nowIso(),
          audioUrl: null,
          streaming: true,
        },
      ]);

      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: headersForDevice(idForHeaders),
        body: JSON.stringify({ sessionId, message: userContent }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Streaming request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        const frameParts = buffer.split("\n\n");
        buffer = frameParts.pop() ?? "";

        for (const frame of frameParts) {
          const events = parseSseChunk(frame);
          for (const event of events) {
            if (event.event === "delta") {
              const text = String(event.data?.text ?? "");
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
              const assistant = event.data?.assistantMessage as UiMessage | undefined;
              if (assistant) {
                finalText = assistant.content;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === streamMessageId
                      ? { ...assistant, pending: false, streaming: false }
                      : msg
                  )
                );
              } else {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === streamMessageId
                      ? { ...msg, streaming: false, pending: false }
                      : msg
                  )
                );
              }
            }
          }
        }
      }

      if (shouldPlayTts && finalText.trim()) {
        await playTts(finalText);
      }
    },
    [playTts]
  );

  const sendMessage = useCallback(
    async (content: string, shouldPlayTts = false) => {
      if (!content.trim() || sending || !deviceId) {
        return;
      }

      setSending(true);
      setStatus(navigator.onLine ? "Thinking..." : "Offline - queued");

      const userMessage: UiMessage = {
        id: createTempId(),
        sessionId: activeSessionId,
        userId: `guest:${deviceId}`,
        role: "user",
        content: content.trim(),
        createdAt: nowIso(),
        audioUrl: null,
        pending: !navigator.onLine,
      };

      const ensureSessionId = async (): Promise<string> => {
        if (activeSessionId) {
          return activeSessionId;
        }
        const created = await createSession(deviceId);
        return created.id;
      };

      try {
        const sessionId = await ensureSessionId();
        setMessages((prev) => {
          const next = [...prev, { ...userMessage, sessionId }];
          persistLocalSnapshot(sessions, next, sessionId);
          return next;
        });

        if (!navigator.onLine) {
          enqueueOutbox({ sessionId, content: content.trim() });
          setSending(false);
          return;
        }

        await streamReply({
          sessionId,
          userContent: content.trim(),
          idForHeaders: deviceId,
          shouldPlayTts,
        });

        setStatus("Ready");
      } catch {
        if (activeSessionId) {
          enqueueOutbox({
            sessionId: activeSessionId,
            content: content.trim(),
          });
        }
        setStatus("Network issue - queued");
      } finally {
        setSending(false);
      }
    },
    [
      activeSessionId,
      createSession,
      deviceId,
      persistLocalSnapshot,
      sending,
      sessions,
      streamReply,
    ]
  );

  const flushOutbox = useCallback(async () => {
    if (!navigator.onLine || !deviceId) {
      return;
    }

    const items = readOutbox();
    for (const item of items) {
      try {
        await streamReply({
          sessionId: item.sessionId,
          userContent: item.content,
          idForHeaders: deviceId,
          shouldPlayTts: false,
        });
        removeOutboxItem(item.id);
      } catch {
        break;
      }
    }
  }, [deviceId, streamReply]);

  const transcribeAudio = useCallback(async (blob: Blob): Promise<string> => {
    const form = new FormData();
    form.append("audio", blob, "voice.webm");
    const response = await fetch("/api/voice/transcribe", {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      throw new Error("Transcription failed");
    }
    const data = (await response.json()) as { text: string };
    return data.text;
  }, []);

  const startHoldToTalk = useCallback(async () => {
    if (realtimeEnabled || voiceMode === "recording") {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recordChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordChunksRef.current.push(event.data);
        }
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
    if (!recorder) {
      return;
    }

    recorder.stop();
    mediaRecorderRef.current = null;
    setVoiceMode("idle");

    const done = await new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(recordChunksRef.current, { type: "audio/webm" });
        recorder.stream.getTracks().forEach((track) => track.stop());
        resolve(blob.size ? blob : null);
      };
    });

    if (!done) {
      return;
    }

    try {
      setStatus("Transcribing...");
      const text = await transcribeAudio(done);
      if (text.trim()) {
        setDraft(text);
        await sendMessage(text, true);
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
    setStatus("Realtime voice disconnected");
  }, []);

  const startRealtime = useCallback(async () => {
    if (realtimeEnabled) {
      return;
    }
    try {
      setStatus("Starting realtime voice...");
      const tokenResp = await fetch("/api/realtime/session", { method: "POST" });
      if (!tokenResp.ok) {
        throw new Error("Token request failed");
      }
      const tokenData = (await tokenResp.json()) as {
        model?: string;
        client_secret?: { value?: string };
      };
      const ephemeralKey = tokenData.client_secret?.value;
      const model = tokenData.model ?? "gpt-4o-realtime-preview";
      if (!ephemeralKey) {
        throw new Error("Missing ephemeral key");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const pc = new RTCPeerConnection();
      const dc = pc.createDataChannel("oai-events");
      dc.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type?: string; delta?: string };
          if (payload.type === "response.text.delta" && payload.delta) {
            setStatus(`Live: ${payload.delta}`);
          }
        } catch {
          // noop
        }
      };

      realtimeDataChannelRef.current = dc;
      realtimePcRef.current = pc;
      realtimeStreamRef.current = stream;

      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

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

      if (!sdpResponse.ok) {
        throw new Error("Realtime SDP negotiation failed");
      }

      const answer = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      setRealtimeEnabled(true);
      setVoiceMode("realtime");
      setStatus("Realtime voice connected");
    } catch {
      stopRealtime();
      setStatus("Realtime voice unavailable, use hold-to-talk fallback.");
    }
  }, [realtimeEnabled, stopRealtime]);

  useEffect(() => {
    const id = getDeviceId();
    setDeviceId(id);
    void loadSessions(id);
  }, [loadSessions]);

  useEffect(() => {
    const onOnline = () => {
      setStatus("Back online - syncing queue");
      void flushOutbox().then(() => setStatus("Ready"));
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushOutbox]);

  const handleSubmit = async () => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    setDraft("");
    await sendMessage(text, false);
  };

  return (
    <div className="app-shell">
      <aside className={`session-drawer ${sidebarOpen ? "open" : ""}`}>
        <div className="session-drawer-header">
          <h2>Sessions</h2>
          <button type="button" onClick={() => setSidebarOpen(false)}>
            Close
          </button>
        </div>
        <button
          type="button"
          className="new-session-btn"
          onClick={async () => {
            const created = await createSession(deviceId);
            setSidebarOpen(false);
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
                  setSidebarOpen(false);
                  await loadMessages(session.id, deviceId);
                }}
              >
                <span className="title">{session.title}</span>
                <span className="time">
                  {new Date(session.updatedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </button>
              <button
                type="button"
                className="session-delete"
                onClick={async () => {
                  await fetch(`/api/sessions/${session.id}`, {
                    method: "DELETE",
                    headers: { "x-device-id": deviceId },
                  });
                  const nextSessions = sessions.filter((item) => item.id !== session.id);
                  setSessions(nextSessions);
                  const cache = readLocalCache();
                  cache.sessions = nextSessions;
                  delete cache.messagesBySession[session.id];
                  writeLocalCache(cache);

                  if (activeSessionId === session.id) {
                    if (nextSessions[0]) {
                      setActiveSessionId(nextSessions[0].id);
                      await loadMessages(nextSessions[0].id, deviceId);
                    } else {
                      const created = await createSession(deviceId);
                      await loadMessages(created.id, deviceId);
                    }
                  }
                }}
              >
                Del
              </button>
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
        <button
          type="button"
          className={realtimeEnabled ? "realtime on" : "realtime"}
          onClick={() => {
            if (realtimeEnabled) {
              stopRealtime();
            } else {
              void startRealtime();
            }
          }}
        >
          {realtimeEnabled ? "Live On" : "Live Off"}
        </button>
      </header>

      <main className="message-list">
        {messages.length === 0 ? (
          <div className="empty-state">
            <h1>Daily Assistant</h1>
            <p>Ask by text or hold the mic for voice input.</p>
          </div>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={
                message.role === "user" ? "bubble bubble-user" : "bubble bubble-assistant"
              }
            >
              <p>{message.content || (message.streaming ? "..." : "")}</p>
              <time>
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {message.pending ? " - queued" : ""}
              </time>
            </article>
          ))
        )}
      </main>

      <footer className="composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Message your assistant..."
          rows={1}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSubmit();
            }
          }}
        />
        <button type="button" disabled={sending} onClick={() => void handleSubmit()}>
          Send
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
      </footer>
    </div>
  );
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { buildRollingSummary, buildSystemPrompt } from "@/lib/prompts";
import { env } from "@/lib/env";
import { DEFAULT_LANGUAGE, DEFAULT_PERSONA_ID } from "@/lib/personas";
import { parseReminderIntent, detectLanguageCode, extractCitationsFromResponse, needsWebSearch } from "@/lib/server/chat-utils";
import { hasOpenAiKey, getOpenAiClient } from "@/lib/server/openai";
import { persistSemanticMemory, retrieveContext } from "@/lib/server/memory";
import { resolveIdentity } from "@/lib/server/identity";
import {
  addMessage,
  addMessageCitations,
  createReminder,
  createTask,
  getMessages,
  getSearchCache,
  getSessionById,
  getWorkingMemory,
  refreshSessionSummary,
  saveSearchCache,
  trackProductEvent,
  updateSession,
  upsertWorkingMemory,
} from "@/lib/server/repository";
import type { ChatMessage } from "@/lib/types";

const bodySchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  personaId: z
    .enum(["default", "creative-writer", "code-helper", "fitness-coach", "tutor"])
    .optional(),
  preferredLanguage: z.string().min(2).max(16).optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        url: z.string().url().optional(),
        name: z.string().optional(),
      })
    )
    .optional(),
});

const sseHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

const encodeEvent = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const shouldUseCachedSearch = (createdAt: string): boolean => {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs < env.webSearchCacheMinutes * 60 * 1000;
};

export async function POST(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const body = bodySchema.parse(await req.json());

    const session = await getSessionById({ userId, sessionId: body.sessionId });
    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const personaId = body.personaId ?? session.personaId ?? DEFAULT_PERSONA_ID;
    const inferredLanguage = detectLanguageCode(body.message);
    const preferredLanguage =
      body.preferredLanguage ?? session.preferredLanguage ?? inferredLanguage ?? DEFAULT_LANGUAGE;

    if (session.personaId !== personaId || session.preferredLanguage !== preferredLanguage) {
      await updateSession({
        userId,
        sessionId: session.id,
        personaId,
        preferredLanguage,
      });
    }

    const reminderIntent = parseReminderIntent(body.message);
    let reminderNotice: string | null = null;
    if (reminderIntent) {
      const task = await createTask({
        userId,
        title: reminderIntent.title,
        dueAt: reminderIntent.dueAtIso,
      });
      if (reminderIntent.dueAtIso) {
        await createReminder({
          userId,
          taskId: task.id,
          text: reminderIntent.title,
          dueAt: reminderIntent.dueAtIso,
        });
        reminderNotice = `Created reminder for "${task.title}" at ${new Date(reminderIntent.dueAtIso).toLocaleString()}.`;
      } else {
        reminderNotice = `Created task "${task.title}". Add a due date in Tasks if needed.`;
      }
    }

    const userMessage = await addMessage({
      userId,
      sessionId: body.sessionId,
      role: "user",
      content: body.message,
      format: "text",
      metadata: {
        language: preferredLanguage,
        personaId,
        attachments: body.attachments ?? [],
      },
    });

    await persistSemanticMemory({
      userId,
      sessionId: body.sessionId,
      messageId: userMessage.id,
      content: userMessage.content,
    });

    const history = await getMessages({ userId, sessionId: body.sessionId });
    const recentMessages = history.slice(-16);
    const retrievedContext = await retrieveContext({
      userId,
      query: body.message,
      limit: 6,
    });
    const workingMemory = await getWorkingMemory({
      userId,
      sessionId: body.sessionId,
    });
    const rollingSummary = workingMemory?.rollingSummary ?? buildRollingSummary(history);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const write = (event: string, data: unknown): void => {
          controller.enqueue(encoder.encode(encodeEvent(event, data)));
        };

        write("ready", { ok: true });

        if (!hasOpenAiKey()) {
          const fallback =
            "OPENAI_API_KEY is not configured yet. I saved your message and will answer once the key is set.";
          write("delta", { text: fallback });
          const assistantMessage = await addMessage({
            userId,
            sessionId: body.sessionId,
            role: "assistant",
            content: fallback,
            format: "markdown",
            metadata: {
              language: preferredLanguage,
              personaId,
            },
          });
          await persistSemanticMemory({
            userId,
            sessionId: body.sessionId,
            messageId: assistantMessage.id,
            content: assistantMessage.content,
          });
          await upsertWorkingMemory({
            userId,
            sessionId: body.sessionId,
            rollingSummary: buildRollingSummary([...history, assistantMessage]),
            activeEntities: [],
          });
          await refreshSessionSummary({ userId, sessionId: body.sessionId });
          write("done", { assistantMessage, citations: [] });
          controller.close();
          return;
        }

        const systemPrompt = buildSystemPrompt({
          workingMemory: rollingSummary,
          retrievedContext,
          personaId,
          preferredLanguage,
          includeWebSearch: needsWebSearch(body.message),
        });
        const inputMessages = recentMessages.map((message) => ({
          role: message.role,
          content: message.content,
        }));

        let assistantText = "";
        let citations: Awaited<ReturnType<typeof extractCitationsFromResponse>> = [];
        const useWebSearch = needsWebSearch(body.message);

        try {
          const openai = getOpenAiClient();
          if (useWebSearch) {
            const cache = await getSearchCache({ query: body.message });
            if (cache && shouldUseCachedSearch(cache.createdAt)) {
              assistantText = cache.answer;
              citations = cache.citations;
            } else {
              const response = await openai.responses.create({
                model: env.openaiChatModel,
                input: [{ role: "system", content: systemPrompt }, ...inputMessages],
                tools: [{ type: "web_search_preview" as const }],
              });
              assistantText = response.output_text?.trim() || "I could not complete a web-backed answer.";
              citations = extractCitationsFromResponse(response as { output?: unknown[] });
              await saveSearchCache({
                query: body.message,
                answer: assistantText,
                citations,
              });
            }

            const parts = assistantText.split(/(\s+)/).filter(Boolean);
            for (const part of parts) {
              write("delta", { text: part });
              await new Promise((resolve) => setTimeout(resolve, 8));
            }
          } else {
            const responseStream = await openai.responses.stream({
              model: env.openaiChatModel,
              input: [{ role: "system", content: systemPrompt }, ...inputMessages],
            });

            for await (const event of responseStream) {
              if (event.type === "response.output_text.delta") {
                const text = event.delta ?? "";
                assistantText += text;
                write("delta", { text });
              }
            }
            await responseStream.done();
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "OpenAI streaming failure";
          write("error", { message });
          controller.close();
          return;
        }

        const finalText =
          (reminderNotice ? `${reminderNotice}\n\n` : "") +
          (assistantText.trim() || "I could not generate a response this turn.");

        const assistantMessage: ChatMessage = await addMessage({
          userId,
          sessionId: body.sessionId,
          role: "assistant",
          content: finalText,
          format: "markdown",
          metadata: {
            language: preferredLanguage,
            personaId,
            citations,
            toolsUsed: useWebSearch ? ["web_search"] : [],
            searchQuery: useWebSearch ? body.message : undefined,
          },
        });

        if (citations.length > 0) {
          await addMessageCitations({
            userId,
            messageId: assistantMessage.id,
            citations,
          });
        }

        await persistSemanticMemory({
          userId,
          sessionId: body.sessionId,
          messageId: assistantMessage.id,
          content: assistantMessage.content,
        });

        await upsertWorkingMemory({
          userId,
          sessionId: body.sessionId,
          rollingSummary: buildRollingSummary([...history, assistantMessage]),
          activeEntities: [],
        });
        await refreshSessionSummary({ userId, sessionId: body.sessionId });
        await trackProductEvent({
          userId,
          eventType: "chat_response",
          payload: {
            sessionId: body.sessionId,
            usedWebSearch: useWebSearch,
            citationCount: citations.length,
            personaId,
            preferredLanguage,
          },
        });

        write("done", {
          assistantMessage,
          citations,
          reminderNotice,
        });
        controller.close();
      },
    });

    return new Response(stream, { headers: sseHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

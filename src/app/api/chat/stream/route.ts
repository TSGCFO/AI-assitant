import { NextResponse } from "next/server";
import { z } from "zod";

import { buildRollingSummary, buildSystemPrompt } from "@/lib/prompts";
import { hasOpenAiKey, getOpenAiClient } from "@/lib/server/openai";
import { persistSemanticMemory, retrieveContext } from "@/lib/server/memory";
import { resolveIdentity } from "@/lib/server/identity";
import {
  addMessage,
  getMessages,
  getWorkingMemory,
  upsertWorkingMemory,
} from "@/lib/server/repository";
import { env } from "@/lib/env";
import type { ChatMessage } from "@/lib/types";

const bodySchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
});

const sseHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

const encodeEvent = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export async function POST(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const body = bodySchema.parse(await req.json());

    const userMessage = await addMessage({
      userId,
      sessionId: body.sessionId,
      role: "user",
      content: body.message,
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
    const rollingSummary =
      workingMemory?.rollingSummary ?? buildRollingSummary(history);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const write = (event: string, data: unknown): void => {
          controller.enqueue(encoder.encode(encodeEvent(event, data)));
        };

        write("ready", { ok: true });

        if (!hasOpenAiKey()) {
          const fallback =
            "OPENAI_API_KEY is not configured yet. I stored your message and memory, and once the key is set I can stream live model responses.";
          write("delta", { text: fallback });
          const assistantMessage = await addMessage({
            userId,
            sessionId: body.sessionId,
            role: "assistant",
            content: fallback,
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
          write("done", { assistantMessage });
          controller.close();
          return;
        }

        const systemPrompt = buildSystemPrompt({
          workingMemory: rollingSummary,
          retrievedContext,
        });

        const inputMessages = recentMessages.map((message) => ({
          role: message.role,
          content: message.content,
        }));

        let assistantText = "";

        try {
          const openai = getOpenAiClient();
          const responseStream = await openai.responses.stream({
            model: env.openaiChatModel,
            input: [
              { role: "system", content: systemPrompt },
              ...inputMessages,
            ],
          });

          for await (const event of responseStream) {
            if (event.type === "response.output_text.delta") {
              const text = event.delta ?? "";
              assistantText += text;
              write("delta", { text });
            }
          }

          await responseStream.done();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "OpenAI streaming failure";
          write("error", { message });
          controller.close();
          return;
        }

        const finalAssistantText =
          assistantText.trim() || "I could not generate a response this turn.";

        const assistantMessage: ChatMessage = await addMessage({
          userId,
          sessionId: body.sessionId,
          role: "assistant",
          content: finalAssistantText,
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

        write("done", { assistantMessage });
        controller.close();
      },
    });

    return new Response(stream, { headers: sseHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

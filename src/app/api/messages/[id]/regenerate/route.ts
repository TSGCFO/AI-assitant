import { NextResponse } from "next/server";
import { z } from "zod";

import { buildRollingSummary, buildSystemPrompt } from "@/lib/prompts";
import { env } from "@/lib/env";
import { DEFAULT_LANGUAGE, DEFAULT_PERSONA_ID } from "@/lib/personas";
import { extractCitationsFromResponse, needsWebSearch } from "@/lib/server/chat-utils";
import { persistSemanticMemory, retrieveContext } from "@/lib/server/memory";
import { getOpenAiClient, hasOpenAiKey } from "@/lib/server/openai";
import { resolveIdentity } from "@/lib/server/identity";
import {
  addMessage,
  addMessageCitations,
  deleteMessagesAfter,
  getMessages,
  getMessageById,
  getSessionById,
  getWorkingMemory,
  refreshSessionSummary,
  updateMessage,
  upsertWorkingMemory,
} from "@/lib/server/repository";

const schema = z.object({
  content: z.string().min(1).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await resolveIdentity();
    const params = await context.params;
    const body = schema.parse(await req.json().catch(() => ({})));

    const message = await getMessageById({ userId, messageId: params.id });
    if (!message || message.role !== "user") {
      return NextResponse.json(
        { error: "User message not found for regeneration." },
        { status: 404 }
      );
    }

    const editedContent = body.content?.trim();
    const updatedUserMessage =
      editedContent && editedContent !== message.content
        ? await updateMessage({
            userId,
            messageId: message.id,
            content: editedContent,
          })
        : message;

    await deleteMessagesAfter({
      userId,
      sessionId: updatedUserMessage.sessionId,
      messageId: updatedUserMessage.id,
    });

    const session = await getSessionById({
      userId,
      sessionId: updatedUserMessage.sessionId,
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const history = await getMessages({
      userId,
      sessionId: updatedUserMessage.sessionId,
    });
    const recentMessages = history.slice(-16);
    const retrievedContext = await retrieveContext({
      userId,
      query: updatedUserMessage.content,
      limit: 6,
    });
    const workingMemory = await getWorkingMemory({
      userId,
      sessionId: updatedUserMessage.sessionId,
    });

    const personaId = session.personaId ?? DEFAULT_PERSONA_ID;
    const preferredLanguage = session.preferredLanguage ?? DEFAULT_LANGUAGE;
    const systemPrompt = buildSystemPrompt({
      workingMemory: workingMemory?.rollingSummary ?? buildRollingSummary(history),
      retrievedContext,
      personaId,
      preferredLanguage,
      includeWebSearch: needsWebSearch(updatedUserMessage.content),
    });

    let finalText = "I could not generate a response this turn.";
    let citations: Awaited<ReturnType<typeof extractCitationsFromResponse>> = [];

    if (hasOpenAiKey()) {
      const openai = getOpenAiClient();
      if (needsWebSearch(updatedUserMessage.content)) {
        const response = await openai.responses.create({
          model: env.openaiChatModel,
          input: [{ role: "system", content: systemPrompt }, ...recentMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          }))],
          tools: [{ type: "web_search_preview" as const }],
        });
        finalText = response.output_text?.trim() || finalText;
        citations = extractCitationsFromResponse(response as { output?: unknown[] });
      } else {
        const response = await openai.responses.create({
          model: env.openaiChatModel,
          input: [{ role: "system", content: systemPrompt }, ...recentMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          }))],
        });
        finalText = response.output_text?.trim() || finalText;
      }
    }

    const assistantMessage = await addMessage({
      userId,
      sessionId: updatedUserMessage.sessionId,
      role: "assistant",
      content: finalText,
      format: "markdown",
      metadata: {
        language: preferredLanguage,
        personaId,
        citations,
      },
      regenerationRootId: updatedUserMessage.id,
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
      sessionId: updatedUserMessage.sessionId,
      messageId: assistantMessage.id,
      content: assistantMessage.content,
    });

    await upsertWorkingMemory({
      userId,
      sessionId: updatedUserMessage.sessionId,
      rollingSummary: buildRollingSummary([...history, assistantMessage]),
      activeEntities: [],
    });
    await refreshSessionSummary({ userId, sessionId: updatedUserMessage.sessionId });

    return NextResponse.json({ message: assistantMessage, citations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

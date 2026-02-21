import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getOpenAiClient, hasOpenAiKey } from "@/lib/server/openai";
import { resolveIdentity } from "@/lib/server/identity";
import {
  getMessageById,
  saveMessageTranslation,
} from "@/lib/server/repository";

const schema = z.object({
  targetLanguage: z.string().min(2).max(16),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await resolveIdentity();
    const params = await context.params;
    const body = schema.parse(await req.json());
    const message = await getMessageById({ userId, messageId: params.id });
    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    let translatedText = message.content;
    if (hasOpenAiKey()) {
      const openai = getOpenAiClient();
      const response = await openai.responses.create({
        model: env.openaiTranslationModel,
        input: [
          {
            role: "system",
            content: `Translate the user text to language code "${body.targetLanguage}". Return only translated text.`,
          },
          { role: "user", content: message.content },
        ],
      });
      translatedText = response.output_text?.trim() || message.content;
    }

    const translation = await saveMessageTranslation({
      userId,
      messageId: params.id,
      targetLanguage: body.targetLanguage,
      translatedText,
    });
    return NextResponse.json({ translation }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { persistSemanticMemory } from "@/lib/server/memory";
import { resolveIdentity } from "@/lib/server/identity";
import { addMessage, getMessages } from "@/lib/server/repository";

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  audioUrl: z.string().url().nullable().optional(),
});

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const { userId } = await resolveIdentity();
    const messages = await getMessages({ userId, sessionId: params.id });
    return NextResponse.json({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const { userId } = await resolveIdentity();
    const body = messageSchema.parse(await req.json());
    const message = await addMessage({
      userId,
      sessionId: params.id,
      role: body.role,
      content: body.content,
      audioUrl: body.audioUrl,
    });

    if (message.role !== "system") {
      await persistSemanticMemory({
        userId,
        sessionId: params.id,
        messageId: message.id,
        content: message.content,
      });
    }

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}


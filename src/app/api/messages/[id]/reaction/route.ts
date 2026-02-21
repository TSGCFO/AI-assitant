import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveIdentity } from "@/lib/server/identity";
import { getMessageById, saveMessageReaction } from "@/lib/server/repository";

const schema = z.object({
  value: z.enum(["up", "down"]),
  feedback: z.string().max(500).optional(),
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
    const reaction = await saveMessageReaction({
      userId,
      messageId: params.id,
      sessionId: message.sessionId,
      value: body.value,
      feedback: body.feedback ?? null,
    });
    return NextResponse.json({ reaction }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

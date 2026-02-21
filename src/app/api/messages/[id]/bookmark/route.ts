import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveIdentity } from "@/lib/server/identity";
import {
  getMessageById,
  removeMessageBookmark,
  saveMessageBookmark,
} from "@/lib/server/repository";

const bodySchema = z.object({
  sessionId: z.string().optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await resolveIdentity();
    const params = await context.params;
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    const message = await getMessageById({ userId, messageId: params.id });
    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const saved = await saveMessageBookmark({
      userId,
      messageId: params.id,
      sessionId: body.sessionId ?? message.sessionId,
    });

    return NextResponse.json({ saved }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await resolveIdentity();
    const params = await context.params;
    await removeMessageBookmark({ userId, messageId: params.id });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

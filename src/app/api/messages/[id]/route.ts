import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveIdentity } from "@/lib/server/identity";
import { getMessageById, updateMessage } from "@/lib/server/repository";

const schema = z.object({
  content: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await resolveIdentity();
    const params = await context.params;
    const existing = await getMessageById({ userId, messageId: params.id });
    if (!existing) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    const body = schema.parse(await req.json());
    const message = await updateMessage({
      userId,
      messageId: params.id,
      content: body.content,
      metadata: body.metadata,
    });
    return NextResponse.json({ message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

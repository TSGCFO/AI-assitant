import { NextResponse } from "next/server";
import { z } from "zod";

import { persistSemanticMemory } from "@/lib/server/memory";
import { resolveIdentity } from "@/lib/server/identity";
import { addMessage, createSession } from "@/lib/server/repository";

const schema = z.object({
  sessions: z
    .array(
      z.object({
        title: z.string().optional(),
        mode: z.enum(["text", "voice"]).optional(),
        messages: z.array(
          z.object({
            role: z.enum(["user", "assistant", "system"]),
            content: z.string(),
          })
        ),
      })
    )
    .default([]),
});

export async function POST(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const body = schema.parse(await req.json());
    const importedSessionIds: string[] = [];

    for (const incomingSession of body.sessions) {
      const created = await createSession({
        userId,
        title: incomingSession.title,
        mode: incomingSession.mode ?? "text",
      });
      importedSessionIds.push(created.id);

      for (const incomingMessage of incomingSession.messages) {
        const message = await addMessage({
          userId,
          sessionId: created.id,
          role: incomingMessage.role,
          content: incomingMessage.content,
        });

        if (incomingMessage.role !== "system") {
          await persistSemanticMemory({
            userId,
            sessionId: created.id,
            messageId: message.id,
            content: message.content,
          });
        }
      }
    }

    return NextResponse.json({ importedSessionIds }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}


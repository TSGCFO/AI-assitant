import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveIdentity } from "@/lib/server/identity";
import { createSession, listSessions } from "@/lib/server/repository";

const createSchema = z.object({
  title: z.string().optional(),
  mode: z.enum(["text", "voice"]).optional(),
});

export async function GET() {
  try {
    const { userId } = await resolveIdentity();
    const sessions = await listSessions(userId);
    return NextResponse.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const body = createSchema.parse(await req.json());
    const session = await createSession({
      userId,
      title: body.title,
      mode: body.mode ?? "text",
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}


import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveIdentity } from "@/lib/server/identity";
import { createSession, listSessions } from "@/lib/server/repository";

const createSchema = z.object({
  title: z.string().optional(),
  mode: z.enum(["text", "voice"]).optional(),
  personaId: z
    .enum(["default", "creative-writer", "code-helper", "fitness-coach", "tutor"])
    .optional(),
  preferredLanguage: z.string().min(2).max(16).optional(),
});

export async function GET(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const url = new URL(req.url);
    const query = url.searchParams.get("query") ?? undefined;
    const savedOnly = url.searchParams.get("savedOnly") === "1";
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "50");
    const sessions = await listSessions(userId, {
      query,
      savedOnly,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 50,
    });
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
      personaId: body.personaId,
      preferredLanguage: body.preferredLanguage,
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

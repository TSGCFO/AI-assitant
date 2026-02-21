import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveIdentity } from "@/lib/server/identity";
import { deleteSession, updateSession } from "@/lib/server/repository";

const patchSchema = z.object({
  title: z.string().min(1).max(140).optional(),
  summary: z.string().max(400).optional(),
  personaId: z
    .enum(["default", "creative-writer", "code-helper", "fitness-coach", "tutor"])
    .optional(),
  preferredLanguage: z.string().min(2).max(16).nullable().optional(),
  isTitleCustom: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const { userId } = await resolveIdentity();
    const body = patchSchema.parse(await req.json());
    const session = await updateSession({
      userId,
      sessionId: params.id,
      title: body.title,
      summary: body.summary,
      personaId: body.personaId,
      preferredLanguage: body.preferredLanguage,
      isTitleCustom: body.isTitleCustom,
    });
    return NextResponse.json({ session });
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
    const params = await context.params;
    const { userId } = await resolveIdentity();
    await deleteSession({ userId, sessionId: params.id });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

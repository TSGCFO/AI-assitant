import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveIdentity } from "@/lib/server/identity";
import { updateTask } from "@/lib/server/repository";

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional(),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const { userId } = await resolveIdentity();
    const body = patchSchema.parse(await req.json());
    const task = await updateTask({
      userId,
      taskId: params.id,
      title: body.title,
      notes: body.notes,
      dueAt: body.dueAt,
      status: body.status,
    });
    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

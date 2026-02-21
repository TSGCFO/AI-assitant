import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveIdentity } from "@/lib/server/identity";
import { createReminder, listReminders } from "@/lib/server/repository";

const createSchema = z.object({
  text: z.string().min(1),
  dueAt: z.string().datetime(),
  taskId: z.string().uuid().nullable().optional(),
});

export async function GET() {
  try {
    const { userId } = await resolveIdentity();
    const reminders = await listReminders({ userId });
    return NextResponse.json({ reminders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const body = createSchema.parse(await req.json());
    const reminder = await createReminder({
      userId,
      text: body.text,
      dueAt: body.dueAt,
      taskId: body.taskId ?? null,
    });
    return NextResponse.json({ reminder }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

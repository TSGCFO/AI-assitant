import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveIdentity } from "@/lib/server/identity";
import { createTask, listTasks } from "@/lib/server/repository";

const createSchema = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function GET(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const status = new URL(req.url).searchParams.get("status") ?? undefined;
    const tasks = await listTasks({
      userId,
      status:
        status === "pending" ||
        status === "in_progress" ||
        status === "done" ||
        status === "cancelled"
          ? status
          : undefined,
    });
    return NextResponse.json({ tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const body = createSchema.parse(await req.json());
    const task = await createTask({
      userId,
      title: body.title,
      notes: body.notes ?? null,
      dueAt: body.dueAt ?? null,
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

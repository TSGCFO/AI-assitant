import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getOpenAiClient, hasOpenAiKey } from "@/lib/server/openai";
import { resolveIdentity } from "@/lib/server/identity";
import {
  createBriefing,
  createNotification,
  getTodayBriefing,
  listTasks,
} from "@/lib/server/repository";

const schema = z.object({
  timezone: z.string().min(1).default("UTC"),
  topics: z.array(z.string()).default(["priorities", "tasks", "focus"]),
  force: z.boolean().optional(),
});

const dateInTimezone = (timezone: string): string => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
};

export async function POST(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const body = schema.parse(await req.json().catch(() => ({})));
    const briefingDate = dateInTimezone(body.timezone);

    if (!body.force) {
      const existing = await getTodayBriefing({ userId, briefingDate });
      if (existing) {
        return NextResponse.json({ briefing: existing, reused: true });
      }
    }

    const tasks = await listTasks({ userId });
    const taskLines =
      tasks.length === 0
        ? "No tasks currently scheduled."
        : tasks
            .slice(0, 12)
            .map((task) => `- ${task.title} (${task.status}${task.dueAt ? `, due ${task.dueAt}` : ""})`)
            .join("\n");

    let content = `Daily Briefing (${briefingDate})\n\n${taskLines}`;
    if (hasOpenAiKey()) {
      const openai = getOpenAiClient();
      const response = await openai.responses.create({
        model: env.openaiChatModel,
        input: [
          {
            role: "system",
            content:
              "Create a concise daily briefing with sections: Priorities, Risks, Suggested Next Actions.",
          },
          {
            role: "user",
            content: `Timezone: ${body.timezone}\nDate: ${briefingDate}\nTopics: ${body.topics.join(", ")}\nTasks:\n${taskLines}`,
          },
        ],
      });
      content = response.output_text?.trim() || content;
    }

    const briefing = await createBriefing({
      userId,
      briefingDate,
      timezone: body.timezone,
      content,
      topics: body.topics,
    });
    await createNotification({
      userId,
      title: "Daily briefing ready",
      body: "Your latest daily summary is available.",
      linkUrl: "/",
    });

    return NextResponse.json({ briefing }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";

import { resolveIdentity } from "@/lib/server/identity";
import { getMessages, getSessionById } from "@/lib/server/repository";

const asMarkdown = ({
  title,
  messages,
}: {
  title: string;
  messages: Awaited<ReturnType<typeof getMessages>>;
}): string => {
  const lines: string[] = [`# ${title}`, ""];
  for (const message of messages) {
    lines.push(`## ${message.role.toUpperCase()} - ${new Date(message.createdAt).toISOString()}`);
    lines.push("");
    lines.push(message.content);
    lines.push("");
  }
  return lines.join("\n");
};

const asPlainText = ({
  title,
  messages,
}: {
  title: string;
  messages: Awaited<ReturnType<typeof getMessages>>;
}): string => {
  const lines: string[] = [`${title}`, ""];
  for (const message of messages) {
    lines.push(
      `[${new Date(message.createdAt).toISOString()}] ${message.role.toUpperCase()}: ${message.content}`
    );
  }
  return lines.join("\n");
};

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const { userId } = await resolveIdentity();
    const session = await getSessionById({ userId, sessionId: params.id });
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const messages = await getMessages({ userId, sessionId: params.id });
    const format = new URL(req.url).searchParams.get("format") === "text" ? "text" : "markdown";
    const body =
      format === "text"
        ? asPlainText({ title: session.title, messages })
        : asMarkdown({ title: session.title, messages });

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": format === "text" ? "text/plain; charset=utf-8" : "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="session-${session.id}.${format === "text" ? "txt" : "md"}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";

import { resolveIdentity } from "@/lib/server/identity";
import { listSavedMessages } from "@/lib/server/repository";

export async function GET(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const sessionId = new URL(req.url).searchParams.get("sessionId") ?? undefined;
    const saved = await listSavedMessages({ userId, sessionId });
    return NextResponse.json({ saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { resolveIdentity } from "@/lib/server/identity";
import { listNotifications } from "@/lib/server/repository";

export async function GET() {
  try {
    const { userId } = await resolveIdentity();
    const notifications = await listNotifications({ userId });
    return NextResponse.json({ notifications });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

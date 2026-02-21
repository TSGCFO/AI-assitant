import { NextResponse } from "next/server";

import { resolveIdentity } from "@/lib/server/identity";
import { getTodayBriefing } from "@/lib/server/repository";

const dateInTimezone = (timezone: string): string => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
};

export async function GET(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const timezone = new URL(req.url).searchParams.get("timezone") ?? "UTC";
    const briefingDate = dateInTimezone(timezone);
    const briefing = await getTodayBriefing({ userId, briefingDate });
    return NextResponse.json({ briefing, briefingDate, timezone });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

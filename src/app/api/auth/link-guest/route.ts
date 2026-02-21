import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { resolveIdentity } from "@/lib/server/identity";
import { migrateGuestDataToUser } from "@/lib/server/repository";

const schema = z.object({
  deviceId: z.string().min(1).optional(),
});

const sanitize = (value: string): string => value.trim().toLowerCase();

export async function POST(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    if (!userId.startsWith("user:")) {
      return NextResponse.json(
        { error: "Authenticated user is required to link guest data." },
        { status: 401 }
      );
    }

    const body = schema.parse(await req.json().catch(() => ({})));
    const headerStore = await headers();
    const deviceId = body.deviceId ?? headerStore.get("x-device-id") ?? "";
    if (!deviceId) {
      return NextResponse.json({ error: "deviceId is required." }, { status: 400 });
    }

    const guestUserId = `guest:${sanitize(deviceId)}`;
    await migrateGuestDataToUser({
      guestUserId,
      authenticatedUserId: userId,
    });

    return NextResponse.json({ ok: true, guestUserId, userId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveIdentity } from "@/lib/server/identity";
import {
  removePushSubscription,
  upsertPushSubscription,
} from "@/lib/server/repository";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export async function POST(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const body = subscribeSchema.parse(await req.json());
    const subscription = await upsertPushSubscription({
      userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    });
    return NextResponse.json({ subscription }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const body = unsubscribeSchema.parse(await req.json());
    await removePushSubscription({ userId, endpoint: body.endpoint });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

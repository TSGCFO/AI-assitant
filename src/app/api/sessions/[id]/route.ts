import { NextResponse } from "next/server";

import { resolveIdentity } from "@/lib/server/identity";
import { deleteSession } from "@/lib/server/repository";

export async function DELETE(
  _: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const { userId } = await resolveIdentity();
    await deleteSession({ userId, sessionId: params.id });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


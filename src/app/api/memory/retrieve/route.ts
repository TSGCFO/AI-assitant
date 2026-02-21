import { NextResponse } from "next/server";
import { z } from "zod";

import { retrieveContext } from "@/lib/server/memory";
import { resolveIdentity } from "@/lib/server/identity";

const schema = z.object({
  query: z.string().min(1),
  count: z.number().int().min(1).max(20).optional(),
});

export async function POST(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const body = schema.parse(await req.json());
    const chunks = await retrieveContext({
      userId,
      query: body.query,
      limit: body.count ?? 6,
    });

    return NextResponse.json({ chunks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}


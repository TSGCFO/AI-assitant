import { z } from "zod";

import { env } from "@/lib/env";
import { getOpenAiClient, hasOpenAiKey } from "@/lib/server/openai";

const schema = z.object({
  input: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    if (!hasOpenAiKey()) {
      return new Response("OPENAI_API_KEY is not configured.", { status: 400 });
    }

    const { input } = schema.parse(await req.json());
    const openai = getOpenAiClient();
    const audio = await openai.audio.speech.create({
      model: env.openaiTtsModel,
      voice: env.openaiTtsVoice,
      input,
    });

    const buffer = await audio.arrayBuffer();
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(message, { status: 400 });
  }
}

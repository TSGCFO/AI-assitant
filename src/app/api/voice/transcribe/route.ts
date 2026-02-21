import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getOpenAiClient, hasOpenAiKey } from "@/lib/server/openai";

export async function POST(req: Request) {
  try {
    if (!hasOpenAiKey()) {
      return NextResponse.json(
        { text: "", error: "OPENAI_API_KEY is not configured." },
        { status: 400 }
      );
    }

    const formData = await req.formData();
    const audio = formData.get("audio");
    if (!(audio instanceof File)) {
      return NextResponse.json(
        { error: "Missing audio file in form-data (audio)." },
        { status: 400 }
      );
    }

    const openai = getOpenAiClient();
    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: env.openaiSttModel,
    });

    return NextResponse.json({ text: transcription.text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


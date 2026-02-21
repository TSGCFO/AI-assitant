import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getOpenAiClient, hasOpenAiKey } from "@/lib/server/openai";
import { resolveIdentity } from "@/lib/server/identity";
import { addAttachment, addMessage } from "@/lib/server/repository";
import { getSupabaseAdminClient, hasSupabaseAdmin } from "@/lib/server/supabase";

const schema = z.object({
  sessionId: z.string().min(1),
  prompt: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    if (!hasOpenAiKey()) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured." },
        { status: 400 }
      );
    }

    const { userId } = await resolveIdentity();
    const body = schema.parse(await req.json());
    const openai = getOpenAiClient();

    const imageResponse = await openai.images.generate({
      model: env.openaiImageModel,
      prompt: body.prompt,
      size: "1024x1024",
    });

    const first = imageResponse.data?.[0];
    if (!first) {
      throw new Error("Image generation returned no image.");
    }

    let imageUrl = first.url ?? "";
    let storagePath = `generated/${Date.now()}.png`;
    if (!imageUrl && first.b64_json) {
      const buffer = Buffer.from(first.b64_json, "base64");
      storagePath = `${userId}/generated-${Date.now()}.png`;
      if (hasSupabaseAdmin()) {
        const sb = getSupabaseAdminClient();
        const upload = await sb.storage
          .from(env.supabaseStorageBucket)
          .upload(storagePath, buffer, {
            contentType: "image/png",
            upsert: true,
          });
        if (upload.error) throw new Error(upload.error.message);
        const signed = await sb.storage
          .from(env.supabaseStorageBucket)
          .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
        if (signed.error || !signed.data?.signedUrl) {
          throw new Error(signed.error?.message ?? "Failed to create image URL");
        }
        imageUrl = signed.data.signedUrl;
      } else {
        imageUrl = `data:image/png;base64,${first.b64_json}`;
      }
    }

    if (!imageUrl) {
      throw new Error("Image URL is unavailable.");
    }

    const attachment = await addAttachment({
      userId,
      sessionId: body.sessionId,
      name: `generated-${Date.now()}.png`,
      mimeType: "image/png",
      sizeBytes: 0,
      storagePath,
      url: imageUrl,
      kind: "image",
    });

    const message = await addMessage({
      userId,
      sessionId: body.sessionId,
      role: "assistant",
      content: `Generated image for: ${body.prompt}`,
      format: "image",
      metadata: {
        attachments: [attachment],
      },
    });

    return NextResponse.json({ message, attachment }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

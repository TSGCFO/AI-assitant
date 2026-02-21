import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getOpenAiClient, hasOpenAiKey } from "@/lib/server/openai";
import { resolveIdentity } from "@/lib/server/identity";
import { getAttachment } from "@/lib/server/repository";

const schema = z.object({
  attachmentId: z.string().min(1),
  question: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const body = schema.parse(await req.json());
    const attachment = await getAttachment({
      userId,
      attachmentId: body.attachmentId,
    });
    if (!attachment) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    let analysis = `File "${attachment.name}" uploaded (${attachment.mimeType}, ${(attachment.sizeBytes / 1024).toFixed(1)} KB).`;

    if (hasOpenAiKey()) {
      const openai = getOpenAiClient();
      if (attachment.kind === "image") {
        const response = await openai.responses.create({
          model: env.openaiChatModel,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text:
                    body.question ??
                    "Analyze this image and provide concise key observations.",
                },
                {
                  type: "input_image",
                  image_url: attachment.url,
                  detail: "auto",
                },
              ],
            },
          ],
        });
        analysis = response.output_text?.trim() || analysis;
      } else {
        const response = await openai.responses.create({
          model: env.openaiChatModel,
          input: [
            {
              role: "user",
              content: `The user uploaded a ${attachment.mimeType} file named "${attachment.name}". Question: ${
                body.question ?? "Summarize what to inspect in this document."
              }. File URL: ${attachment.url}`,
            },
          ],
        });
        analysis = response.output_text?.trim() || analysis;
      }
    }

    return NextResponse.json({
      analysis,
      attachment,
      citations: [{ title: attachment.name, url: attachment.url, source: "attachment" }],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

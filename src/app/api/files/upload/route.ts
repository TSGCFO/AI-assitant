import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { resolveIdentity } from "@/lib/server/identity";
import { addAttachment } from "@/lib/server/repository";
import { getSupabaseAdminClient, hasSupabaseAdmin } from "@/lib/server/supabase";

const sanitizeName = (name: string): string =>
  name.replace(/[^a-zA-Z0-9._-]/g, "_");

const inferKind = (mimeType: string) => {
  if (mimeType.startsWith("image/")) return "image" as const;
  if (mimeType === "application/pdf") return "pdf" as const;
  if (mimeType.startsWith("audio/")) return "audio" as const;
  if (mimeType.includes("text") || mimeType.includes("officedocument")) {
    return "document" as const;
  }
  return "other" as const;
};

export async function POST(req: Request) {
  try {
    const { userId } = await resolveIdentity();
    const form = await req.formData();
    const file = form.get("file");
    const sessionId = String(form.get("sessionId") ?? "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = sanitizeName(file.name || "upload.bin");
    const storagePath = `${userId}/${Date.now()}-${fileName}`;
    const kind = inferKind(file.type || "application/octet-stream");

    let url = "";
    if (hasSupabaseAdmin()) {
      const sb = getSupabaseAdminClient();
      const upload = await sb.storage
        .from(env.supabaseStorageBucket)
        .upload(storagePath, buffer, {
          contentType: file.type || "application/octet-stream",
          upsert: true,
        });
      if (upload.error) {
        throw new Error(upload.error.message);
      }
      const signed = await sb.storage
        .from(env.supabaseStorageBucket)
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
      if (signed.error || !signed.data?.signedUrl) {
        throw new Error(signed.error?.message ?? "Failed to create signed URL");
      }
      url = signed.data.signedUrl;
    } else {
      url = `data:${file.type || "application/octet-stream"};base64,${buffer.toString("base64")}`;
    }

    const attachment = await addAttachment({
      userId,
      sessionId,
      name: fileName,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: buffer.byteLength,
      storagePath,
      url,
      kind,
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

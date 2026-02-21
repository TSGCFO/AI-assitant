import { headers } from "next/headers";

import { getSupabaseAdminClient, hasSupabaseAdmin } from "@/lib/server/supabase";

const sanitize = (value: string): string => value.trim().toLowerCase();

export const resolveIdentity = async (): Promise<{ userId: string }> => {
  const headerStore = await headers();
  const authorization = headerStore.get("authorization");
  const explicitUserId = headerStore.get("x-user-id");
  const deviceId = headerStore.get("x-device-id");

  if (authorization?.toLowerCase().startsWith("bearer ") && hasSupabaseAdmin()) {
    const token = authorization.slice(7).trim();
    if (token) {
      try {
        const { data, error } = await getSupabaseAdminClient().auth.getUser(token);
        if (!error && data.user?.id) {
          return { userId: `user:${sanitize(data.user.id)}` };
        }
      } catch {
        // Fallback to guest identity on invalid or expired token.
      }
    }
  }

  if (explicitUserId) {
    return { userId: `user:${sanitize(explicitUserId)}` };
  }

  if (deviceId) {
    return { userId: `guest:${sanitize(deviceId)}` };
  }

  return { userId: "guest:anonymous" };
};

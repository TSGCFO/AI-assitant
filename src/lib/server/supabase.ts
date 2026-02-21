import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

const hasUrl = Boolean(env.supabaseUrl);
const hasAdminKey = Boolean(env.supabaseServiceRoleKey);
const hasAnonKey = Boolean(env.supabaseAnonKey);

let adminClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

export const hasSupabaseAdmin = (): boolean => hasUrl && hasAdminKey;
export const hasSupabaseAnon = (): boolean => hasUrl && hasAnonKey;

export const getSupabaseAdminClient = (): SupabaseClient => {
  if (!hasSupabaseAdmin()) {
    throw new Error("Supabase admin credentials are not configured.");
  }

  if (!adminClient) {
    adminClient = createClient(
      env.supabaseUrl as string,
      env.supabaseServiceRoleKey as string,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );
  }

  return adminClient;
};

export const getSupabaseAnonClient = (): SupabaseClient => {
  if (!hasSupabaseAnon()) {
    throw new Error("Supabase anon credentials are not configured.");
  }

  if (!anonClient) {
    anonClient = createClient(env.supabaseUrl as string, env.supabaseAnonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return anonClient;
};

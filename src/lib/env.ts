const required = (value: string | undefined, key: string): string => {
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
};

const toBoolean = (value: string | undefined, fallback = false): boolean => {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiChatModel: process.env.OPENAI_CHAT_MODEL ?? "gpt-5",
  openaiEmbeddingModel:
    process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large",
  openaiSttModel: process.env.OPENAI_STT_MODEL ?? "gpt-4o-mini-transcribe",
  openaiTtsModel: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
  openaiTtsVoice: process.env.OPENAI_TTS_VOICE ?? "alloy",
  openaiRealtimeModel:
    process.env.OPENAI_REALTIME_MODEL ?? "gpt-4o-realtime-preview",
  openaiRealtimeVoice: process.env.OPENAI_REALTIME_VOICE ?? "alloy",
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
  openaiTranslationModel: process.env.OPENAI_TRANSLATION_MODEL ?? "gpt-4o-mini",
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "assistant-files",
  featureAllOn: toBoolean(process.env.FEATURE_ALL_ON, process.env.NODE_ENV !== "production"),
  webSearchCacheMinutes: toNumber(process.env.WEB_SEARCH_CACHE_MINUTES, 30),
  webPushVapidPublicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
  webPushVapidPrivateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
  webPushSubject: process.env.WEB_PUSH_SUBJECT ?? "mailto:admin@example.com",
};

export const requireOpenAiKey = (): string =>
  required(env.openaiApiKey, "OPENAI_API_KEY");

export const requireSupabaseAnonKey = (): string =>
  required(env.supabaseAnonKey, "SUPABASE_ANON_KEY");

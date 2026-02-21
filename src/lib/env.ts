const required = (value: string | undefined, key: string): string => {
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
};

export const env = {
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
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

export const requireOpenAiKey = (): string =>
  required(env.openaiApiKey, "OPENAI_API_KEY");

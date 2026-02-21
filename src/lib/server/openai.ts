import OpenAI from "openai";

import { env, requireOpenAiKey } from "@/lib/env";

let singleton: OpenAI | null = null;

export const getOpenAiClient = (): OpenAI => {
  if (!singleton) {
    singleton = new OpenAI({ apiKey: requireOpenAiKey() });
  }
  return singleton;
};

export const hasOpenAiKey = (): boolean => Boolean(env.openaiApiKey);


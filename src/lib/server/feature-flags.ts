import { env } from "@/lib/env";
import { getFeatureFlag } from "@/lib/server/repository";

export const FEATURE_KEYS = {
  sessionSearch: "feature.session_search",
  bookmarks: "feature.bookmarks",
  exportChat: "feature.export_chat",
  sessionRenaming: "feature.session_renaming",
  suggestedPrompts: "feature.suggested_prompts",
  typingIndicator: "feature.typing_indicator",
  messageEditing: "feature.message_editing",
  conversationSummary: "feature.conversation_summary",
  multiLanguage: "feature.multi_language",
  personas: "feature.personas",
  markdown: "feature.markdown",
  reactions: "feature.reactions",
  imageGeneration: "feature.image_generation",
  fileAnalysis: "feature.file_analysis",
  webSearch: "feature.web_search",
  tts: "feature.tts",
  dailyBriefing: "feature.daily_briefing",
  smartTasks: "feature.smart_tasks",
} as const;

export const isFeatureEnabled = async ({
  key,
  userId,
}: {
  key: string;
  userId?: string;
}): Promise<boolean> => {
  if (env.featureAllOn) {
    return true;
  }
  return getFeatureFlag({ key, userId });
};

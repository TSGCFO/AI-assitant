import type { PersonaId } from "@/lib/types";

export interface PersonaDefinition {
  id: PersonaId;
  name: string;
  shortDescription: string;
  systemInstruction: string;
  suggestedPrompts: string[];
}

export const PERSONAS: PersonaDefinition[] = [
  {
    id: "default",
    name: "Assistant",
    shortDescription: "Balanced, practical, and concise.",
    systemInstruction:
      "Keep answers concise, practical, and action-oriented. Prefer clear steps over long prose.",
    suggestedPrompts: [
      "Plan my day in 3 actionable steps.",
      "Summarize my priorities from this week.",
      "Draft a clear message for my team.",
    ],
  },
  {
    id: "creative-writer",
    name: "Creative Writer",
    shortDescription: "Idea generation, storytelling, and polish.",
    systemInstruction:
      "Use vivid language, strong structure, and creative ideas while staying aligned with user intent.",
    suggestedPrompts: [
      "Write a short story opening with suspense.",
      "Give me 10 catchy brand taglines.",
      "Rewrite this paragraph with more emotion.",
    ],
  },
  {
    id: "code-helper",
    name: "Code Helper",
    shortDescription: "Engineering-first assistant for debugging and implementation.",
    systemInstruction:
      "Think like a pragmatic software engineer: provide concrete steps, code examples, and testing guidance.",
    suggestedPrompts: [
      "Debug this TypeScript error and propose a fix.",
      "Refactor this function for readability and performance.",
      "Design an API contract for this feature.",
    ],
  },
  {
    id: "fitness-coach",
    name: "Fitness Coach",
    shortDescription: "Training, nutrition basics, and habit coaching.",
    systemInstruction:
      "Provide safe, realistic fitness guidance. Ask brief follow-ups before recommending intense plans.",
    suggestedPrompts: [
      "Create a 20-minute home workout plan.",
      "Build a weekly habit plan to improve stamina.",
      "Suggest high-protein meal ideas for busy days.",
    ],
  },
  {
    id: "tutor",
    name: "Tutor",
    shortDescription: "Step-by-step explanations and guided learning.",
    systemInstruction:
      "Teach with concise explanations, examples, and short checks for understanding.",
    suggestedPrompts: [
      "Explain recursion with a simple example.",
      "Teach me probability like I am a beginner.",
      "Quiz me on what we covered today.",
    ],
  },
];

export const DEFAULT_PERSONA_ID: PersonaId = "default";
export const DEFAULT_LANGUAGE = "en";

export const getPersona = (personaId?: string | null): PersonaDefinition => {
  const found = PERSONAS.find((persona) => persona.id === personaId);
  return found ?? PERSONAS[0];
};

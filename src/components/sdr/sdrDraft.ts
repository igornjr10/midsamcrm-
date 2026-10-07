import type { AiConfig, SdrPromptFields } from "@/lib/types";

/** O que as abas Ativação, Tempo, Comunicação e Encaminhamento editam juntas. */
export interface SdrDraft {
  enabled: boolean;
  // Ativação
  onlyNewLeads: boolean;
  triggerPhrases: string;
  allowedSources: string[];
  excludedTags: string[];
  onlyOpenStages: boolean;
  // Tempo de resposta
  firstDelay: number;
  nextDelay: number;
  debounce: number;
  windowEnabled: boolean;
  windowStart: number;
  windowEnd: number;
  skipWeekends: boolean;
  offhoursMessage: string;
  // Comunicação
  promptFields: SdrPromptFields;
  prompt: string;
  model: string;
  apiKey: string;
  // Encaminhamento
  pauseOnHuman: boolean;
  handoffUserId: string | null;
  maxUnanswered: number;
}

export type UpdateDraft = (patch: Partial<SdrDraft>) => void;

export const DEFAULT_PROMPT =
  "Você é um atendente comercial simpático e objetivo da empresa. Responda em português do Brasil, " +
  "em mensagens curtas de WhatsApp. Qualifique o interesse do cliente: pergunte o nome, o que ele " +
  "procura e a urgência. Nunca invente preços, prazos ou condições — se não souber, diga que um " +
  "atendente humano vai confirmar.";

export function draftFromConfig(config: AiConfig | null | undefined): SdrDraft {
  return {
    enabled: config?.enabled ?? false,
    onlyNewLeads: config?.only_new_leads ?? false,
    triggerPhrases: (config?.trigger_phrases ?? []).join("\n"),
    allowedSources: config?.allowed_sources ?? [],
    excludedTags: config?.excluded_tags ?? [],
    onlyOpenStages: config?.ai_only_open_stages ?? true,
    firstDelay: config?.reply_first_delay_seconds ?? 0,
    nextDelay: config?.reply_delay_seconds ?? 0,
    debounce: config?.reply_debounce_seconds ?? 0,
    windowEnabled: config?.reply_window_enabled ?? false,
    windowStart: config?.reply_window_start ?? 8,
    windowEnd: config?.reply_window_end ?? 20,
    skipWeekends: config?.reply_skip_weekends ?? false,
    offhoursMessage: config?.reply_offhours_message ?? "",
    promptFields: config?.prompt_fields ?? {},
    prompt: config?.system_prompt ?? DEFAULT_PROMPT,
    model: config?.model ?? "gpt-4o-mini",
    apiKey: "",
    pauseOnHuman: config?.pause_ai_on_human_reply ?? true,
    handoffUserId: config?.handoff_user_id ?? null,
    maxUnanswered: config?.max_unanswered ?? 0,
  };
}

/** Frases de ativação: uma por linha, sem linhas vazias nem repetidas. */
export function parsePhrases(text: string): string[] {
  return [...new Set(text.split("\n").map((l) => l.trim()).filter(Boolean))];
}

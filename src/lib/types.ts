// Tipos das entidades do banco. Depois que o projeto Supabase for criado e
// linkado, prefira regenerar via:
//   supabase gen types typescript --linked > src/integrations/supabase/types.ts
// e migrar estes tipos para Tables<"...">.

export interface Contact {
  id: string;
  user_id: string;
  company_id: string;
  name: string;
  phone: string | null;
  normalized_phone: string | null;
  email: string | null;
  stage: string;
  loss_reason: string | null;
  notes: string | null;
  ai_paused: boolean;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  company_id: string;
  contact_id: string;
  sender: "user" | "contact" | "ai";
  content: string;
  channel: string;
  message_ref: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type AppointmentKind = "meeting" | "call" | "visit" | "followup" | "other";
export type AppointmentStatus = "scheduled" | "done" | "canceled";

export interface Appointment {
  id: string;
  user_id: string;
  company_id: string;
  contact_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  kind: AppointmentKind;
  /** Sempre preenchido: a agenda é desenhada sobre o início do compromisso. */
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  status: AppointmentStatus;
  created_at: string;
  updated_at: string;
}

export interface WhatsappConfig {
  id: string;
  user_id: string;
  company_id: string;
  phone_number_id: string;
  waba_id: string;
  access_token: string;
  webhook_verify_token: string;
  app_id: string | null;
  active: boolean;
  label: string | null;
  phone_number: string | null;
  api_base_url: string;
  created_at: string;
  updated_at: string;
}

export interface AiConfig {
  id: string;
  company_id: string;
  enabled: boolean;
  system_prompt: string | null;
  model: string;
  openai_api_key: string | null;
  // Follow-up automático (cadência de cobrança de quem parou de responder).
  followup_enabled: boolean;
  followup_timezone: string;
  followup_window_start: number;
  followup_window_end: number;
  followup_skip_weekends: boolean;
  followup_only_open_stages: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Passo da cadência de follow-up.
 * - text     -> envia `message` como está ({{nome}}, {{primeiro_nome}})
 * - ai       -> o agente escreve seguindo `message` como instrução
 * - template -> template aprovado, único que funciona fora das 24h
 */
export type FollowupKind = "text" | "ai" | "template";

export interface FollowupStep {
  id: string;
  company_id: string;
  step_order: number;
  delay_hours: number;
  kind: FollowupKind;
  message: string | null;
  template_name: string | null;
  template_language: string;
  template_body: string | null;
  variable_map: VariableMap;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** Passo em edição na tela (ainda sem id/company_id no banco). */
export type FollowupStepDraft = Pick<
  FollowupStep,
  | "delay_hours"
  | "kind"
  | "message"
  | "template_name"
  | "template_language"
  | "template_body"
  | "variable_map"
  | "active"
>;

export type FollowupLogStatus = "sent" | "failed" | "skipped";

export interface FollowupLog {
  id: string;
  company_id: string;
  contact_id: string;
  step_id: string | null;
  step_order: number;
  kind: FollowupKind;
  status: FollowupLogStatus;
  content: string | null;
  message_ref: string | null;
  error: string | null;
  created_at: string;
  contacts: { id: string; name: string; phone: string | null } | null;
}

// Fonte de cada variável ({{1}}, {{2}}...) de um template aprovado.
export type VariableSource =
  | { source: "contact_name" }
  | { source: "contact_first_name" }
  | { source: "contact_phone" }
  | { source: "contact_email" }
  | { source: "text"; value: string };

export interface VariableMap {
  header?: VariableSource[];
  body?: VariableSource[];
  header_media_url?: string | null;
  header_media_type?: "image" | "video" | "document" | null;
}

export type CampaignStatus = "draft" | "running" | "paused" | "done" | "canceled";

export interface Campaign {
  id: string;
  company_id: string;
  user_id: string;
  name: string;
  template_name: string;
  template_language: string;
  template_body: string | null;
  variable_map: VariableMap;
  status: CampaignStatus;
  total_count: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CampaignTarget {
  id: string;
  campaign_id: string;
  company_id: string;
  contact_id: string | null;
  phone: string;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  message_ref: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface Company {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export type StageTone =
  | "slate" | "sky" | "indigo" | "violet" | "teal" | "amber" | "emerald" | "rose";
export type StageKind = "open" | "won" | "lost";

/** Etapa do funil. Cada empresa tem as suas (tabela pipeline_stages). */
export interface PipelineStage {
  id: string;
  company_id: string;
  /** Valor gravado em contacts.stage. Imutável depois de criada. */
  key: string;
  name: string;
  tone: StageTone;
  kind: StageKind;
  position: number;
  created_at: string;
  updated_at: string;
}

/**
 * Paleta das etapas, do frio (lead novo) ao quente (negociação), com verde e
 * vermelho reservados pro desfecho. Fica aqui pra coluna do Pipeline, o selo em
 * Contatos e a etiqueta do Chat nunca discordarem.
 */
export const STAGE_TONES: Record<StageTone, { label: string; dot: string; badge: string }> = {
  slate: { label: "Cinza", dot: "bg-slate-400", badge: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  sky: { label: "Azul", dot: "bg-sky-500", badge: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  indigo: { label: "Índigo", dot: "bg-indigo-500", badge: "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300" },
  violet: { label: "Roxo", dot: "bg-violet-500", badge: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300" },
  teal: { label: "Turquesa", dot: "bg-teal-500", badge: "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300" },
  amber: { label: "Âmbar", dot: "bg-amber-500", badge: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  emerald: { label: "Verde", dot: "bg-emerald-500", badge: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  rose: { label: "Vermelho", dot: "bg-rose-500", badge: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300" },
};

const FALLBACK_TONE = { label: "Cinza", dot: "bg-muted-foreground", badge: "border-border text-muted-foreground" };

export function getToneClasses(tone: string) {
  return STAGE_TONES[tone as StageTone] ?? FALLBACK_TONE;
}

/**
 * Etapa de um contato. O contato pode apontar para uma etapa que foi excluída
 * (ou estar renderizando antes das etapas carregarem), então nunca devolve
 * undefined: no pior caso mostra a própria chave em cinza.
 */
export function findStage(stages: PipelineStage[], key: string) {
  return stages.find((s) => s.key === key) ?? null;
}

export function getStageLabel(stages: PipelineStage[], key: string): string {
  return findStage(stages, key)?.name ?? key;
}

export function getStageTone(stages: PipelineStage[], key: string) {
  return getToneClasses(findStage(stages, key)?.tone ?? "");
}

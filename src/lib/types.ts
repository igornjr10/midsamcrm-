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

export interface Task {
  id: string;
  user_id: string;
  company_id: string;
  contact_id: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  status: "pending" | "done";
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

export const PIPELINE_STAGES = [
  { id: "new", label: "Novo", kind: "open" },
  { id: "contacted", label: "Contatado", kind: "open" },
  { id: "proposal", label: "Proposta", kind: "open" },
  { id: "negotiation", label: "Negociação", kind: "open" },
  { id: "won", label: "Ganho", kind: "won" },
  { id: "lost", label: "Perdido", kind: "lost" },
] as const;

export type PipelineStageId = (typeof PIPELINE_STAGES)[number]["id"];

export function getStageLabel(stageId: string): string {
  return PIPELINE_STAGES.find((s) => s.id === stageId)?.label ?? stageId;
}

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
  created_at: string;
  updated_at: string;
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

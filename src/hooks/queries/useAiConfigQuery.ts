import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AiConfig } from "@/lib/types";

export function aiConfigQueryKey(companyId: string | undefined) {
  return ["ai-config", companyId] as const;
}

/**
 * Colunas que o navegador pode ler. openai_api_key fica de fora (0054): o
 * banco recusa SELECT nela para o cliente. has_openai_api_key diz se há chave.
 */
const PUBLIC_COLUMNS =
  "id, company_id, enabled, system_prompt, model, has_openai_api_key, pause_ai_on_human_reply, " +
  "ai_only_open_stages, followup_enabled, followup_timezone, followup_window_start, " +
  "followup_window_end, followup_skip_weekends, followup_only_open_stages, reply_window_enabled, " +
  "reply_window_start, reply_window_end, reply_skip_weekends, reply_offhours_message, " +
  "created_at, updated_at";

export function useAiConfigQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: aiConfigQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return null;
      const { data, error } = await supabase
        .from("ai_configs")
        .select(PUBLIC_COLUMNS)
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as AiConfig | null) ?? null;
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

export interface SaveAiConfigInput {
  company_id: string;
  enabled?: boolean;
  system_prompt?: string | null;
  model?: string;
  /** Vazio ou ausente = mantém a chave gravada. */
  openai_api_key?: string | null;
  pause_ai_on_human_reply?: boolean;
  ai_only_open_stages?: boolean;
  followup_enabled?: boolean;
  followup_timezone?: string;
  followup_window_start?: number;
  followup_window_end?: number;
  followup_skip_weekends?: boolean;
  followup_only_open_stages?: boolean;
  // Horário de atendimento da IA — outra coisa que a janela do follow-up: esta
  // vale para a resposta a quem acabou de escrever.
  reply_window_enabled?: boolean;
  reply_window_start?: number;
  reply_window_end?: number;
  reply_skip_weekends?: boolean;
  reply_offhours_message?: string | null;
}

/** Sem upsert pelo mesmo motivo da config do WhatsApp: SELECT da chave revogado. */
export function useSaveAiConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SaveAiConfigInput) => {
      const { openai_api_key, ...rest } = payload;
      const row = openai_api_key ? { ...rest, openai_api_key } : rest;

      const { data: existing, error: findError } = await supabase
        .from("ai_configs")
        .select("id")
        .eq("company_id", payload.company_id)
        .maybeSingle();
      if (findError) throw findError;

      const { error } = existing
        ? await supabase.from("ai_configs").update(row).eq("company_id", payload.company_id)
        : await supabase.from("ai_configs").insert(row);
      if (error) throw error;
    },
    onSuccess: (_, payload) => {
      void queryClient.invalidateQueries({ queryKey: aiConfigQueryKey(payload.company_id) });
    },
  });
}

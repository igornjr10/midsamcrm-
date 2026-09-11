import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WhatsappConfig, WhatsappProvider } from "@/lib/types";

export function whatsappConfigQueryKey(companyId: string | undefined) {
  return ["whatsapp-config", companyId] as const;
}

/**
 * Colunas que o navegador pode ler. access_token e instance_token ficam de
 * fora de propósito (0054): o banco recusa SELECT neles para o cliente, e
 * `*` cairia junto. has_access_token diz se está configurado.
 */
const PUBLIC_COLUMNS =
  "id, user_id, company_id, provider, phone_number_id, waba_id, instance_name, instance_id, " +
  "webhook_verify_token, app_id, active, label, phone_number, api_base_url, has_access_token, " +
  "created_at, updated_at";

export function useWhatsappConfigQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: whatsappConfigQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return null;
      const { data, error } = await supabase
        .from("whatsapp_configs")
        .select(PUBLIC_COLUMNS)
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as WhatsappConfig | null) ?? null;
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

/**
 * Grava a configuração. Sem upsert: com o SELECT do token revogado, o
 * ON CONFLICT DO UPDATE do PostgREST não é garantido. Um select + update ou
 * insert faz o mesmo e só toca o token quando ele foi digitado.
 */
export function useSaveWhatsappConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      user_id: string;
      company_id: string;
      provider?: WhatsappProvider;
      phone_number_id?: string | null;
      waba_id?: string | null;
      /** Vazio ou ausente = mantém o token gravado. */
      access_token?: string | null;
      webhook_verify_token?: string;
      app_id?: string | null;
      label?: string | null;
      api_base_url?: string;
      active?: boolean;
    }) => {
      const { access_token, ...rest } = payload;
      const withToken = access_token ? { ...rest, access_token } : rest;

      const { data: existing, error: findError } = await supabase
        .from("whatsapp_configs")
        .select("id")
        .eq("company_id", payload.company_id)
        .maybeSingle();
      if (findError) throw findError;

      if (existing) {
        const { error } = await supabase
          .from("whatsapp_configs")
          .update(withToken)
          .eq("company_id", payload.company_id);
        if (error) throw error;
      } else {
        if (!access_token) throw new Error("Informe o Access Token na primeira configuração.");
        const { error } = await supabase.from("whatsapp_configs").insert({ ...rest, access_token });
        if (error) throw error;
      }
    },
    onSuccess: (_, payload) => {
      void queryClient.invalidateQueries({ queryKey: whatsappConfigQueryKey(payload.company_id) });
    },
  });
}

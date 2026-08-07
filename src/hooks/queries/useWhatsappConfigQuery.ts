import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WhatsappConfig, WhatsappProvider } from "@/lib/types";

export function whatsappConfigQueryKey(companyId: string | undefined) {
  return ["whatsapp-config", companyId] as const;
}

export function useWhatsappConfigQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: whatsappConfigQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return null;
      const { data, error } = await supabase
        .from("whatsapp_configs")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      return (data as WhatsappConfig | null) ?? null;
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

export function useSaveWhatsappConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      user_id: string;
      company_id: string;
      provider?: WhatsappProvider;
      phone_number_id?: string | null;
      waba_id?: string | null;
      access_token?: string | null;
      webhook_verify_token?: string;
      app_id?: string | null;
      label?: string | null;
      api_base_url?: string;
      active?: boolean;
    }) => {
      const { error } = await supabase
        .from("whatsapp_configs")
        .upsert(payload, { onConflict: "company_id" });
      if (error) throw error;
    },
    onSuccess: (_, payload) => {
      void queryClient.invalidateQueries({ queryKey: whatsappConfigQueryKey(payload.company_id) });
    },
  });
}

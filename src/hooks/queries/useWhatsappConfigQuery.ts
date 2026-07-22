import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WhatsappConfig } from "@/lib/types";

export function whatsappConfigQueryKey(userId: string | undefined) {
  return ["whatsapp-config", userId] as const;
}

export function useWhatsappConfigQuery(userId: string | undefined) {
  return useQuery({
    queryKey: whatsappConfigQueryKey(userId),
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("whatsapp_configs")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data as WhatsappConfig | null) ?? null;
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}

export function useSaveWhatsappConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      user_id: string;
      phone_number_id: string;
      waba_id: string;
      access_token: string;
      webhook_verify_token?: string;
      app_id?: string | null;
      label?: string | null;
      api_base_url?: string;
      active?: boolean;
    }) => {
      const { error } = await supabase
        .from("whatsapp_configs")
        .upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: (_, payload) => {
      void queryClient.invalidateQueries({ queryKey: whatsappConfigQueryKey(payload.user_id) });
    },
  });
}

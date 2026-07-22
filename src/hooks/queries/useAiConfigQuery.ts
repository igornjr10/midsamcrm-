import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AiConfig } from "@/lib/types";

export function aiConfigQueryKey(companyId: string | undefined) {
  return ["ai-config", companyId] as const;
}

export function useAiConfigQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: aiConfigQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return null;
      const { data, error } = await supabase
        .from("ai_configs")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      return (data as AiConfig | null) ?? null;
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

export function useSaveAiConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      company_id: string;
      enabled: boolean;
      system_prompt?: string | null;
      model?: string;
      openai_api_key?: string | null;
    }) => {
      const { error } = await supabase
        .from("ai_configs")
        .upsert(payload, { onConflict: "company_id" });
      if (error) throw error;
    },
    onSuccess: (_, payload) => {
      void queryClient.invalidateQueries({ queryKey: aiConfigQueryKey(payload.company_id) });
    },
  });
}

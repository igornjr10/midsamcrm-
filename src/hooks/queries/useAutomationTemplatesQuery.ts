import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AutomationTemplate } from "@/lib/types";

/**
 * Qual template aprovado cada automação usa quando a janela de 24h da Meta
 * está fechada. Chave por (empresa, purpose).
 */
export function automationTemplatesQueryKey(companyId: string | undefined) {
  return ["automation-templates", companyId] as const;
}

export function useAutomationTemplatesQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: automationTemplatesQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return new Map<string, AutomationTemplate>();
      const { data, error } = await supabase
        .from("crm_automation_templates")
        .select("*")
        .eq("company_id", companyId);
      if (error) throw error;
      const byPurpose = new Map<string, AutomationTemplate>();
      for (const row of (data ?? []) as AutomationTemplate[]) byPurpose.set(row.purpose, row);
      return byPurpose;
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

export function useSaveAutomationTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      company_id: string;
      purpose: string;
      template_name: string;
      template_language: string;
      variable_map: AutomationTemplate["variable_map"];
      body_preview: string | null;
    }) => {
      const { error } = await supabase
        .from("crm_automation_templates")
        .upsert(payload, { onConflict: "company_id,purpose" });
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: automationTemplatesQueryKey(company_id) });
    },
  });
}

export function useDeleteAutomationTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ company_id, purpose }: { company_id: string; purpose: string }) => {
      const { error } = await supabase
        .from("crm_automation_templates")
        .delete()
        .eq("company_id", company_id)
        .eq("purpose", purpose);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: automationTemplatesQueryKey(company_id) });
    },
  });
}

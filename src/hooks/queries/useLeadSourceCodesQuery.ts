import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LeadSourceCode } from "@/lib/types";

/**
 * Códigos dos links rastreáveis. O webhook procura "[CÓDIGO]" na primeira
 * mensagem do lead e grava a origem que estiver cadastrada aqui.
 */
export function leadSourceCodesQueryKey(companyId: string | undefined) {
  return ["lead-source-codes", companyId] as const;
}

export function useLeadSourceCodesQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: leadSourceCodesQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("lead_source_codes")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LeadSourceCode[];
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

export function useSaveLeadSourceCodeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: { id: string | null; company_id: string; code: string; source: string; label: string; message: string }) => {
      const { error } = id
        ? await supabase.from("lead_source_codes").update(payload).eq("id", id)
        : await supabase.from("lead_source_codes").insert(payload);
      if (error) {
        // Índice único (company_id, upper(code)): a mensagem crua do Postgres não ajuda.
        if (error.code === "23505") throw new Error("Já existe um link com esse código.");
        throw error;
      }
    },
    onSuccess: (_, { company_id }) =>
      queryClient.invalidateQueries({ queryKey: leadSourceCodesQueryKey(company_id) }),
  });
}

export function useDeleteLeadSourceCodeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; company_id: string }) => {
      const { error } = await supabase.from("lead_source_codes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) =>
      queryClient.invalidateQueries({ queryKey: leadSourceCodesQueryKey(company_id) }),
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CompanyPlan, CompanyUsage } from "@/lib/types";

/**
 * Quanto a empresa gastou no mês e qual é o teto.
 *
 * A soma vem do banco (company_usage), não de um contador em coluna: contador
 * incrementado por três functions diferentes sai de sincronia no primeiro erro
 * de rede, e aqui isso viraria cobrança errada.
 */
export function usageQueryKey(companyId: string | undefined) {
  return ["usage", companyId] as const;
}

export function useCompanyUsageQuery(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: usageQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return null;
      const { data, error } = await supabase.rpc("company_usage", { p_company_id: companyId });
      if (error) throw error;
      const rows = (data ?? []) as CompanyUsage[];
      return rows[0] ?? null;
    },
    enabled: enabled && !!companyId,
    staleTime: 60_000,
  });
}

export function planQueryKey(companyId: string | undefined) {
  return ["company-plan", companyId] as const;
}

export function useCompanyPlanQuery(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: planQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return null;
      const { data, error } = await supabase
        .from("company_plans")
        .select("company_id, monthly_coins, allow_overage")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      return (data as CompanyPlan | null) ?? null;
    },
    enabled: enabled && !!companyId,
    staleTime: 60_000,
  });
}

export function useSaveCompanyPlanMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      companyId: string;
      monthlyCoins: number;
      allowOverage: boolean;
    }) => {
      const { error } = await supabase.from("company_plans").upsert(
        {
          company_id: payload.companyId,
          monthly_coins: payload.monthlyCoins,
          allow_overage: payload.allowOverage,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id" },
      );
      if (error) throw error;
    },
    onSuccess: (_, { companyId }) => {
      void queryClient.invalidateQueries({ queryKey: planQueryKey(companyId) });
      void queryClient.invalidateQueries({ queryKey: usageQueryKey(companyId) });
    },
  });
}

/** Remove o teto: a empresa volta a ser ilimitada (o consumo continua medido). */
export function useClearCompanyPlanMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (companyId: string) => {
      const { error } = await supabase.from("company_plans").delete().eq("company_id", companyId);
      if (error) throw error;
    },
    onSuccess: (_, companyId) => {
      void queryClient.invalidateQueries({ queryKey: planQueryKey(companyId) });
      void queryClient.invalidateQueries({ queryKey: usageQueryKey(companyId) });
    },
  });
}

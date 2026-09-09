import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CompanyTeamMember } from "@/lib/types";

/**
 * Quem pode ser responsável por uma conversa.
 *
 * Vem de RPC porque o e-mail mora em auth.users, que o cliente não lê nem com
 * RLS aberta, e profiles só deixa cada um ler o próprio (0001). Lendo direto de
 * company_members o seletor mostraria uma lista de uuids.
 */
export function companyTeamQueryKey(companyId: string | undefined) {
  return ["company-team", companyId] as const;
}

export function useCompanyTeamQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: companyTeamQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase.rpc("company_team_members", { p_company_id: companyId });
      if (error) throw error;
      return (data ?? []) as CompanyTeamMember[];
    },
    enabled: !!companyId,
    // A equipe muda de mês em mês, não de minuto em minuto.
    staleTime: 5 * 60_000,
  });
}

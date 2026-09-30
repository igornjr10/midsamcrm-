import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CompanyTeamMember, TeamRole } from "@/lib/types";

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

// ── Gestão da equipe (tela Equipe, só admin) ────────────────────────────────
//
// Tudo passa pela edge function company-team: criar login exige service role,
// e company_members só aceita escrita do super admin pela RLS.

// Em status != 2xx o invoke() devolve data null e uma mensagem genérica — o
// motivo real ("e-mail já em uso") só existe no corpo, pendurado no erro.
async function callCompanyTeam(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("company-team", { body });
  if (data?.error) throw new Error(String(data.error));
  if (error) {
    const res = (error as { context?: unknown }).context;
    if (res instanceof Response) {
      const parsed = (await res.clone().json().catch(() => null)) as { error?: string } | null;
      if (parsed?.error) throw new Error(parsed.error);
    }
    throw new Error(error.message);
  }
  return (data ?? {}) as Record<string, unknown>;
}

export type CreateTeamMemberInput = {
  companyId: string;
  fullName: string;
  email: string;
  password: string;
  role: TeamRole;
};

export type UpdateTeamMemberInput = {
  companyId: string;
  userId: string;
  role?: TeamRole;
  fullName?: string;
  password?: string;
};

export function useCreateTeamMemberMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTeamMemberInput) =>
      callCompanyTeam({
        action: "create",
        company_id: input.companyId,
        full_name: input.fullName,
        email: input.email,
        password: input.password,
        role: input.role,
      }),
    onSuccess: (_, { companyId }) =>
      queryClient.invalidateQueries({ queryKey: companyTeamQueryKey(companyId) }),
  });
}

export function useUpdateTeamMemberMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTeamMemberInput) =>
      callCompanyTeam({
        action: "update",
        company_id: input.companyId,
        user_id: input.userId,
        ...(input.role ? { role: input.role } : {}),
        ...(input.fullName !== undefined ? { full_name: input.fullName } : {}),
        ...(input.password ? { password: input.password } : {}),
      }),
    onSuccess: (_, { companyId }) =>
      queryClient.invalidateQueries({ queryKey: companyTeamQueryKey(companyId) }),
  });
}

export function useRemoveTeamMemberMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { companyId: string; userId: string }) =>
      callCompanyTeam({ action: "remove", company_id: input.companyId, user_id: input.userId }),
    onSuccess: (_, { companyId }) =>
      queryClient.invalidateQueries({ queryKey: companyTeamQueryKey(companyId) }),
  });
}

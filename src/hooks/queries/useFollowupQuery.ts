import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FollowupLog, FollowupStep, FollowupStepDraft } from "@/lib/types";

export function followupStepsQueryKey(companyId: string | undefined) {
  return ["followup-steps", companyId] as const;
}

export function followupLogsQueryKey(companyId: string | undefined) {
  return ["followup-logs", companyId] as const;
}

export function useFollowupStepsQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: followupStepsQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("followup_steps")
        .select("*")
        .eq("company_id", companyId)
        .order("step_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as FollowupStep[];
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });
}

/** Substitui a cadência inteira; a ordem do array vira o step_order. */
export function useSaveFollowupStepsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      companyId,
      steps,
    }: {
      companyId: string;
      steps: FollowupStepDraft[];
    }) => {
      const { error } = await supabase.rpc("save_followup_steps", {
        p_company_id: companyId,
        p_steps: steps,
      });
      if (error) throw error;
    },
    onSuccess: (_, { companyId }) => {
      void queryClient.invalidateQueries({ queryKey: followupStepsQueryKey(companyId) });
    },
  });
}

export function useFollowupLogsQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: followupLogsQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("followup_logs")
        .select("*, contacts(id, name, phone)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as FollowupLog[];
    },
    enabled: !!companyId,
    staleTime: 15_000,
  });
}

export interface RunFollowupResult {
  sent: number;
  failed: number;
  skipped: number;
  reason: string | null;
}

/**
 * Roda a cadência agora para a empresa do usuário. O agendador chama a mesma
 * function periodicamente; aqui é para testar sem esperar o próximo ciclo.
 */
export function useRunFollowupMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    // A empresa é resolvida no backend pelo JWT; o id serve só para invalidar
    // o histórico depois.
    mutationFn: async (_companyId: string) => {
      const { data, error } = await supabase.functions.invoke("sdr-followup", { body: {} });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error as string);
      return data as RunFollowupResult;
    },
    onSuccess: (_, companyId) => {
      void queryClient.invalidateQueries({ queryKey: followupLogsQueryKey(companyId) });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Appointment } from "@/lib/types";

/** Faixa visível no calendário (ISO). A agenda nunca carrega a tabela inteira. */
export type AppointmentRange = { from: string; to: string };

export function appointmentsQueryKey(companyId: string | undefined, range?: AppointmentRange) {
  return ["appointments", companyId, range?.from ?? null, range?.to ?? null] as const;
}

export function useAppointmentsQuery(companyId: string | undefined, range?: AppointmentRange) {
  return useQuery({
    queryKey: appointmentsQueryKey(companyId, range),
    queryFn: async () => {
      if (!companyId) return [];
      let query = supabase.from("appointments").select("*").eq("company_id", companyId);
      if (range) query = query.gte("starts_at", range.from).lt("starts_at", range.to);
      const { data, error } = await query.order("starts_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Appointment[];
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });
}

// As mutations invalidam ["appointments", companyId], que casa por prefixo com
// todas as faixas já carregadas — mudar de mês não deixa dado velho para trás.
function invalidate(queryClient: ReturnType<typeof useQueryClient>, companyId: string) {
  void queryClient.invalidateQueries({ queryKey: ["appointments", companyId] });
}

export function useCreateAppointmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      user_id: string;
      company_id: string;
      title: string;
      starts_at: string;
      ends_at?: string | null;
      all_day?: boolean;
      kind?: Appointment["kind"];
      description?: string | null;
      location?: string | null;
      contact_id?: string | null;
    }) => {
      const { error } = await supabase.from("appointments").insert(payload);
      if (error) throw error;
    },
    onSuccess: (_, payload) => invalidate(queryClient, payload.company_id),
  });
}

export function useUpdateAppointmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      company_id,
      ...patch
    }: { id: string; company_id: string } & Partial<Appointment>) => {
      const { error } = await supabase
        .from("appointments")
        .update(patch)
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => invalidate(queryClient, company_id),
  });
}

export function useDeleteAppointmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase
        .from("appointments")
        .delete()
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => invalidate(queryClient, company_id),
  });
}

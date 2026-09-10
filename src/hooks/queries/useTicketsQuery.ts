import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Ticket, TicketPriority, TicketStatus } from "@/lib/types";

export function ticketsQueryKey(companyId: string | undefined) {
  return ["tickets", companyId] as const;
}

/** Chamados da empresa, mais recentes primeiro. */
export function useTicketsQuery(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ticketsQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("tickets")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Ticket[];
    },
    enabled: enabled && !!companyId,
    staleTime: 15_000,
  });
}

export function useCreateTicketMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      company_id: string;
      contact_id: string | null;
      title: string;
      description?: string | null;
      category?: string | null;
      priority?: TicketPriority;
      status?: TicketStatus;
      assigned_to?: string | null;
      due_at?: string | null;
    }) => {
      const { data, error } = await supabase.from("tickets").insert(payload).select("*").maybeSingle();
      if (error) throw error;
      return data as Ticket | null;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: ticketsQueryKey(company_id) });
    },
  });
}

export function useUpdateTicketMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      company_id,
      ...patch
    }: { id: string; company_id: string } & Partial<
      Pick<Ticket, "status" | "priority" | "assigned_to" | "due_at" | "title" | "description" | "category" | "contact_id">
    >) => {
      const { error } = await supabase.from("tickets").update(patch).eq("id", id).eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: ticketsQueryKey(company_id) });
    },
  });
}

export function useDeleteTicketMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase.from("tickets").delete().eq("id", id).eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: ticketsQueryKey(company_id) });
    },
  });
}

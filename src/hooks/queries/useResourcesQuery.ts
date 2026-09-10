import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Resource, WaitlistEntry } from "@/lib/types";

// ── Recursos da agenda ──────────────────────────────────────────────────────

export function resourcesQueryKey(companyId: string | undefined) {
  return ["resources", companyId] as const;
}

/** Profissionais, salas e equipamentos que um compromisso ocupa. */
export function useResourcesQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: resourcesQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("resources")
        .select("*")
        .eq("company_id", companyId)
        .order("position", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Resource[];
    },
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });
}

export function useSaveResourceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: {
      id: string | null;
      company_id: string;
      name: string;
      kind: Resource["kind"];
      active?: boolean;
      position?: number;
    }) => {
      const { error } = id
        ? await supabase.from("resources").update(payload).eq("id", id).eq("company_id", payload.company_id)
        : await supabase.from("resources").insert(payload);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: resourcesQueryKey(company_id) });
    },
  });
}

export function useDeleteResourceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase.from("resources").delete().eq("id", id).eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: resourcesQueryKey(company_id) });
      void queryClient.invalidateQueries({ queryKey: ["appointments", company_id] });
    },
  });
}

// ── Lista de espera ─────────────────────────────────────────────────────────

export function waitlistQueryKey(companyId: string | undefined) {
  return ["waitlist", companyId] as const;
}

export function useWaitlistQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: waitlistQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("waitlist")
        .select("*")
        .eq("company_id", companyId)
        .eq("status", "aguardando")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WaitlistEntry[];
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });
}

export function useAddToWaitlistMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      company_id: string;
      contact_id: string;
      resource_id?: string | null;
      notes?: string | null;
    }) => {
      const { error } = await supabase.from("waitlist").insert(payload);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: waitlistQueryKey(company_id) });
    },
  });
}

export function useSetWaitlistStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id, status }: { id: string; company_id: string; status: WaitlistEntry["status"] }) => {
      const { error } = await supabase.from("waitlist").update({ status }).eq("id", id).eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: waitlistQueryKey(company_id) });
    },
  });
}

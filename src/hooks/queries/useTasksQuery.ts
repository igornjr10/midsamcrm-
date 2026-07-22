import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Task } from "@/lib/types";

export function tasksQueryKey(companyId: string | undefined) {
  return ["tasks", companyId] as const;
}

export function useTasksQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: tasksQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("company_id", companyId)
        .order("due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Task[];
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });
}

export function useCreateTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      user_id: string;
      company_id: string;
      title: string;
      description?: string | null;
      due_at?: string | null;
      contact_id?: string | null;
    }) => {
      const { error } = await supabase.from("tasks").insert(payload);
      if (error) throw error;
    },
    onSuccess: (_, payload) => {
      void queryClient.invalidateQueries({ queryKey: tasksQueryKey(payload.company_id) });
    },
  });
}

export function useUpdateTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id, ...patch }: { id: string; company_id: string } & Partial<Task>) => {
      const { error } = await supabase
        .from("tasks")
        .update(patch)
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: tasksQueryKey(company_id) });
    },
  });
}

export function useDeleteTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase.from("tasks").delete().eq("id", id).eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: tasksQueryKey(company_id) });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Task } from "@/lib/types";

export function tasksQueryKey(userId: string | undefined) {
  return ["tasks", userId] as const;
}

export function useTasksQuery(userId: string | undefined) {
  return useQuery({
    queryKey: tasksQueryKey(userId),
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .order("due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Task[];
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}

export function useCreateTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      user_id: string;
      title: string;
      description?: string | null;
      due_at?: string | null;
      contact_id?: string | null;
    }) => {
      const { error } = await supabase.from("tasks").insert(payload);
      if (error) throw error;
    },
    onSuccess: (_, payload) => {
      void queryClient.invalidateQueries({ queryKey: tasksQueryKey(payload.user_id) });
    },
  });
}

export function useUpdateTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, user_id, ...patch }: { id: string; user_id: string } & Partial<Task>) => {
      const { error } = await supabase
        .from("tasks")
        .update(patch)
        .eq("id", id)
        .eq("user_id", user_id);
      if (error) throw error;
    },
    onSuccess: (_, { user_id }) => {
      void queryClient.invalidateQueries({ queryKey: tasksQueryKey(user_id) });
    },
  });
}

export function useDeleteTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, user_id }: { id: string; user_id: string }) => {
      const { error } = await supabase.from("tasks").delete().eq("id", id).eq("user_id", user_id);
      if (error) throw error;
    },
    onSuccess: (_, { user_id }) => {
      void queryClient.invalidateQueries({ queryKey: tasksQueryKey(user_id) });
    },
  });
}

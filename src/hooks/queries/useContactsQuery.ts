import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Contact } from "@/lib/types";

export function contactsQueryKey(userId: string | undefined) {
  return ["contacts", userId] as const;
}

export function useContactsQuery(userId: string | undefined) {
  return useQuery({
    queryKey: contactsQueryKey(userId),
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Contact[];
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}

export function useCreateContactMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { user_id: string; name: string; phone?: string | null; email?: string | null; stage?: string; notes?: string | null }) => {
      const { data, error } = await supabase
        .from("contacts")
        .insert(payload)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as Contact | null;
    },
    onSuccess: (_, payload) => {
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey(payload.user_id) });
    },
  });
}

export function useUpdateContactMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, user_id, ...patch }: { id: string; user_id: string } & Partial<Contact>) => {
      const { error } = await supabase
        .from("contacts")
        .update(patch)
        .eq("id", id)
        .eq("user_id", user_id);
      if (error) throw error;
    },
    onSuccess: (_, { user_id }) => {
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey(user_id) });
    },
  });
}

export function useDeleteContactMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, user_id }: { id: string; user_id: string }) => {
      const { error } = await supabase
        .from("contacts")
        .delete()
        .eq("id", id)
        .eq("user_id", user_id);
      if (error) throw error;
    },
    onSuccess: (_, { user_id }) => {
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey(user_id) });
    },
  });
}

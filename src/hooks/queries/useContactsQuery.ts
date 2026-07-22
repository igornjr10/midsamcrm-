import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Contact } from "@/lib/types";

export function contactsQueryKey(companyId: string | undefined) {
  return ["contacts", companyId] as const;
}

export function useContactsQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: contactsQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Contact[];
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });
}

export function useCreateContactMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      user_id: string;
      company_id: string;
      name: string;
      phone?: string | null;
      email?: string | null;
      stage?: string;
      notes?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("contacts")
        .insert(payload)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as Contact | null;
    },
    onSuccess: (_, payload) => {
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey(payload.company_id) });
    },
  });
}

export function useUpdateContactMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id, ...patch }: { id: string; company_id: string } & Partial<Contact>) => {
      const { error } = await supabase
        .from("contacts")
        .update(patch)
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey(company_id) });
    },
  });
}

export function useDeleteContactMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase
        .from("contacts")
        .delete()
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey(company_id) });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ContactTag } from "@/lib/types";
import { contactsQueryKey } from "./useContactsQuery";

/**
 * Catálogo de etiquetas da empresa. O contato guarda os nomes em
 * contacts.tags; renomear ou excluir aqui propaga por trigger no banco.
 */
export function contactTagsQueryKey(companyId: string | undefined) {
  return ["contact-tags", companyId] as const;
}

export function useContactTagsQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: contactTagsQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("contact_tags")
        .select("*")
        .eq("company_id", companyId)
        .order("position", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ContactTag[];
    },
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });
}

export function useCreateContactTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      company_id: string;
      name: string;
      tone: ContactTag["tone"];
      escalate?: boolean;
      position: number;
    }) => {
      const { error } = await supabase.from("contact_tags").insert(payload);
      if (error) {
        if (error.code === "23505") throw new Error("Já existe uma etiqueta com esse nome.");
        throw error;
      }
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: contactTagsQueryKey(company_id) });
    },
  });
}

export function useUpdateContactTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      company_id,
      ...patch
    }: { id: string; company_id: string } & Partial<Pick<ContactTag, "name" | "tone" | "escalate" | "position">>) => {
      const { error } = await supabase
        .from("contact_tags")
        .update(patch)
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) {
        if (error.code === "23505") throw new Error("Já existe uma etiqueta com esse nome.");
        throw error;
      }
    },
    onSuccess: (_, { company_id, name }) => {
      void queryClient.invalidateQueries({ queryKey: contactTagsQueryKey(company_id) });
      // Renomear muda o array de todos os contatos que a tinham.
      if (name !== undefined) void queryClient.invalidateQueries({ queryKey: contactsQueryKey(company_id) });
    },
  });
}

export function useDeleteContactTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase
        .from("contact_tags")
        .delete()
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: contactTagsQueryKey(company_id) });
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey(company_id) });
    },
  });
}

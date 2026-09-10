import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ContactField } from "@/lib/types";

/**
 * Campos personalizados do contato, por empresa.
 *
 * Nascem do modelo do nicho (apply_niche_template) e a empresa pode criar os
 * seus. O valor de cada campo vive em contacts.fields, chegando junto com o
 * contato — aqui só as definições.
 */
export function contactFieldsQueryKey(companyId: string | undefined) {
  return ["contact-fields", companyId] as const;
}

export function useContactFieldsQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: contactFieldsQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("contact_fields")
        .select("*")
        .eq("company_id", companyId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ContactField[];
    },
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });
}

export function useCreateContactFieldMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      company_id: string;
      key: string;
      label: string;
      type: ContactField["type"];
      options?: string[];
      show_on_card?: boolean;
      position: number;
    }) => {
      const { error } = await supabase.from("contact_fields").insert(payload);
      if (error) {
        // A chave vem do nome: dois campos "Vencimento" colidem. Dizer isso é
        // melhor que "duplicate key value violates unique constraint".
        if (error.code === "23505") throw new Error("Já existe um campo com esse nome.");
        throw error;
      }
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: contactFieldsQueryKey(company_id) });
    },
  });
}

export function useUpdateContactFieldMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      company_id,
      ...patch
    }: { id: string; company_id: string } & Partial<Omit<ContactField, "id" | "company_id" | "key">>) => {
      const { error } = await supabase
        .from("contact_fields")
        .update(patch)
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: contactFieldsQueryKey(company_id) });
    },
  });
}

export function useDeleteContactFieldMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase
        .from("contact_fields")
        .delete()
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: contactFieldsQueryKey(company_id) });
    },
  });
}

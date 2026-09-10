import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ContactRecord, RecordType } from "@/lib/types";

// ── Tipos de registro ───────────────────────────────────────────────────────

export function recordTypesQueryKey(companyId: string | undefined) {
  return ["record-types", companyId] as const;
}

/** Apólice, Pacote, Unidade: o que a empresa anota "por baixo" do contato. */
export function useRecordTypesQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: recordTypesQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("record_types")
        .select("*")
        .eq("company_id", companyId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RecordType[];
    },
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });
}

export function useCreateRecordTypeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      company_id: string;
      key: string;
      label: string;
      label_plural: string;
      fields: RecordType["fields"];
      date_field_key: string | null;
      position: number;
    }) => {
      const { error } = await supabase.from("record_types").insert(payload);
      if (error) {
        if (error.code === "23505") throw new Error("Já existe um tipo de registro com esse nome.");
        throw error;
      }
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: recordTypesQueryKey(company_id) });
    },
  });
}

export function useUpdateRecordTypeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      company_id,
      ...patch
    }: { id: string; company_id: string } & Partial<
      Pick<RecordType, "label" | "label_plural" | "fields" | "date_field_key" | "position">
    >) => {
      const { error } = await supabase
        .from("record_types")
        .update(patch)
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id, date_field_key }) => {
      void queryClient.invalidateQueries({ queryKey: recordTypesQueryKey(company_id) });
      // Trocar a data principal recalcula main_date de todos os registros.
      if (date_field_key !== undefined) {
        void queryClient.invalidateQueries({ queryKey: contactRecordsQueryKey(company_id) });
      }
    },
  });
}

export function useDeleteRecordTypeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase
        .from("record_types")
        .delete()
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: recordTypesQueryKey(company_id) });
    },
  });
}

// ── Registros ───────────────────────────────────────────────────────────────

export function contactRecordsQueryKey(companyId: string | undefined) {
  return ["contact-records", companyId] as const;
}

/**
 * Todos os registros da empresa, de uma vez. A base é pequena (poucos por
 * contato) e a tela de lista ordenada por vencimento precisa de todos mesmo.
 */
export function useContactRecordsQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: contactRecordsQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("contact_records")
        .select("*")
        .eq("company_id", companyId)
        .order("main_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContactRecord[];
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

export function useSaveContactRecordMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: {
      id: string | null;
      company_id: string;
      contact_id: string;
      type_key: string;
      title: string;
      fields: ContactRecord["fields"];
    }) => {
      const { error } = id
        ? await supabase.from("contact_records").update(payload).eq("id", id).eq("company_id", payload.company_id)
        : await supabase.from("contact_records").insert(payload);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: contactRecordsQueryKey(company_id) });
    },
  });
}

export function useDeleteContactRecordMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase
        .from("contact_records")
        .delete()
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: contactRecordsQueryKey(company_id) });
    },
  });
}

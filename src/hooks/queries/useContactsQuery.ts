import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Contact } from "@/lib/types";
import { fetchAllPages } from "./paginate";

export function contactsQueryKey(companyId: string | undefined) {
  return ["contacts", companyId] as const;
}

export function useContactsQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: contactsQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      return fetchAllPages<Contact>((from, to) =>
        supabase
          .from("contacts")
          .select("*")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      );
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });
}

/**
 * Assina as mudanças de contato da empresa e invalida a lista.
 *
 * Mora fora do useContactsQuery e é chamado UMA vez, no AppLayout: o Pipeline
 * monta o hook de contatos duas vezes (a página e o diálogo de etapas), e dois
 * canais com o mesmo nome estouram dentro do efeito — o React derruba a árvore
 * e a tela fica preta.
 *
 * Serve para o que muda sem ninguém clicar: o trigger do banco carimba o
 * pagamento e move a etapa quando o lead manda o comprovante.
 */
export function useContactsRealtime(companyId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!companyId) return;

    const channel = supabase
      .channel(`contacts-${companyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "contacts", filter: `company_id=eq.${companyId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: contactsQueryKey(companyId) });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);
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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { QuickReply } from "@/lib/types";

/** Respostas prontas do chat: "/" abre a lista. A IA lê como informação oficial. */
export function quickRepliesQueryKey(companyId: string | undefined) {
  return ["quick-replies", companyId] as const;
}

export function useQuickRepliesQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: quickRepliesQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("quick_replies")
        .select("*")
        .eq("company_id", companyId)
        .order("position", { ascending: true })
        .order("shortcut", { ascending: true });
      if (error) throw error;
      return (data ?? []) as QuickReply[];
    },
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });
}

/** "/Horário de Atendimento" -> "horario-de-atendimento". */
export function shortcutFromText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

export function useSaveQuickReplyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: {
      id: string | null;
      company_id: string;
      shortcut: string;
      title: string;
      content: string;
      position: number;
    }) => {
      const { error } = id
        ? await supabase.from("quick_replies").update(payload).eq("id", id).eq("company_id", payload.company_id)
        : await supabase.from("quick_replies").insert(payload);
      if (error) {
        if (error.code === "23505") throw new Error("Já existe uma resposta com esse atalho.");
        throw error;
      }
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: quickRepliesQueryKey(company_id) });
    },
  });
}

export function useDeleteQuickReplyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase
        .from("quick_replies")
        .delete()
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: quickRepliesQueryKey(company_id) });
    },
  });
}

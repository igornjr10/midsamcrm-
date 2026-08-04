import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Conversation } from "@/lib/types";
import { fetchAllPages } from "./paginate";

export function conversationsQueryKey(companyId: string | undefined, contactId: string | undefined) {
  return ["conversations", companyId, contactId] as const;
}

export function lastMessagesQueryKey(companyId: string | undefined) {
  return ["last-messages", companyId] as const;
}

// Quantas mensagens a janela do chat carrega. Não puxamos o histórico inteiro
// porque ele é ilimitado e recarrega a cada troca de contato.
const CHAT_WINDOW = 500;

// Mensagens de um contato específico, com assinatura realtime para o chat.
export function useConversationsQuery(companyId: string | undefined, contactId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: conversationsQueryKey(companyId, contactId),
    queryFn: async () => {
      if (!companyId || !contactId) return [];
      // Busca as mais recentes (desc) e reordena: com `ascending` o limite
      // pegava as 500 mais ANTIGAS e o chat ficava sem as mensagens de hoje.
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("company_id", companyId)
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(CHAT_WINDOW);
      if (error) throw error;
      return ((data ?? []) as Conversation[]).reverse();
    },
    enabled: !!companyId && !!contactId,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!companyId || !contactId) return;

    const channel = supabase
      .channel(`conversations-${contactId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations", filter: `contact_id=eq.${contactId}` },
        (payload) => {
          const message = payload.new as Conversation;
          queryClient.setQueryData<Conversation[]>(
            conversationsQueryKey(companyId, contactId),
            (prev) => {
              if (!prev) return [message];
              if (prev.some((m) => m.id === message.id)) return prev;
              return [...prev, message];
            },
          );
          void queryClient.invalidateQueries({ queryKey: lastMessagesQueryKey(companyId) });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId, contactId, queryClient]);

  return query;
}

// Última mensagem por contato — para a lista de conversas mostrar prévia/hora.
export function useLastMessagesQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: lastMessagesQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return new Map<string, Conversation>();
      // Reduzido no banco (ver 0012_last_messages.sql): ler as N conversas mais
      // recentes e deduplicar aqui deixava sem prévia todo contato cuja última
      // mensagem ficasse fora da janela.
      // A resposta da function também passa pelo teto de linhas do PostgREST,
      // então paginamos: uma empresa pode ter mais de 1000 contatos com conversa.
      const rows = await fetchAllPages<Conversation>((from, to) =>
        supabase
          .rpc("last_messages_by_contact", { p_company_id: companyId })
          .order("contact_id", { ascending: true })
          .range(from, to),
      );
      const byContact = new Map<string, Conversation>();
      for (const row of rows) {
        byContact.set(row.contact_id, row);
      }
      return byContact;
    },
    enabled: !!companyId,
    staleTime: 15_000,
  });
}

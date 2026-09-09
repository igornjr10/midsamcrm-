import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useContactsQuery } from "./useContactsQuery";

/**
 * Lido / não lido por atendente.
 *
 * Não existe contador guardado: o não lido é a comparação entre a última
 * mensagem recebida do lead (contacts.last_inbound_at, mantida por trigger) e a
 * marca de leitura deste atendente. Um contador em coluna teria que ser
 * incrementado no webhook e zerado na tela, e sairia de sincronia no primeiro
 * erro de rede.
 */
export function conversationReadsQueryKey(companyId: string | undefined, userId: string | undefined) {
  return ["conversation-reads", companyId, userId] as const;
}

export function useConversationReadsQuery(companyId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: conversationReadsQueryKey(companyId, userId),
    queryFn: async () => {
      if (!companyId || !userId) return new Map<string, string>();
      const { data, error } = await supabase
        .from("conversation_reads")
        .select("contact_id, last_read_at")
        .eq("company_id", companyId)
        .eq("user_id", userId);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const row of (data ?? []) as Array<{ contact_id: string; last_read_at: string }>) {
        map.set(row.contact_id, row.last_read_at);
      }
      return map;
    },
    enabled: !!companyId && !!userId,
    staleTime: 30_000,
  });
}

export function useMarkConversationReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { company_id: string; user_id: string; contact_id: string }) => {
      const readAt = new Date().toISOString();
      const { error } = await supabase
        .from("conversation_reads")
        .upsert({ ...payload, last_read_at: readAt }, { onConflict: "user_id,contact_id" });
      if (error) throw error;
      return readAt;
    },
    // Otimista: a bolinha some no clique. Esperar a ida ao banco deixaria a
    // conversa aberta marcada como não lida por meio segundo.
    onSuccess: (readAt, { company_id, user_id, contact_id }) => {
      queryClient.setQueryData<Map<string, string>>(
        conversationReadsQueryKey(company_id, user_id),
        (prev) => new Map(prev ?? []).set(contact_id, readAt),
      );
    },
  });
}

/**
 * Quais conversas têm mensagem que este atendente ainda não viu.
 *
 * Contato sem marca nenhuma conta como não lido se o lead já falou alguma vez —
 * é o caso de quem entrou na empresa hoje e encontra a fila do jeito que está.
 */
export function useUnreadContacts(companyId: string | undefined, userId: string | undefined) {
  const { data: contacts = [] } = useContactsQuery(companyId);
  const { data: reads } = useConversationReadsQuery(companyId, userId);

  return useMemo(() => {
    const unread = new Set<string>();
    for (const contact of contacts) {
      if (!contact.last_inbound_at) continue;
      const readAt = reads?.get(contact.id);
      if (!readAt || Date.parse(contact.last_inbound_at) > Date.parse(readAt)) {
        unread.add(contact.id);
      }
    }
    return { unread, count: unread.size };
  }, [contacts, reads]);
}

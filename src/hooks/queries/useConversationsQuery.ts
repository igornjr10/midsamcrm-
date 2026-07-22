import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Conversation } from "@/lib/types";

export function conversationsQueryKey(companyId: string | undefined, contactId: string | undefined) {
  return ["conversations", companyId, contactId] as const;
}

export function lastMessagesQueryKey(companyId: string | undefined) {
  return ["last-messages", companyId] as const;
}

// Mensagens de um contato específico, com assinatura realtime para o chat.
export function useConversationsQuery(companyId: string | undefined, contactId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: conversationsQueryKey(companyId, contactId),
    queryFn: async () => {
      if (!companyId || !contactId) return [];
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("company_id", companyId)
        .eq("contact_id", contactId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Conversation[];
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
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const byContact = new Map<string, Conversation>();
      for (const row of (data ?? []) as Conversation[]) {
        if (!byContact.has(row.contact_id)) byContact.set(row.contact_id, row);
      }
      return byContact;
    },
    enabled: !!companyId,
    staleTime: 15_000,
  });
}

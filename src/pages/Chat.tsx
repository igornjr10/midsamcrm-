import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useContactsQuery, useConversationsQuery, useLastMessagesQuery, useWhatsappConfigQuery } from "@/hooks/queries";
import type { Contact } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

function timeLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default function Chat() {
  const { user, session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedContactId = searchParams.get("contato");

  const { data: contacts = [] } = useContactsQuery(user?.id);
  const { data: lastMessages } = useLastMessagesQuery(user?.id);
  const { data: messages = [] } = useConversationsQuery(user?.id, selectedContactId ?? undefined);
  const { data: whatsappConfig } = useWhatsappConfigQuery(user?.id);

  const [search, setSearch] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedContact: Contact | null =
    contacts.find((c) => c.id === selectedContactId) ?? null;

  const orderedContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contacts
      .filter((c) => !term || c.name.toLowerCase().includes(term) || c.phone?.includes(term))
      .slice()
      .sort((a, b) => {
        const aTime = lastMessages?.get(a.id)?.created_at ?? a.created_at;
        const bTime = lastMessages?.get(b.id)?.created_at ?? b.created_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });
  }, [contacts, lastMessages, search]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, selectedContactId]);

  const handleSend = async () => {
    if (!selectedContact || !newMessage.trim() || !session) return;
    if (!selectedContact.phone) {
      toast.error("Este contato não tem telefone cadastrado.");
      return;
    }
    if (!whatsappConfig) {
      toast.error("Conecte seu WhatsApp em Configurações antes de enviar.");
      return;
    }

    const text = newMessage.trim();
    setSending(true);
    setNewMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send?action=send-text", {
        body: { phone: selectedContact.phone, text, contact_id: selectedContact.id },
      });
      if (error || (data && data.success === false)) {
        throw new Error((data?.error as string) || error?.message || "Falha ao enviar");
      }
    } catch (err) {
      setNewMessage(text);
      toast.error(err instanceof Error ? err.message : "Erro ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-4">
      {/* Lista de conversas */}
      <div className="flex w-72 flex-shrink-0 flex-col rounded-lg border">
        <div className="border-b p-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar contato..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {orderedContacts.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Nenhum contato</p>
          ) : (
            orderedContacts.map((contact) => {
              const last = lastMessages?.get(contact.id);
              return (
                <button
                  key={contact.id}
                  onClick={() => setSearchParams({ contato: contact.id })}
                  className={cn(
                    "flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left transition-colors hover:bg-accent/50",
                    selectedContactId === contact.id && "bg-accent",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{contact.name}</span>
                    {last && (
                      <span className="flex-shrink-0 text-[10px] text-muted-foreground">
                        {timeLabel(last.created_at)}
                      </span>
                    )}
                  </div>
                  <span className="truncate text-xs text-muted-foreground">
                    {last ? last.content : "Sem mensagens"}
                  </span>
                </button>
              );
            })
          )}
        </ScrollArea>
      </div>

      {/* Thread */}
      <div className="flex flex-1 flex-col rounded-lg border">
        {!selectedContact ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Selecione um contato para conversar
          </div>
        ) : (
          <>
            <div className="border-b px-4 py-3">
              <p className="font-semibold">{selectedContact.name}</p>
              <p className="text-xs text-muted-foreground">{selectedContact.phone ?? "Sem telefone"}</p>
            </div>
            <ScrollArea className="flex-1 p-4">
              <div className="flex min-h-full flex-col justify-end gap-2">
                {messages.map((m) => {
                  const isOutgoing = m.sender === "user";
                  const mediaUrl = m.metadata?.mediaUrl as string | undefined;
                  const mediaType = m.metadata?.mediaType as string | undefined;
                  return (
                    <div key={m.id} className={cn("flex", isOutgoing ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[70%] rounded-2xl px-3.5 py-2 text-sm",
                          isOutgoing
                            ? "rounded-br-md bg-primary text-primary-foreground"
                            : "rounded-bl-md bg-muted",
                        )}
                      >
                        {mediaUrl && mediaType === "image" && (
                          <img src={mediaUrl} alt="" className="mb-1 max-h-64 rounded-lg" />
                        )}
                        {mediaUrl && mediaType === "document" && (
                          <a href={mediaUrl} target="_blank" rel="noreferrer" className="mb-1 block underline">
                            Abrir documento
                          </a>
                        )}
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                        <p className="mt-1 text-[10px] opacity-60">{timeLabel(m.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && (
                  <p className="py-12 text-center text-sm text-muted-foreground">Nenhuma mensagem ainda</p>
                )}
                <div ref={scrollRef} />
              </div>
            </ScrollArea>
            <div className="flex gap-2 border-t p-3">
              <Input
                placeholder="Digite uma mensagem..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void handleSend()}
                disabled={sending}
              />
              <Button size="icon" onClick={() => void handleSend()} disabled={sending || !newMessage.trim()}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

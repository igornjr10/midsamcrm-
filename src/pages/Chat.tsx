import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Send, Search, Loader2, Bot, Play, FileText, MessagesSquare, Mic, Library, Paperclip,
  ArrowLeft, Hand, UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { supabase, SUPABASE_URL } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactsQuery,
  useConversationsQuery,
  useLastMessagesQuery,
  useWhatsappConfigQuery,
  useUpdateContactMutation,
  usePipelineStagesQuery,
  useLibraryQuery,
  useAiConfigQuery,
  useUnreadContacts,
  useMarkConversationReadMutation,
  useCompanyTeamQuery,
} from "@/hooks/queries";
import {
  getStageLabel, getStageTone, getToneClasses, LIBRARY_KINDS, teamLabel,
  type Contact, type LibraryItem,
} from "@/lib/types";
import SendTemplateDialog from "@/components/chat/SendTemplateDialog";
import ContactPanel from "@/components/chat/ContactPanel";
import ChatOverview from "@/components/chat/ChatOverview";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function timeLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default function Chat() {
  const { user, company, session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedContactId = searchParams.get("contato");

  const { data: contacts = [] } = useContactsQuery(company?.id);
  const { data: lastMessages } = useLastMessagesQuery(company?.id);
  const { data: messages = [] } = useConversationsQuery(company?.id, selectedContactId ?? undefined);
  const { data: whatsappConfig } = useWhatsappConfigQuery(company?.id);
  const { data: stages = [] } = usePipelineStagesQuery(company?.id);
  const { data: library = [] } = useLibraryQuery(company?.id);
  const { data: aiConfig } = useAiConfigQuery(company?.id);
  const updateContact = useUpdateContactMutation();
  const { unread } = useUnreadContacts(company?.id, user?.id);
  const markRead = useMarkConversationReadMutation();
  const { data: team = [] } = useCompanyTeamQuery(company?.id);

  const activeLibrary = useMemo(() => library.filter((i) => i.active), [library]);

  const [search, setSearch] = useState("");
  // "livres" é a fila de quem ainda não tem dono — o que sobra para alguém
  // pegar. Com um atendente só, os três filtros dão quase a mesma lista e o
  // padrão "todos" não atrapalha ninguém.
  const [fila, setFila] = useState<"todos" | "meus" | "livres">("todos");
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const attachInput = useRef<HTMLInputElement>(null);

  const selectedContact: Contact | null =
    contacts.find((c) => c.id === selectedContactId) ?? null;
  const assignedMember = team.find((m) => m.user_id === selectedContact?.assigned_to) ?? null;

  // A IA também cala em negócio fechado, e isso não passa por ai_paused: é a
  // etapa que decide, a cada mensagem. Sem dizer aqui, some sem explicação.
  const selectedStage = stages.find((s) => s.key === selectedContact?.stage);
  const silencedByStage =
    !!aiConfig?.enabled &&
    (aiConfig.ai_only_open_stages ?? true) &&
    !!selectedStage &&
    selectedStage.kind !== "open";

  const orderedContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contacts
      .filter((c) => !term || c.name.toLowerCase().includes(term) || c.phone?.includes(term))
      .filter((c) => {
        if (fila === "meus") return c.assigned_to === user?.id;
        if (fila === "livres") return !c.assigned_to;
        return true;
      })
      .slice()
      .sort((a, b) => {
        const aTime = lastMessages?.get(a.id)?.created_at ?? a.created_at;
        const bTime = lastMessages?.get(b.id)?.created_at ?? b.created_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });
  }, [contacts, lastMessages, search, fila, user?.id]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, selectedContactId]);

  // Abrir a conversa é ler. Depende de messages.length porque a mensagem que
  // chega com a conversa já aberta também foi lida — senão a bolinha de não
  // lido apareceria justamente para quem está com ela na tela.
  //
  // markRead fora das dependências de propósito: a mutation troca de
  // identidade a cada render e o efeito viraria laço.
  useEffect(() => {
    if (!company || !user || !selectedContactId) return;
    markRead.mutate({
      company_id: company.id,
      user_id: user.id,
      contact_id: selectedContactId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id, user?.id, selectedContactId, messages.length]);

  // A etapa do funil é editável aqui pelo mesmo motivo que no Pipeline: quem
  // está atendendo descobre no meio da conversa que o lead avançou.
  const handleStageChange = async (stage: string) => {
    if (!company || !selectedContact) return;
    try {
      await updateContact.mutateAsync({ id: selectedContact.id, company_id: company.id, stage });
      toast.success(`Etapa: ${getStageLabel(stages, stage)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao mudar a etapa");
    }
  };

  // Quem responde por esta conversa. "none" devolve para a fila.
  const handleAssign = async (value: string) => {
    if (!company || !selectedContact) return;
    const assignedTo = value === "none" ? null : value;
    try {
      await updateContact.mutateAsync({
        id: selectedContact.id,
        company_id: company.id,
        assigned_to: assignedTo,
        assigned_at: assignedTo ? new Date().toISOString() : null,
      });
      const dono = team.find((m) => m.user_id === assignedTo);
      toast.success(
        assignedTo
          ? `Conversa com ${assignedTo === user?.id ? "você" : dono ? teamLabel(dono) : "o atendente"}`
          : "Conversa devolvida para a fila",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao definir o responsável");
    }
  };

  // Envia um arquivo da biblioteca para a conversa aberta.
  const handleSendLibrary = async (item: LibraryItem) => {
    if (!selectedContact?.phone || !whatsappConfig) {
      toast.error("Contato sem telefone ou WhatsApp não conectado.");
      return;
    }
    setLibraryOpen(false);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send?action=send-media", {
        body: {
          phone: selectedContact.phone,
          contact_id: selectedContact.id,
          company_id: company?.id,
          mediaUrl: item.file_url,
          mediaType: item.media_type,
          mimetype: item.mimetype,
          caption: item.title,
        },
      });
      if (error || (data && data.success === false)) {
        throw new Error((data?.error as string) || error?.message || "Falha ao enviar");
      }
      toast.success(`"${item.title}" enviado`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar arquivo");
    }
  };

  // Anexo do atendente: sobe para o bucket e manda pela mesma rota de mídia que
  // a biblioteca usa. O caminho começa com o id do usuário porque é isso que a
  // policy do chat-media exige.
  const handleAttach = async (file: File) => {
    if (!selectedContact?.phone || !whatsappConfig || !user) {
      toast.error("Contato sem telefone ou WhatsApp não conectado.");
      return;
    }
    if (file.size > 16 * 1_048_576) {
      toast.error("O WhatsApp não aceita arquivo acima de 16 MB");
      return;
    }

    const mimetype = file.type || "application/octet-stream";
    const mediaType = mimetype.startsWith("image/")
      ? "image"
      : mimetype.startsWith("audio/")
      ? "audio"
      : mimetype.startsWith("video/")
      ? "video"
      : "document";

    setSending(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("chat-media")
        .upload(path, file, { contentType: mimetype, upsert: false });
      if (upErr) throw upErr;

      const { data, error } = await supabase.functions.invoke("whatsapp-send?action=send-media", {
        body: {
          phone: selectedContact.phone,
          contact_id: selectedContact.id,
          company_id: company?.id,
          mediaUrl: `${SUPABASE_URL}/storage/v1/object/public/chat-media/${path}`,
          mediaType,
          mimetype,
          caption: mediaType === "audio" ? "" : file.name,
        },
      });
      if (error || (data && data.success === false)) {
        throw new Error((data?.error as string) || error?.message || "Falha ao enviar");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar arquivo");
    } finally {
      setSending(false);
    }
  };

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
        body: {
          phone: selectedContact.phone,
          text,
          contact_id: selectedContact.id,
          company_id: company?.id,
        },
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
    // Desconta o padding vertical do <main> (p-4 = 2rem, sm:p-6 = 3rem,
    // lg:p-8 = 4rem) e, abaixo de lg, também a barra superior do mobile (3.5rem).
    <div className="flex h-[calc(100vh-5.5rem)] gap-4 sm:h-[calc(100vh-6.5rem)] lg:h-[calc(100vh-4rem)]">
      {/* Lista de conversas. No mobile ocupa a tela inteira e dá lugar à
          conversa quando um contato é aberto — as duas não cabem lado a lado. */}
      <div
        className={cn(
          "flex w-full flex-shrink-0 flex-col overflow-hidden rounded-xl border bg-card shadow-card lg:w-72",
          selectedContact && "hidden lg:flex",
        )}
      >
        <div className="border-b p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar contato..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {/* A fila só faz sentido com mais de uma pessoa atendendo: com um
              atendente só, os três filtros dariam a mesma lista. */}
          {team.length > 1 && (
            <div className="mt-2 flex gap-1">
              {([
                ["todos", "Todos"],
                ["meus", "Meus"],
                ["livres", "Sem dono"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFila(value)}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                    fila === value
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <ScrollArea className="flex-1">
          {orderedContacts.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <MessagesSquare className="mx-auto mb-2 h-7 w-7 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                {search ? "Nenhum contato encontrado" : "Nenhum contato ainda"}
              </p>
            </div>
          ) : (
            <div className="p-2">
              {orderedContacts.map((contact) => {
                const last = lastMessages?.get(contact.id);
                const isSelected = selectedContactId === contact.id;
                // Não lido só faz sentido em conversa fechada: a aberta está
                // sendo lida agora, e piscaria a cada mensagem que chega.
                const isUnread = unread.has(contact.id) && !isSelected;
                return (
                  <button
                    key={contact.id}
                    onClick={() => setSearchParams({ contato: contact.id })}
                    className={cn(
                      "mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                      isSelected ? "bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    <span className="relative shrink-0">
                      <span
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold",
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "bg-primary/10 text-primary",
                        )}
                      >
                        {contact.name.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                      {/* Mesma cor da etiqueta do cabeçalho: dá pra varrer a lista
                          sem abrir cada conversa. */}
                      <span
                        title={getStageLabel(stages, contact.stage)}
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card",
                          getStageTone(stages, contact.stage).dot,
                        )}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-sm",
                            isUnread ? "font-bold" : "font-medium",
                          )}
                        >
                          {contact.name}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {last && (
                            <span className="tabular text-[10px] text-muted-foreground">
                              {timeLabel(last.created_at)}
                            </span>
                          )}
                          {isUnread && <span className="h-2 w-2 rounded-full bg-primary" />}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "block truncate text-xs",
                          isUnread ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {last ? last.content : "Sem mensagens"}
                      </span>
                      {/* O lead pediu uma pessoa e a IA se calou esperando. É o
                          item mais urgente da lista, por isso aparece aqui e
                          não só dentro da conversa. */}
                      {contact.needs_human_at && (
                        <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                          <Hand className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">Pediu atendente</span>
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Thread */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-card",
          // Sem contato aberto, quem manda no mobile é a lista.
          !selectedContact && "hidden lg:flex",
        )}
      >
        {!selectedContact ? (
          <ChatOverview onSelect={(contactId) => setSearchParams({ contato: contactId })} />
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <button
                  onClick={() => setSearchParams({})}
                  aria-label="Voltar para as conversas"
                  className="-ml-2 shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground lg:hidden"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {selectedContact.name.trim().charAt(0).toUpperCase() || "?"}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold leading-tight">{selectedContact.name}</p>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <span className="tabular truncate text-xs text-muted-foreground">
                      {selectedContact.phone ?? "Sem telefone"}
                    </span>
                    <Select value={selectedContact.stage} onValueChange={(v) => void handleStageChange(v)}>
                      <SelectTrigger
                        aria-label="Etapa do funil"
                        className={cn(
                          "h-6 w-auto shrink-0 gap-1.5 rounded-full px-2 text-xs font-medium",
                          getStageTone(stages, selectedContact.stage).badge,
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              getStageTone(stages, selectedContact.stage).dot,
                            )}
                          />
                          {getStageLabel(stages, selectedContact.stage)}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {stages.map((s) => (
                          <SelectItem key={s.id} value={s.key}>
                            <span className="flex items-center gap-2">
                              <span className={cn("h-1.5 w-1.5 rounded-full", getToneClasses(s.tone).dot)} />
                              {s.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Quem responde por esta conversa. Sem dono ela é da fila:
                        todo mundo vê, e é assim que dois atendentes respondem o
                        mesmo lead sem saber. */}
                    <Select
                      value={selectedContact.assigned_to ?? "none"}
                      onValueChange={(v) => void handleAssign(v)}
                    >
                      <SelectTrigger
                        aria-label="Responsável pela conversa"
                        className={cn(
                          "h-6 w-auto shrink-0 gap-1.5 rounded-full px-2 text-xs font-medium",
                          selectedContact.assigned_to
                            ? "border-primary/40 bg-primary/5 text-primary"
                            : "border-dashed text-muted-foreground",
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <UserRound className="h-3 w-3 shrink-0" />
                          {assignedMember
                            ? assignedMember.user_id === user?.id
                              ? "Você"
                              : teamLabel(assignedMember)
                            : "Sem dono"}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem dono (volta para a fila)</SelectItem>
                        {team.map((m) => (
                          <SelectItem key={m.user_id} value={m.user_id}>
                            {m.user_id === user?.id ? `Você · ${teamLabel(m)}` : teamLabel(m)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLibraryOpen(true)}
                  title="Enviar cardápio, orçamento ou outro arquivo da biblioteca"
                >
                  <Library />
                  Arquivo
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTemplateOpen(true)}
                  title="Enviar um template aprovado (necessário fora da janela de 24h)"
                >
                  <FileText />
                  Template
                </Button>
                <Button
                  size="sm"
                  variant={selectedContact.ai_paused ? "default" : "outline"}
                  onClick={() => {
                    if (!company) return;
                    const pausing = !selectedContact.ai_paused;
                    void updateContact.mutateAsync({
                      id: selectedContact.id,
                      company_id: company.id,
                      ai_paused: pausing,
                      // O motivo acompanha o estado: reativar tem que limpar o
                      // "humano_respondeu", senão o aviso continua na tela
                      // dizendo que a IA está parada.
                      ai_paused_at: pausing ? new Date().toISOString() : null,
                      ai_paused_reason: null,
                    });
                  }}
                  title={
                    selectedContact.ai_paused
                      ? "A IA está pausada nesta conversa; clique para reativar"
                      : "Pausar a IA nesta conversa e assumir o atendimento"
                  }
                >
                  {selectedContact.ai_paused ? (
                    <>
                      <Play />
                      Reativar IA
                    </>
                  ) : (
                    <>
                      <Bot />
                      Pausar IA
                    </>
                  )}
                </Button>
              </div>
            </div>
            {/* A IA parou sozinha: sem dizer isso, o silêncio dela parece defeito.
                Um aviso de cada vez — quem assumiu a conversa manda, porque é o
                único dos dois que tem botão para desfazer aqui. */}
            {selectedContact.needs_human_at ? (
              <div className="flex items-center gap-2 border-b bg-rose-500/10 px-4 py-2 text-xs text-rose-700 dark:text-rose-400">
                <Hand className="h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className="font-semibold">O lead pediu uma pessoa</span>
                  {selectedContact.needs_human_reason ? `: ${selectedContact.needs_human_reason}` : "."}{" "}
                  A IA parou de responder e está esperando você. Qualquer mensagem sua encerra o pedido.
                </span>
              </div>
            ) : selectedContact.ai_paused && selectedContact.ai_paused_reason === "humano_respondeu" ? (
              <div className="flex items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
                <Bot className="h-3.5 w-3.5 shrink-0" />
                <span>
                  IA pausada automaticamente porque o time assumiu esta conversa
                  {selectedContact.ai_paused_at ? ` em ${timeLabel(selectedContact.ai_paused_at)}` : ""}.
                  Clique em "Reativar IA" para devolver o atendimento a ela.
                </span>
              </div>
            ) : silencedByStage ? (
              <div className="flex items-center gap-2 border-b bg-muted px-4 py-2 text-xs text-muted-foreground">
                <Bot className="h-3.5 w-3.5 shrink-0" />
                <span>
                  IA em silêncio: o negócio está em "{selectedStage?.name}". Volte o contato para uma
                  etapa aberta se quiser que ela responda de novo.
                </span>
              </div>
            ) : null}
            <ScrollArea className="flex-1 bg-muted/30 p-4">
              <div className="flex min-h-full flex-col justify-end gap-1.5">
                {messages.map((m) => {
                  const isOutgoing = m.sender === "user" || m.sender === "ai";
                  const mediaUrl = m.metadata?.mediaUrl as string | undefined;
                  const mediaType = m.metadata?.mediaType as string | undefined;
                  return (
                    <div key={m.id} className={cn("flex", isOutgoing ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[72%] rounded-2xl px-3.5 py-2 text-sm shadow-card",
                          isOutgoing
                            ? "rounded-br-sm bg-primary text-primary-foreground"
                            : "rounded-bl-sm border border-border/70 bg-card",
                        )}
                      >
                        {isOutgoing && (
                          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider opacity-70">
                            {m.sender === "ai" ? "IA" : "Você"}
                          </p>
                        )}
                        {mediaUrl && mediaType === "image" && (
                          <img src={mediaUrl} alt="" className="mb-1.5 max-h-64 rounded-lg" />
                        )}
                        {mediaUrl && mediaType === "document" && (
                          <a href={mediaUrl} target="_blank" rel="noreferrer" className="mb-1 block underline">
                            Abrir documento
                          </a>
                        )}
                        {mediaUrl && mediaType === "audio" && (
                          <audio controls preload="none" src={mediaUrl} className="mb-1.5 h-9 w-56 max-w-full" />
                        )}
                        {mediaUrl && mediaType === "video" && (
                          <video controls preload="metadata" src={mediaUrl} className="mb-1.5 max-h-64 rounded-lg" />
                        )}
                        {/* Áudio vira texto no webhook; o selo evita ler a
                            transcrição achando que o lead digitou aquilo. */}
                        {m.metadata?.transcribed === true && (
                          <p className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-70">
                            <Mic className="h-3 w-3" />
                            Áudio transcrito
                          </p>
                        )}
                        <p className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>
                        <p className="tabular mt-1 text-right text-[10px] opacity-70">
                          {timeLabel(m.created_at)}
                        </p>
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
            <div className="flex items-center gap-2 border-t p-3">
              <input
                ref={attachInput}
                type="file"
                className="hidden"
                accept="image/*,audio/ogg,audio/mpeg,audio/mp4,audio/aac,audio/amr,video/mp4,application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleAttach(file);
                }}
              />
              <Button
                size="icon"
                variant="outline"
                aria-label="Enviar imagem, áudio ou documento"
                title="Imagem, áudio (ogg/mp3/m4a), vídeo ou PDF"
                onClick={() => attachInput.current?.click()}
                disabled={sending}
              >
                <Paperclip />
              </Button>
              <Input
                placeholder="Digite uma mensagem..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void handleSend()}
                disabled={sending}
              />
              <Button
                size="icon"
                aria-label="Enviar mensagem"
                onClick={() => void handleSend()}
                disabled={sending || !newMessage.trim()}
              >
                {sending ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </div>
          </>
        )}
      </div>

      {selectedContact && <ContactPanel contact={selectedContact} />}

      <SendTemplateDialog
        contact={selectedContact}
        open={templateOpen}
        onOpenChange={setTemplateOpen}
      />

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar arquivo</DialogTitle>
            <DialogDescription>
              Da biblioteca da empresa. Só os arquivos ligados aparecem aqui.
            </DialogDescription>
          </DialogHeader>
          {activeLibrary.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum arquivo ligado. Adicione em Biblioteca.
            </p>
          ) : (
            <ScrollArea className="max-h-80">
              <div className="space-y-1.5 pr-2">
                {activeLibrary.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => void handleSendLibrary(item)}
                    className="flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors hover:bg-accent/50"
                  >
                    {item.media_type === "image" ? (
                      <img src={item.file_url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {LIBRARY_KINDS.find((k) => k.id === item.kind)?.label}
                        {item.description ? ` · ${item.description}` : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

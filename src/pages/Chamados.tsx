import { useMemo, useState } from "react";
import { LifeBuoy, MessageSquare, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactsQuery, useCompanyTeamQuery, useTicketsQuery, useCreateTicketMutation,
  useUpdateTicketMutation, useDeleteTicketMutation,
} from "@/hooks/queries";
import {
  TICKET_STATUSES, TICKET_PRIORITIES, contactLabel, teamLabel,
  type Contact, type Ticket, type TicketPriority, type TicketStatus,
} from "@/lib/types";
import { sendWhatsappText, firstNameForMessage } from "@/lib/sendMessage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function dueLabel(iso: string | null): { text: string; late: boolean } | null {
  if (!iso) return null;
  const dias = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  const data = new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  if (dias < 0) return { text: `${data} · atrasado`, late: true };
  if (dias === 0) return { text: `${data} · hoje`, late: true };
  return { text: `${data} · em ${dias}d`, late: false };
}

function statusMessage(t: Ticket, contact: Contact | undefined, status: TicketStatus): string {
  const nome = firstNameForMessage(contact?.name);
  const oi = nome ? `Oi ${nome}! ` : "";
  switch (status) {
    case "aberto":
      return `${oi}Abrimos o chamado #${t.number}: ${t.title}. Vamos cuidar disso e te aviso por aqui.`;
    case "em_andamento":
      return `${oi}Seu chamado #${t.number} (${t.title}) está em andamento.`;
    case "aguardando":
      return `${oi}O chamado #${t.number} (${t.title}) está aguardando um retorno seu. Pode responder por aqui.`;
    case "resolvido":
      return `${oi}O chamado #${t.number} (${t.title}) foi resolvido. Se precisar de mais alguma coisa, é só chamar.`;
    case "cancelado":
      return `${oi}O chamado #${t.number} (${t.title}) foi encerrado.`;
  }
}

export default function Chamados() {
  const { company } = useAuth();
  const { data: tickets = [], isPending } = useTicketsQuery(company?.id);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const { data: team = [] } = useCompanyTeamQuery(company?.id);
  const createTicket = useCreateTicketMutation();
  const updateTicket = useUpdateTicketMutation();
  const deleteTicket = useDeleteTicketMutation();

  const [tab, setTab] = useState<"abertos" | TicketStatus | "todos">("abertos");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    contact_id: "", title: "", category: "", priority: "normal" as TicketPriority, due: "", description: "",
  });

  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const contactsSorted = useMemo(
    () => contacts.slice().sort((a, b) => contactLabel(a).localeCompare(contactLabel(b), "pt-BR")),
    [contacts],
  );
  const categories = useMemo(
    () => Array.from(new Set(tickets.map((t) => t.category).filter((c): c is string => !!c))).sort(),
    [tickets],
  );

  const isOpen = (s: TicketStatus) => s !== "resolvido" && s !== "cancelado";
  const counts = useMemo(() => {
    const c: Record<string, number> = { abertos: 0, todos: tickets.length };
    for (const t of tickets) {
      c[t.status] = (c[t.status] ?? 0) + 1;
      if (isOpen(t.status)) c.abertos += 1;
    }
    return c;
  }, [tickets]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tickets
      .filter((t) => {
        if (tab === "abertos" && !isOpen(t.status)) return false;
        if (tab !== "abertos" && tab !== "todos" && t.status !== tab) return false;
        if (!term) return true;
        const contact = t.contact_id ? byId.get(t.contact_id) : undefined;
        return (
          String(t.number).includes(term) ||
          t.title.toLowerCase().includes(term) ||
          (t.category ?? "").toLowerCase().includes(term) ||
          (contact ? contactLabel(contact).toLowerCase().includes(term) : false)
        );
      })
      // Urgente primeiro, depois quem tem prazo mais perto.
      .sort((a, b) => {
        const pa = TICKET_PRIORITIES.findIndex((p) => p.id === a.priority);
        const pb = TICKET_PRIORITIES.findIndex((p) => p.id === b.priority);
        if (pa !== pb) return pb - pa;
        const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
        const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
        return da - db;
      });
  }, [tickets, tab, search, byId]);

  const notify = async (t: Ticket, status: TicketStatus) => {
    const contact = t.contact_id ? byId.get(t.contact_id) : undefined;
    if (!company || !contact?.phone) {
      toast.error("Chamado sem contato com telefone.");
      return;
    }
    try {
      await sendWhatsappText({ company_id: company.id, contact_id: contact.id, phone: contact.phone, text: statusMessage(t, contact, status) });
      toast.success(`Cliente avisado: chamado #${t.number}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao avisar");
    }
  };

  const patch = async (t: Ticket, values: Partial<Pick<Ticket, "status" | "priority" | "assigned_to">>) => {
    if (!company) return;
    try {
      await updateTicket.mutateAsync({ id: t.id, company_id: company.id, ...values });
      if (values.status && values.status !== t.status) {
        const contact = t.contact_id ? byId.get(t.contact_id) : undefined;
        const label = TICKET_STATUSES.find((s) => s.id === values.status)?.label ?? values.status;
        if (contact?.phone) {
          toast.success(`#${t.number} · ${label}`, {
            action: { label: "Avisar morador", onClick: () => void notify({ ...t, status: values.status! }, values.status!) },
          });
        } else {
          toast.success(`#${t.number} · ${label}`);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const handleCreate = async () => {
    if (!company || !form.title.trim()) {
      toast.error("Título é obrigatório.");
      return;
    }
    try {
      const created = await createTicket.mutateAsync({
        company_id: company.id,
        contact_id: form.contact_id || null,
        title: form.title.trim(),
        category: form.category.trim() || null,
        priority: form.priority,
        description: form.description.trim() || null,
        due_at: form.due ? new Date(`${form.due}T18:00`).toISOString() : null,
      });
      toast.success(created ? `Chamado #${created.number} aberto.` : "Chamado aberto.");
      setCreateOpen(false);
      setForm({ contact_id: "", title: "", category: "", priority: "normal", due: "", description: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao abrir chamado");
    }
  };

  const remove = async (t: Ticket) => {
    if (!company || !window.confirm(`Excluir o chamado #${t.number}?`)) return;
    try {
      await deleteTicket.mutateAsync({ id: t.id, company_id: company.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    }
  };

  return (
    <div>
      <PageHeader
        icon={LifeBuoy}
        title="Chamados"
        description={`${counts.abertos} ${counts.abertos === 1 ? "chamado aberto" : "chamados abertos"} · a IA abre o protocolo a partir da conversa`}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            Novo chamado
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="abertos">Abertos <span className="ml-1 text-xs text-muted-foreground">{counts.abertos}</span></TabsTrigger>
            {TICKET_STATUSES.map((s) => (
              <TabsTrigger key={s.id} value={s.id}>
                {s.label} <span className="ml-1 text-xs text-muted-foreground">{counts[s.id] ?? 0}</span>
              </TabsTrigger>
            ))}
            <TabsTrigger value="todos">Todos</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative sm:ml-auto sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Protocolo, título, categoria" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {!isPending && tickets.length === 0 ? (
        <EmptyState
          icon={LifeBuoy}
          title="Nenhum chamado ainda"
          description="Abra o primeiro aqui ou deixe a IA registrar quando o morador pedir pelo WhatsApp."
          action={<Button onClick={() => setCreateOpen(true)}><Plus />Novo chamado</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <div className="scrollbar-slim overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Protocolo</th>
                  <th className="px-4 py-3 font-semibold">Chamado</th>
                  <th className="px-4 py-3 font-semibold">Contato</th>
                  <th className="px-4 py-3 font-semibold">Prioridade</th>
                  <th className="px-4 py-3 font-semibold">Responsável</th>
                  <th className="px-4 py-3 font-semibold">Prazo</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">Nada aqui.</td></tr>
                ) : (
                  filtered.map((t) => {
                    const contact = t.contact_id ? byId.get(t.contact_id) : undefined;
                    const status = TICKET_STATUSES.find((s) => s.id === t.status);
                    const priority = TICKET_PRIORITIES.find((p) => p.id === t.priority);
                    const due = dueLabel(t.due_at);
                    return (
                      <tr key={t.id} className="border-t">
                        <td className="tabular px-4 py-3 font-semibold">
                          #{t.number}
                          {t.created_by === "ai" && <Badge variant="outline" className="ml-2">IA</Badge>}
                        </td>
                        <td className="max-w-xs px-4 py-3">
                          <span className="block truncate font-medium">{t.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[t.category, t.description].filter(Boolean).join(" · ")}
                          </span>
                        </td>
                        <td className="px-4 py-3">{contact ? contactLabel(contact) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-3">
                          <Select value={t.priority} onValueChange={(v) => void patch(t, { priority: v as TicketPriority })}>
                            <SelectTrigger className={cn("h-8 w-28 text-xs", priority?.badge)}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TICKET_PRIORITIES.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-3">
                          <Select value={t.assigned_to ?? "none"} onValueChange={(v) => void patch(t, { assigned_to: v === "none" ? null : v })}>
                            <SelectTrigger className="h-8 w-36 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Ninguém</SelectItem>
                              {team.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{teamLabel(m)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className={cn("tabular px-4 py-3 text-xs", due?.late && isOpen(t.status) ? "font-medium text-destructive" : "text-muted-foreground")}>
                          {due?.text ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Select value={t.status} onValueChange={(v) => void patch(t, { status: v as TicketStatus })}>
                            <SelectTrigger className={cn("h-8 w-36 text-xs", status?.badge)}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TICKET_STATUSES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <Button size="icon-sm" variant="ghost" title="Avisar contato do status atual" disabled={!contact?.phone} onClick={() => void notify(t, t.status)}>
                              <MessageSquare />
                            </Button>
                            <Button size="icon-sm" variant="ghost" aria-label="Excluir chamado" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => void remove(t)}>
                              <Trash2 />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo chamado</DialogTitle>
            <DialogDescription>Ganha um protocolo na hora, que o contato pode citar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input placeholder="Ex: Vazamento na garagem do bloco B" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Contato</Label>
              <Select value={form.contact_id || "none"} onValueChange={(v) => setForm((f) => ({ ...f, contact_id: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Escolha o contato" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem contato</SelectItem>
                  {contactsSorted.map((c) => <SelectItem key={c.id} value={c.id}>{contactLabel(c)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Input list="ticket-categories" placeholder="Manutenção" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
                <datalist id="ticket-categories">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label>Prioridade</Label>
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v as TicketPriority }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TICKET_PRIORITIES.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Prazo</Label>
                <Input type="date" value={form.due} onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descrição (opcional)</Label>
              <Textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={() => void handleCreate()} disabled={createTicket.isPending}>
              {createTicket.isPending ? "Abrindo..." : "Abrir chamado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

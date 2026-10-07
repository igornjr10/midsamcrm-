import { useState, type ReactNode } from "react";
import {
  BadgeCheck, CalendarClock, CalendarPlus, CircleCheck, Clock, Handshake, HandCoins, MapPin,
  MessageCircle, Tags, UserRound, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactAppointmentsQuery,
  useCreateAppointmentMutation,
  useUpdateContactMutation,
  usePipelineStagesQuery,
  useContactFieldsQuery,
  useFeatures,
  useOrdersQuery,
  useTicketsQuery,
  useWhatsappConfigQuery,
  useCompanyTeamQuery,
} from "@/hooks/queries";
import {
  contactInitial, contactLabel, formatPhone, getStageLabel, getStageTone, ORDER_STATUSES,
  TICKET_STATUSES, leadSourceLabel, teamLabel, type Contact,
} from "@/lib/types";
import { formatFieldValue } from "@/lib/fields";
import TagPicker from "@/components/contacts/TagPicker";
import ContactRecords from "@/components/contacts/ContactRecords";
import ContactDetailModal from "@/components/contacts/ContactDetailModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });

const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

const CANAL: Record<string, string> = {
  uazapi: "WhatsApp (QR code)",
  evolution: "WhatsApp (QR code)",
  openwa: "WhatsApp (QR code)",
  meta: "WhatsApp (API oficial)",
  datafy: "WhatsApp (API oficial)",
};

/** Cartão com título em caixa alta e ícone colorido — o bloco do painel. */
function Section({
  icon: Icon, title, tone, action, children,
}: {
  icon: LucideIcon;
  title: string;
  tone: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className={cn("h-4 w-4 shrink-0", tone)} />
          {title}
        </p>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Linha rótulo · valor, com o rótulo em caixa alta discreta. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <dt className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  );
}

/**
 * O que o atendente precisa decidir sem sair da conversa: quem é o lead, em que
 * pé está o negócio, o que está agendado e quem está respondendo — e os botões
 * para fechar, agendar ou encerrar ali mesmo.
 */
export default function ContactPanel({ contact }: { contact: Contact }) {
  const { user, company } = useAuth();
  const { data: stages = [] } = usePipelineStagesQuery(company?.id);
  const { data: fieldDefs = [] } = useContactFieldsQuery(company?.id);
  const { data: waConfig } = useWhatsappConfigQuery(company?.id);
  const { data: team = [] } = useCompanyTeamQuery(company?.id);
  const { has } = useFeatures(company?.id);
  const { data: orders = [] } = useOrdersQuery(company?.id, has("pedidos"));
  const { data: tickets = [] } = useTicketsQuery(company?.id, has("chamados"));
  const openOrders = orders.filter((o) => o.contact_id === contact.id && o.status !== "entregue" && o.status !== "cancelado");
  const openTickets = tickets.filter((t) => t.contact_id === contact.id && t.status !== "resolvido" && t.status !== "cancelado");
  const { data: appointments = [] } = useContactAppointmentsQuery(company?.id, contact.id);
  const createAppointment = useCreateAppointmentMutation();
  const updateContact = useUpdateContactMutation();

  const [detailOpen, setDetailOpen] = useState(false);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [form, setForm] = useState({ title: "", date: "", time: "09:00" });
  const [closeOpen, setCloseOpen] = useState(false);
  const [lossReason, setLossReason] = useState("");

  // Campos do negócio: os preenchidos viram linhas; os vazios, o "falta saber".
  const preenchidos = fieldDefs
    .map((f) => ({ field: f, text: formatFieldValue(f, contact.fields?.[f.key]) }))
    .filter((d): d is { field: typeof d.field; text: string } => !!d.text);
  const faltaSaber = fieldDefs.filter((f) => !formatFieldValue(f, contact.fields?.[f.key])).map((f) => f.label);

  const agora = Date.now();
  const proximos = appointments
    .filter((a) => a.status === "scheduled" && new Date(a.starts_at).getTime() >= agora - 3_600_000)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const proxima = proximos[0];

  const wonStage = stages.find((s) => s.kind === "won");
  const lostStage = stages.find((s) => s.kind === "lost");
  const pago = contact.closing_signal_type === "pagamento";
  const sinalizou = !!contact.closing_signal_at && !pago;
  const ganho = pago || (!!wonStage && contact.stage === wonStage.key);
  const perdido = !!lostStage && contact.stage === lostStage.key;

  const responsavel = team.find((m) => m.user_id === contact.assigned_to);
  const phone = formatPhone(contact.phone);
  const label = contactLabel(contact);

  const marcarVenda = async () => {
    if (!company) return;
    try {
      await updateContact.mutateAsync({
        id: contact.id,
        company_id: company.id,
        closing_signal_at: new Date().toISOString(),
        closing_signal_type: "pagamento",
        closing_signal_label: "Marcado pelo atendente",
        closing_signal_excerpt: null,
        ...(wonStage ? { stage: wonStage.key } : {}),
      });
      toast.success(wonStage ? `Venda concluída · movido para ${wonStage.name}` : "Venda concluída");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao concluir a venda");
    }
  };

  const encerrar = async () => {
    if (!company || !lostStage) return;
    try {
      await updateContact.mutateAsync({
        id: contact.id,
        company_id: company.id,
        stage: lostStage.key,
        loss_reason: lossReason.trim() || null,
        needs_human_at: null,
      });
      toast.success(`Atendimento encerrado · movido para ${lostStage.name}`);
      setCloseOpen(false);
      setLossReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao encerrar");
    }
  };

  const agendar = async () => {
    if (!user || !company || !form.title.trim() || !form.date) {
      toast.error("Título e data são obrigatórios");
      return;
    }
    const startsAt = new Date(`${form.date}T${form.time || "09:00"}`);
    if (Number.isNaN(startsAt.getTime())) {
      toast.error("Data inválida");
      return;
    }
    try {
      await createAppointment.mutateAsync({
        user_id: user.id,
        company_id: company.id,
        contact_id: contact.id,
        title: form.title.trim(),
        starts_at: startsAt.toISOString(),
        kind: "meeting",
      });
      toast.success("Atendimento agendado");
      setAgendaOpen(false);
      setForm({ title: "", date: "", time: "09:00" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao agendar");
    }
  };

  return (
    <div className="hidden w-80 flex-shrink-0 flex-col overflow-hidden border-l bg-muted/20 xl:flex">
      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 p-4">
          {/* ── Quem é ─────────────────────────────────────────────────────── */}
          <div className="flex flex-col items-center pt-2 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-2xl font-medium text-foreground/80">
              {contactInitial(contact)}
            </span>
            <p className="mt-3 max-w-full truncate text-base font-semibold">{label}</p>
            {phone && phone !== label && <p className="tabular text-sm text-muted-foreground">{phone}</p>}
          </div>

          <dl className="px-1">
            <Row label="Canal">
              <span className="inline-flex items-center gap-1.5">
                <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                {CANAL[waConfig?.provider ?? ""] ?? "WhatsApp"}
              </span>
            </Row>
            <Row label="Origem">
              <span title={contact.source_detail ?? undefined}>{leadSourceLabel(contact.source)}</span>
            </Row>
            {contact.source_detail && (
              <p className="-mt-0.5 truncate text-right text-xs text-muted-foreground" title={contact.source_detail}>
                {contact.source_detail}
              </p>
            )}
            <Row label="Entrou em">{dia(contact.created_at)}</Row>
          </dl>

          {/* ── Ações ──────────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <Button variant="outline" className="w-full rounded-xl" onClick={() => setDetailOpen(true)}>
              Editar contato / ver lead completo
            </Button>
            <Button
              className="w-full rounded-xl border-0 bg-gradient-to-r from-orange-500 to-amber-400 text-white shadow-sm hover:from-orange-500/90 hover:to-amber-400/90"
              onClick={() => setAgendaOpen(true)}
            >
              <CalendarPlus />
              Agendar atendimento
            </Button>
            <Button
              variant="outline"
              className={cn(
                "w-full rounded-xl border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950",
                ganho && "bg-emerald-50 dark:bg-emerald-950",
              )}
              onClick={() => void marcarVenda()}
              disabled={ganho || updateContact.isPending}
            >
              <CircleCheck />
              {ganho ? "Venda concluída ✓" : "Venda concluída"}
            </Button>
            {lostStage && (
              <Button
                variant="outline"
                className="w-full rounded-xl border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                onClick={() => setCloseOpen(true)}
                disabled={perdido || updateContact.isPending}
              >
                {perdido ? "Atendimento encerrado" : "Encerrar atendimento"}
              </Button>
            )}
          </div>

          {/* ── Negócio ────────────────────────────────────────────────────── */}
          <Section icon={Handshake} title="Negócio em andamento" tone="text-orange-500">
            <dl>
              {preenchidos.map(({ field, text }) => (
                <Row key={field.id} label={field.label}>{text}</Row>
              ))}
              <Row label="Pagamento">
                {pago ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    Confirmado
                  </span>
                ) : sinalizou ? (
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <HandCoins className="h-3.5 w-3.5" />
                    Sinalizou
                  </span>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Etapa">
                <Badge variant="outline" className={cn(getStageTone(stages, contact.stage).badge)}>
                  {getStageLabel(stages, contact.stage)}
                </Badge>
              </Row>
            </dl>
            {(pago || sinalizou) && contact.closing_signal_excerpt && (
              <p className="mt-2 text-xs italic text-muted-foreground">“{contact.closing_signal_excerpt}”</p>
            )}
            {perdido && contact.loss_reason && (
              <p className="mt-2 text-xs text-muted-foreground">Motivo: {contact.loss_reason}</p>
            )}
            {faltaSaber.length > 0 && (
              <p className="mt-2 text-xs italic text-muted-foreground">
                Falta saber: {faltaSaber.join(", ").toLowerCase()}
              </p>
            )}
          </Section>

          {/* ── Próxima ação ───────────────────────────────────────────────── */}
          <Section
            icon={CalendarClock}
            title="Próxima ação"
            tone="text-orange-500"
            action={
              <Button size="icon-sm" variant="ghost" aria-label="Agendar" onClick={() => setAgendaOpen(true)}>
                <CalendarPlus />
              </Button>
            }
          >
            {!proxima ? (
              <p className="text-sm text-muted-foreground">Nenhuma ação agendada</p>
            ) : (
              <div className="space-y-2">
                {proximos.slice(0, 3).map((a) => (
                  <div key={a.id}>
                    <p className="text-sm font-medium leading-tight">{a.title}</p>
                    <p className="tabular mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      {a.all_day ? `${dia(a.starts_at)} · dia inteiro` : dataHora(a.starts_at)}
                    </p>
                    {a.location && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{a.location}</span>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── Atendimento ────────────────────────────────────────────────── */}
          <Section icon={UserRound} title="Atendimento" tone="text-sky-500">
            <dl>
              <Row label="Responsável">{responsavel ? teamLabel(responsavel) : "Sem vendedor"}</Row>
              <Row label="Atendendo">{contact.ai_paused ? "Humano" : "IA"}</Row>
              <Row label="Última fala do lead">
                {contact.last_inbound_at ? dataHora(contact.last_inbound_at) : "—"}
              </Row>
              <Row label="Última interação">
                {contact.last_interaction_at ? dataHora(contact.last_interaction_at) : "—"}
              </Row>
              {contact.email && <Row label="E-mail">{contact.email}</Row>}
            </dl>
            {/* Fica depois que alguém assume: é a ficha que a IA deixou. */}
            {contact.handoff_summary && (
              <div className="mt-2 rounded-lg bg-muted/50 p-2.5 text-xs">
                <p className="font-semibold text-muted-foreground">Resumo da IA ao passar a conversa</p>
                <p className="mt-1 whitespace-pre-wrap">{contact.handoff_summary}</p>
              </div>
            )}
          </Section>

          {/* ── Etiquetas ──────────────────────────────────────────────────── */}
          <Section icon={Tags} title="Etiquetas" tone="text-violet-500">
            <TagPicker
              compact
              value={contact.tags ?? []}
              onChange={(tags) => {
                if (!company) return;
                void updateContact.mutateAsync({ id: contact.id, company_id: company.id, tags })
                  .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Erro ao salvar etiquetas"));
              }}
            />
          </Section>

          <ContactRecords contact={contact} compact />

          {/* ── Pedidos e chamados abertos ─────────────────────────────────── */}
          {openOrders.length > 0 && (
            <Section icon={HandCoins} title="Pedidos abertos" tone="text-emerald-500">
              <div className="space-y-1.5">
                {openOrders.slice(0, 4).map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0">
                      <span className="tabular block font-medium">#{o.number}</span>
                      <span className="block truncate text-muted-foreground">
                        {o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}
                      </span>
                    </span>
                    <Badge variant="outline" className={cn("shrink-0", ORDER_STATUSES.find((s) => s.id === o.status)?.badge)}>
                      {ORDER_STATUSES.find((s) => s.id === o.status)?.label}
                    </Badge>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {openTickets.length > 0 && (
            <Section icon={MessageCircle} title="Chamados abertos" tone="text-amber-500">
              <div className="space-y-1.5">
                {openTickets.slice(0, 4).map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0">
                      <span className="tabular block font-medium">#{t.number} · {t.title}</span>
                      {t.category && <span className="block truncate text-muted-foreground">{t.category}</span>}
                    </span>
                    <Badge variant="outline" className={cn("shrink-0", TICKET_STATUSES.find((s) => s.id === t.status)?.badge)}>
                      {TICKET_STATUSES.find((s) => s.id === t.status)?.label}
                    </Badge>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>

      <ContactDetailModal contact={contact} open={detailOpen} onClose={() => setDetailOpen(false)} />

      <Dialog open={agendaOpen} onOpenChange={setAgendaOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Agendar com {label}</DialogTitle>
            <DialogDescription>O compromisso aparece na Agenda e neste painel.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input
                placeholder="Ex: visita, test drive, retorno"
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Hora</Label>
                <Input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm((p) => ({ ...p, time: e.target.value }))}
                />
              </div>
            </div>
            <Button className="w-full" onClick={() => void agendar()} disabled={createAppointment.isPending}>
              {createAppointment.isPending ? "Agendando..." : "Agendar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Encerrar atendimento?</DialogTitle>
            <DialogDescription>
              {label} vai para a etapa {lostStage?.name ?? "de perdidos"}. A conversa continua aberta se o
              lead voltar a escrever.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="loss-reason">Motivo (opcional)</Label>
            <Input
              id="loss-reason"
              placeholder="Ex: achou mais barato, desistiu, sem crédito"
              value={lossReason}
              onChange={(e) => setLossReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCloseOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void encerrar()} disabled={updateContact.isPending}>
              Encerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

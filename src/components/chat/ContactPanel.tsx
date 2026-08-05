import { useState } from "react";
import { BadgeCheck, CalendarPlus, Clock, HandCoins, MapPin } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactAppointmentsQuery,
  useCreateAppointmentMutation,
  useUpdateContactMutation,
  usePipelineStagesQuery,
} from "@/hooks/queries";
import { getStageLabel, getStageTone, type Contact } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });

const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/**
 * O que o atendente precisa decidir sem sair da conversa: se já pagou, em que
 * etapa está e o que está agendado. Antes isso exigia abrir Contatos e Agenda
 * em outra aba.
 */
export default function ContactPanel({ contact }: { contact: Contact }) {
  const { user, company } = useAuth();
  const { data: stages = [] } = usePipelineStagesQuery(company?.id);
  const { data: appointments = [] } = useContactAppointmentsQuery(company?.id, contact.id);
  const createAppointment = useCreateAppointmentMutation();
  const updateContact = useUpdateContactMutation();

  const [agendaOpen, setAgendaOpen] = useState(false);
  const [form, setForm] = useState({ title: "", date: "", time: "09:00" });

  const agora = Date.now();
  const proximos = appointments.filter(
    (a) => a.status === "scheduled" && new Date(a.starts_at).getTime() >= agora - 3_600_000,
  );

  const pago = contact.closing_signal_type === "pagamento";
  const sinalizou = !!contact.closing_signal_at && !pago;

  const marcarPago = async () => {
    if (!company) return;
    const wonStage = stages.find((s) => s.kind === "won");
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
      toast.success(wonStage ? `Pagamento marcado · movido para ${wonStage.name}` : "Pagamento marcado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao marcar pagamento");
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
      toast.success("Compromisso agendado");
      setAgendaOpen(false);
      setForm({ title: "", date: "", time: "09:00" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao agendar");
    }
  };

  return (
    <div className="hidden w-80 flex-shrink-0 flex-col overflow-hidden rounded-xl border bg-card shadow-card xl:flex">
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {/* ── Fechamento e pagamento ─────────────────────────────────────── */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Fechamento
            </p>

            {pago ? (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  <BadgeCheck className="h-4 w-4 shrink-0" />
                  Pagamento identificado
                </p>
                <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                  {contact.closing_signal_label} · {dia(contact.closing_signal_at!)}
                </p>
                {contact.closing_signal_excerpt && (
                  <p className="mt-1.5 text-xs italic text-emerald-700/90 dark:text-emerald-400/90">
                    “{contact.closing_signal_excerpt}”
                  </p>
                )}
              </div>
            ) : sinalizou ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
                  <HandCoins className="h-4 w-4 shrink-0" />
                  Sinalizou fechamento
                </p>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  {contact.closing_signal_label} · {dia(contact.closing_signal_at!)} · pagamento ainda não confirmado
                </p>
                {contact.closing_signal_excerpt && (
                  <p className="mt-1.5 text-xs italic text-amber-700/90 dark:text-amber-400/90">
                    “{contact.closing_signal_excerpt}”
                  </p>
                )}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Nenhum sinal de pagamento nesta conversa.
              </p>
            )}

            {!pago && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 w-full"
                onClick={() => void marcarPago()}
                disabled={updateContact.isPending}
              >
                <HandCoins />
                Marcar como pago
              </Button>
            )}
          </div>

          {/* ── Etapa ──────────────────────────────────────────────────────── */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Etapa
            </p>
            <Badge variant="outline" className={cn(getStageTone(stages, contact.stage).badge)}>
              {getStageLabel(stages, contact.stage)}
            </Badge>
          </div>

          {/* ── Agenda ─────────────────────────────────────────────────────── */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Agendamentos
              </p>
              <Button size="icon-sm" variant="ghost" aria-label="Agendar" onClick={() => setAgendaOpen(true)}>
                <CalendarPlus />
              </Button>
            </div>
            {proximos.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Nada agendado com este contato.
              </p>
            ) : (
              <div className="space-y-1.5">
                {proximos.slice(0, 4).map((a) => (
                  <div key={a.id} className="rounded-lg border p-2.5">
                    <p className="text-sm font-medium leading-tight">{a.title}</p>
                    <p className="tabular mt-1 flex items-center gap-1 text-xs text-muted-foreground">
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
          </div>

          {/* ── Histórico do relacionamento ────────────────────────────────── */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Contato
            </p>
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Entrou em</dt>
                <dd className="tabular font-medium">{dia(contact.created_at)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Última interação</dt>
                <dd className="tabular font-medium">
                  {contact.last_interaction_at ? dataHora(contact.last_interaction_at) : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Última fala do lead</dt>
                <dd className="tabular font-medium">
                  {contact.last_inbound_at ? dataHora(contact.last_inbound_at) : "—"}
                </dd>
              </div>
              {contact.email && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">E-mail</dt>
                  <dd className="truncate font-medium">{contact.email}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </ScrollArea>

      <Dialog open={agendaOpen} onOpenChange={setAgendaOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Agendar com {contact.name}</DialogTitle>
            <DialogDescription>O compromisso aparece na Agenda e neste painel.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input
                placeholder="Ex: degustação, visita ao espaço"
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
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
    </div>
  );
}

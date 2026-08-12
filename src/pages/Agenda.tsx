import { useMemo, useState } from "react";
import {
  Ban, CalendarDays, CheckCheck, ChevronLeft, ChevronRight, Clock, MapPin, Plus, RefreshCw,
  Trash2, User,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useAppointmentsQuery,
  useCreateAppointmentMutation,
  useUpdateAppointmentMutation,
  useDeleteAppointmentMutation,
  useContactsQuery,
  useGoogleCalendarAutoSync,
} from "@/hooks/queries";
import type { Appointment, AppointmentKind } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, LoadingState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const KINDS: Record<AppointmentKind, { label: string; dot: string }> = {
  meeting: { label: "Reunião", dot: "bg-primary" },
  call: { label: "Ligação", dot: "bg-sky-500" },
  visit: { label: "Visita", dot: "bg-violet-500" },
  followup: { label: "Follow-up", dot: "bg-amber-500" },
  other: { label: "Outro", dot: "bg-muted-foreground" },
};

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
};
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

/** Chave local YYYY-MM-DD. Não dá para usar toISOString aqui: ela converte para
 *  UTC e joga compromissos da noite para o dia seguinte. */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export default function Agenda() {
  const { user, company } = useAuth();
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [createOpen, setCreateOpen] = useState(false);

  // 6 semanas fixas: a grade não muda de altura ao trocar de mês.
  const gridStart = useMemo(
    () => addDays(monthCursor, -monthCursor.getDay()),
    [monthCursor],
  );
  const gridDays = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)),
    [gridStart],
  );

  const range = useMemo(
    () => ({ from: gridStart.toISOString(), to: addDays(gridStart, 42).toISOString() }),
    [gridStart],
  );

  const { data: appointments = [], isPending } = useAppointmentsQuery(company?.id, range);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  // Puxa o que mudou no Google antes de desenhar o mês. Não bloqueia nada: a
  // agenda local aparece na hora e ganha os eventos de lá quando chegarem.
  const googleSync = useGoogleCalendarAutoSync(company?.id);
  const createAppointment = useCreateAppointmentMutation();
  const updateAppointment = useUpdateAppointmentMutation();
  const deleteAppointment = useDeleteAppointmentMutation();

  const contactNameById = useMemo(
    () => new Map(contacts.map((c) => [c.id, c.name])),
    [contacts],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const item of appointments) {
      const key = dayKey(new Date(item.starts_at));
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [appointments]);

  const todayKey = dayKey(new Date());
  const selectedKey = dayKey(selectedDay);
  const selectedItems = byDay.get(selectedKey) ?? [];
  // Pendência conta como compromisso: um dia que só tem pedido do lead
  // aparecendo como "0 hoje" esconde justamente o que precisa de atenção.
  const isOpen = (s: Appointment["status"]) => s === "scheduled" || s === "pending";
  const monthCount = appointments.filter(
    (a) => new Date(a.starts_at).getMonth() === monthCursor.getMonth() && isOpen(a.status),
  ).length;
  const todayCount = (byDay.get(todayKey) ?? []).filter((a) => isOpen(a.status)).length;

  const [form, setForm] = useState({
    title: "",
    kind: "meeting" as AppointmentKind,
    date: todayKey,
    start: "09:00",
    end: "",
    all_day: false,
    contact_id: "none",
    location: "",
    description: "",
  });

  const openCreate = () => {
    setForm((prev) => ({ ...prev, title: "", date: selectedKey, end: "", location: "", description: "" }));
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!user || !company || !form.title.trim()) {
      toast.error("Título é obrigatório");
      return;
    }
    const startsAt = new Date(`${form.date}T${form.all_day ? "00:00" : form.start}`);
    if (Number.isNaN(startsAt.getTime())) {
      toast.error("Data inválida");
      return;
    }
    const endsAt = !form.all_day && form.end ? new Date(`${form.date}T${form.end}`) : null;
    if (endsAt && endsAt < startsAt) {
      toast.error("O fim não pode ser antes do início");
      return;
    }

    try {
      await createAppointment.mutateAsync({
        user_id: user.id,
        company_id: company.id,
        title: form.title.trim(),
        kind: form.kind,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt ? endsAt.toISOString() : null,
        all_day: form.all_day,
        location: form.location.trim() || null,
        description: form.description.trim() || null,
        contact_id: form.contact_id === "none" ? null : form.contact_id,
      });
      toast.success("Compromisso agendado");
      setCreateOpen(false);
      setSelectedDay(startOfDay(startsAt));
      setMonthCursor(new Date(startsAt.getFullYear(), startsAt.getMonth(), 1));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao agendar");
    }
  };

  const patchStatus = (item: Appointment, status: Appointment["status"]) => {
    if (!company) return;
    void updateAppointment.mutateAsync({ id: item.id, company_id: company.id, status });
  };

  const goToday = () => {
    const now = new Date();
    setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDay(startOfDay(now));
  };

  return (
    <div>
      <PageHeader
        icon={CalendarDays}
        title="Agenda"
        description={
          monthCount > 0
            ? `${monthCount} ${monthCount === 1 ? "compromisso" : "compromissos"} no mês`
            : "Nenhum compromisso no mês"
        }
        badges={
          <>
            {todayCount > 0 && <Badge variant="secondary">{todayCount} hoje</Badge>}
            {googleSync.isFetching && (
              <Badge variant="outline">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Google
              </Badge>
            )}
          </>
        }
        actions={
          <Button onClick={openCreate}>
            <Plus />
            Novo compromisso
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Mês anterior"
          onClick={() => setMonthCursor((m) => addMonths(m, -1))}
        >
          <ChevronLeft />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Próximo mês"
          onClick={() => setMonthCursor((m) => addMonths(m, 1))}
        >
          <ChevronRight />
        </Button>
        <span className="text-sm font-semibold capitalize">
          {monthCursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
        </span>
        <Button size="sm" variant="ghost" onClick={goToday}>
          Hoje
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <div className="grid grid-cols-7 border-b bg-muted/40">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {gridDays.map((day) => {
              const key = dayKey(day);
              const items = byDay.get(key) ?? [];
              const otherMonth = day.getMonth() !== monthCursor.getMonth();
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    "flex h-16 flex-col items-stretch gap-1 border-b border-r p-1.5 text-left transition-colors hover:bg-muted/50 sm:h-24",
                    otherMonth && "bg-muted/20 text-muted-foreground",
                    key === selectedKey && "bg-primary/5 ring-1 ring-inset ring-primary/40",
                  )}
                >
                  <span
                    className={cn(
                      "tabular self-start rounded-md px-1.5 text-xs font-medium",
                      key === todayKey && "bg-primary text-primary-foreground",
                    )}
                  >
                    {day.getDate()}
                  </span>
                  {/* No celular a coluna tem ~49px: o título não cabe e vira
                      ruído, então sobra só o ponto colorido de cada item. */}
                  <span className="flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-hidden sm:block sm:space-y-0.5">
                    {items.slice(0, 2).map((item) => (
                      <span key={item.id} className="flex items-center gap-1 text-[11px] leading-tight">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            KINDS[item.kind]?.dot ?? KINDS.other.dot,
                            // Pendência não é apagada: é o que mais precisa ser visto.
                            !isOpen(item.status) && "opacity-40",
                          )}
                        />
                        <span
                          className={cn(
                            "hidden truncate sm:inline",
                            item.status === "canceled" && "text-muted-foreground line-through",
                            item.status === "pending" && "font-medium text-primary",
                          )}
                        >
                          {!item.all_day && `${hhmm(item.starts_at)} `}
                          {item.title}
                        </span>
                      </span>
                    ))}
                    {items.length > 2 && (
                      <span className="block text-[11px] text-muted-foreground">
                        +{items.length - 2}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-card">
          <p className="text-sm font-semibold capitalize">
            {selectedDay.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            {selectedItems.length === 0
              ? "Dia livre"
              : `${selectedItems.length} ${selectedItems.length === 1 ? "compromisso" : "compromissos"}`}
          </p>

          {isPending ? (
            <LoadingState label="Carregando agenda..." className="py-8" />
          ) : selectedItems.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Nada marcado"
              description="Agende uma reunião ou ligação para este dia."
              action={
                <Button size="sm" onClick={openCreate}>
                  <Plus />
                  Novo compromisso
                </Button>
              }
              className="px-4 py-8"
            />
          ) : (
            <div className="space-y-2">
              {selectedItems.map((item) => {
                const done = item.status === "done";
                const canceled = item.status === "canceled";
                // Pedido do lead que o SDR IA registrou: ainda não é compromisso.
                const pending = item.status === "pending";
                const contactName = item.contact_id ? contactNameById.get(item.contact_id) : undefined;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "group rounded-lg border p-3 transition-colors",
                      (done || canceled) && "bg-muted/40",
                      pending && "border-primary/40 bg-primary/5",
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <Checkbox
                        checked={done}
                        disabled={canceled || pending}
                        onCheckedChange={(v) => patchStatus(item, v === true ? "done" : "scheduled")}
                        aria-label={done ? "Reabrir compromisso" : "Concluir compromisso"}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-sm font-medium",
                            (done || canceled) && "text-muted-foreground line-through",
                          )}
                        >
                          {item.title}
                        </p>
                        <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                          <span className="tabular flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            {item.all_day
                              ? "Dia inteiro"
                              : `${hhmm(item.starts_at)}${item.ends_at ? ` – ${hhmm(item.ends_at)}` : ""}`}
                            {" · "}
                            {KINDS[item.kind]?.label ?? KINDS.other.label}
                          </span>
                          {contactName && (
                            <span className="flex min-w-0 items-center gap-1">
                              <User className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{contactName}</span>
                            </span>
                          )}
                          {item.location && (
                            <span className="flex min-w-0 items-center gap-1">
                              <MapPin className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{item.location}</span>
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="mt-1.5 text-xs text-muted-foreground">{item.description}</p>
                        )}
                        {canceled && (
                          <Badge variant="outline" className="mt-2">
                            Cancelado
                          </Badge>
                        )}
                        {pending && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="border-primary/50 text-primary">
                              A confirmar
                            </Badge>
                            <Button size="sm" onClick={() => patchStatus(item, "scheduled")}>
                              <CheckCheck />
                              Confirmar
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={canceled ? "Reativar compromisso" : "Cancelar compromisso"}
                          className="text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                          onClick={() => patchStatus(item, canceled ? "scheduled" : "canceled")}
                        >
                          <Ban />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Excluir compromisso"
                          className="text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                          onClick={() =>
                            company && void deleteAppointment.mutateAsync({ id: item.id, company_id: company.id })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo compromisso</DialogTitle>
            <DialogDescription>Reuniões, ligações e visitas da equipe.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="Reunião de apresentação"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select
                  value={form.kind}
                  onValueChange={(v) => setForm((p) => ({ ...p, kind: v as AppointmentKind }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(KINDS).map(([value, { label }]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.all_day}
                onCheckedChange={(v) => setForm((p) => ({ ...p, all_day: v === true }))}
              />
              Dia inteiro
            </label>

            {!form.all_day && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Início</Label>
                  <Input
                    type="time"
                    value={form.start}
                    onChange={(e) => setForm((p) => ({ ...p, start: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Fim (opcional)</Label>
                  <Input
                    type="time"
                    value={form.end}
                    onChange={(e) => setForm((p) => ({ ...p, end: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Contato vinculado (opcional)</Label>
              <Select
                value={form.contact_id}
                onValueChange={(v) => setForm((p) => ({ ...p, contact_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Local (opcional)</Label>
              <Input
                value={form.location}
                onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                placeholder="Escritório, Google Meet, endereço..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Observações (opcional)</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>

            <Button className="w-full" onClick={handleCreate} disabled={createAppointment.isPending}>
              {createAppointment.isPending ? "Agendando..." : "Agendar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

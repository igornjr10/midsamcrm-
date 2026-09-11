import { useMemo, useState } from "react";
import { Cake, Check, ClipboardCheck, Gift, MessageSquare, Plus, RotateCcw, Search, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactsQuery, useCompanyTeamQuery, useTasksQuery, useSaveTaskMutation, useDeleteTaskMutation,
} from "@/hooks/queries";
import { contactLabel, formatPhone, teamLabel, type SellerTask } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const KINDS: Record<SellerTask["kind"], { label: string; icon: typeof Star }> = {
  pos_venda: { label: "Pós-venda", icon: MessageSquare },
  nps: { label: "NPS", icon: Star },
  aniversario: { label: "Aniversário", icon: Cake },
  recompra: { label: "Recompra", icon: RotateCcw },
  giftback: { label: "Giftback", icon: Gift },
  outro: { label: "Outro", icon: ClipboardCheck },
};

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export default function Vendedor() {
  const { user, company } = useAuth();
  const navigate = useNavigate();
  const { data: tasks = [] } = useTasksQuery(company?.id);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const { data: team = [] } = useCompanyTeamQuery(company?.id);
  const save = useSaveTaskMutation();
  const remove = useDeleteTaskMutation();

  const [tab, setTab] = useState<"atrasadas" | "hoje" | "futuras" | "feitas">("hoje");
  const [seller, setSeller] = useState<string>(user?.id ?? "all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: "", contact_id: "", kind: "outro" as SellerTask["kind"], due: new Date().toISOString().slice(0, 10), assigned_to: user?.id ?? "" });

  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const today = startOfToday();
  const tomorrow = today + 86_400_000;

  const bucket = (t: SellerTask) => {
    if (t.status !== "pendente") return "feitas";
    const due = new Date(t.due_at).getTime();
    if (due < today) return "atrasadas";
    if (due < tomorrow) return "hoje";
    return "futuras";
  };

  const mine = useMemo(
    () => tasks.filter((t) => seller === "all" || t.assigned_to === seller || (seller === user?.id && !t.assigned_to)),
    [tasks, seller, user?.id],
  );
  const counts = useMemo(() => {
    const c = { atrasadas: 0, hoje: 0, futuras: 0, feitas: 0 };
    for (const t of mine) c[bucket(t)] += 1;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine]);

  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    return mine.filter((t) => bucket(t) === tab).filter((t) => {
      if (!term) return true;
      const c = t.contact_id ? byId.get(t.contact_id) : undefined;
      return t.title.toLowerCase().includes(term) || (c ? contactLabel(c).toLowerCase().includes(term) : false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, tab, search, byId]);

  const doneRate = useMemo(() => {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const inMonth = mine.filter((t) => new Date(t.due_at).getTime() >= monthStart && new Date(t.due_at).getTime() < Date.now());
    const done = inMonth.filter((t) => t.status === "feita").length;
    return { done, total: inMonth.length, rate: inMonth.length ? Math.round((done / inMonth.length) * 100) : 0 };
  }, [mine]);

  const setStatus = async (t: SellerTask, status: SellerTask["status"]) => {
    if (!company) return;
    try {
      await save.mutateAsync({ id: t.id, company_id: company.id, status, done_at: status === "feita" ? new Date().toISOString() : null });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  };

  const handleCreate = async () => {
    if (!company || !form.title.trim()) return void toast.error("Título é obrigatório.");
    try {
      await save.mutateAsync({
        id: null, company_id: company.id, title: form.title.trim(), kind: form.kind,
        contact_id: form.contact_id || null, assigned_to: form.assigned_to || null,
        due_at: new Date(`${form.due}T09:00`).toISOString(),
      });
      toast.success("Tarefa criada.");
      setCreateOpen(false);
      setForm((f) => ({ ...f, title: "", contact_id: "" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar");
    }
  };

  return (
    <div>
      <PageHeader
        icon={ClipboardCheck}
        title="Painel do Vendedor"
        description="Pós-venda, NPS e aniversário viram tarefas com dia certo. Feita é feita; o resto cobra."
        badges={counts.atrasadas > 0 ? <Badge variant="destructive">{counts.atrasadas} atrasadas</Badge> : undefined}
        actions={
          <>
            <Select value={seller} onValueChange={setSeller}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda a equipe</SelectItem>
                {team.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.user_id === user?.id ? "Minhas tarefas" : teamLabel(m)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={() => setCreateOpen(true)}><Plus />Adicionar tarefa</Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="atrasadas">Atrasadas <span className={cn("ml-1 text-xs", counts.atrasadas > 0 ? "text-destructive" : "text-muted-foreground")}>{counts.atrasadas}</span></TabsTrigger>
            <TabsTrigger value="hoje">Hoje <span className="ml-1 text-xs text-muted-foreground">{counts.hoje}</span></TabsTrigger>
            <TabsTrigger value="futuras">Futuras <span className="ml-1 text-xs text-muted-foreground">{counts.futuras}</span></TabsTrigger>
            <TabsTrigger value="feitas">Feitas</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative sm:ml-auto sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3 shadow-card">
        <div>
          <p className="text-sm font-semibold">Relatório do mês</p>
          <p className="text-xs text-muted-foreground"><b>{doneRate.done} tarefas realizadas</b> de {doneRate.total} vencidas até hoje.</p>
        </div>
        <span className={cn("tabular flex h-12 w-12 items-center justify-center rounded-full border-4 text-xs font-bold", doneRate.rate >= 80 ? "border-success text-success" : doneRate.rate >= 50 ? "border-warning text-warning" : "border-border text-muted-foreground")}>{doneRate.rate}%</span>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={tab === "atrasadas" ? "Nada atrasado" : tab === "hoje" ? "Nada para hoje" : tab === "futuras" ? "Nada agendado" : "Nenhuma tarefa feita ainda"}
          description="As tarefas de pós-venda nascem a cada venda registrada. Você também pode criar as suas."
        />
      ) : (
        <div className="space-y-2">
          {list.map((t) => {
            const c = t.contact_id ? byId.get(t.contact_id) : undefined;
            const K = KINDS[t.kind] ?? KINDS.outro;
            const late = bucket(t) === "atrasadas";
            return (
              <div key={t.id} className={cn("flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 shadow-card", t.status !== "pendente" && "opacity-60")}>
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", late ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}><K.icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-medium", t.status === "feita" && "line-through")}>{t.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {K.label} · {new Date(t.due_at).toLocaleDateString("pt-BR")}
                    {c && <> · {contactLabel(c)} {formatPhone(c.phone)}</>}
                    {t.assigned_to && seller === "all" && <> · {teamLabel(team.find((m) => m.user_id === t.assigned_to) ?? { user_id: "", email: "", full_name: null, role: "" })}</>}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {c && <Button size="icon-sm" variant="ghost" title="Abrir conversa" onClick={() => navigate(`/chat?contato=${c.id}`)}><MessageSquare /></Button>}
                  {t.status === "pendente" ? (
                    <>
                      <Button size="icon-sm" variant="ghost" title="Feita" className="text-success" onClick={() => void setStatus(t, "feita")}><Check /></Button>
                      <Button size="icon-sm" variant="ghost" title="Ignorar" className="text-muted-foreground" onClick={() => void setStatus(t, "ignorada")}><X /></Button>
                    </>
                  ) : (
                    <Button size="icon-sm" variant="ghost" title="Reabrir" onClick={() => void setStatus(t, "pendente")}><RotateCcw /></Button>
                  )}
                  <Button size="icon-sm" variant="ghost" title="Excluir" className="text-muted-foreground hover:text-destructive" onClick={() => company && void remove.mutateAsync({ id: t.id, company_id: company.id })}><Trash2 /></Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova tarefa</DialogTitle>
            <DialogDescription>Uma ação com dia para acontecer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>O que fazer</Label><Input placeholder="Ligar para confirmar o tamanho" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v as SellerTask["kind"] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(KINDS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Dia</Label><Input type="date" value={form.due} onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Cliente (opcional)</Label>
              <Select value={form.contact_id || "none"} onValueChange={(v) => setForm((f) => ({ ...f, contact_id: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem cliente</SelectItem>
                  {contacts.slice().sort((a, b) => contactLabel(a).localeCompare(contactLabel(b), "pt-BR")).map((c) => <SelectItem key={c.id} value={c.id}>{contactLabel(c)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Responsável</Label>
              <Select value={form.assigned_to || "none"} onValueChange={(v) => setForm((f) => ({ ...f, assigned_to: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ninguém</SelectItem>
                  {team.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{teamLabel(m)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={() => void handleCreate()} disabled={save.isPending}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useMemo, useState } from "react";
import { CalendarCheck, Clock, Plus, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useTasksQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation, useContactsQuery } from "@/hooks/queries";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, LoadingState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Filter = "today" | "week" | "all";

export default function Tasks() {
  const { user, company } = useAuth();
  const { data: tasks = [], isPending } = useTasksQuery(company?.id);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const createTask = useCreateTaskMutation();
  const updateTask = useUpdateTaskMutation();
  const deleteTask = useDeleteTaskMutation();

  const [filter, setFilter] = useState<Filter>("week");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: "", due_at: "", contact_id: "none" });

  const contactNameById = useMemo(
    () => new Map(contacts.map((c) => [c.id, c.name])),
    [contacts],
  );

  const visible = useMemo(() => {
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(now);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    return tasks.filter((t) => {
      if (filter === "all") return true;
      if (!t.due_at) return false;
      const due = new Date(t.due_at);
      if (filter === "today") return due <= endOfToday;
      return due <= endOfWeek;
    });
  }, [tasks, filter]);

  const pendingCount = visible.filter((t) => t.status !== "done").length;
  const overdueCount = visible.filter(
    (t) => t.status !== "done" && !!t.due_at && new Date(t.due_at) < new Date(),
  ).length;

  const handleCreate = async () => {
    if (!user || !company || !form.title.trim()) {
      toast.error("Título é obrigatório");
      return;
    }
    try {
      await createTask.mutateAsync({
        user_id: user.id,
        company_id: company.id,
        title: form.title.trim(),
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        contact_id: form.contact_id === "none" ? null : form.contact_id,
      });
      toast.success("Tarefa criada");
      setCreateOpen(false);
      setForm({ title: "", due_at: "", contact_id: "none" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar tarefa");
    }
  };

  const toggleDone = (taskId: string, done: boolean) => {
    if (!company) return;
    void updateTask.mutateAsync({ id: taskId, company_id: company.id, status: done ? "done" : "pending" });
  };

  return (
    <div>
      <PageHeader
        icon={CalendarCheck}
        title="Tarefas"
        description={
          pendingCount > 0
            ? `${pendingCount} ${pendingCount === 1 ? "tarefa pendente" : "tarefas pendentes"} no período`
            : "Nenhuma pendência no período"
        }
        badges={
          overdueCount > 0 ? (
            <Badge variant="destructive">
              {overdueCount} {overdueCount === 1 ? "atrasada" : "atrasadas"}
            </Badge>
          ) : null
        }
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus />
                Nova tarefa
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Nova tarefa</DialogTitle>
                <DialogDescription>Crie um lembrete ou compromisso.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Título</Label>
                  <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Data e hora</Label>
                  <Input
                    type="datetime-local"
                    value={form.due_at}
                    onChange={(e) => setForm((p) => ({ ...p, due_at: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Contato vinculado (opcional)</Label>
                  <Select value={form.contact_id} onValueChange={(v) => setForm((p) => ({ ...p, contact_id: v }))}>
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
                <Button className="w-full" onClick={handleCreate} disabled={createTask.isPending}>
                  {createTask.isPending ? "Criando..." : "Criar"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="mb-4">
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Hoje</SelectItem>
            <SelectItem value="week">Próximos 7 dias</SelectItem>
            <SelectItem value="all">Todas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isPending ? (
        <LoadingState label="Carregando tarefas..." />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="Nenhuma tarefa no período"
          description="Crie um lembrete para não perder o próximo follow-up com um cliente."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Nova tarefa
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {visible.map((task) => {
            const done = task.status === "done";
            const overdue = !done && !!task.due_at && new Date(task.due_at) < new Date();
            const contactName = task.contact_id ? contactNameById.get(task.contact_id) : undefined;
            return (
              <div
                key={task.id}
                className={cn(
                  "group flex items-center gap-3 rounded-xl border bg-card p-3.5 shadow-card transition-all hover:shadow-card-hover",
                  done && "bg-muted/40 shadow-none",
                  overdue && "border-destructive/40",
                )}
              >
                <Checkbox
                  checked={done}
                  onCheckedChange={(v) => toggleDone(task.id, v === true)}
                  aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      done && "text-muted-foreground line-through",
                    )}
                  >
                    {task.title}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        "tabular flex items-center gap-1",
                        overdue && "font-medium text-destructive",
                      )}
                    >
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      {task.due_at
                        ? new Date(task.due_at).toLocaleString("pt-BR", {
                            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                          })
                        : "Sem data"}
                      {overdue && " · atrasada"}
                    </span>
                    {contactName && (
                      <span className="flex min-w-0 items-center gap-1">
                        <User className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{contactName}</span>
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Excluir tarefa"
                  className="text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => company && void deleteTask.mutateAsync({ id: task.id, company_id: company.id })}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

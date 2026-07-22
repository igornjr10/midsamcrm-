import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useTasksQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation, useContactsQuery } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold">Tarefas</h2>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5">
              <Plus className="h-4 w-4" />
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
      </div>

      <div className="mb-4">
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Hoje</SelectItem>
            <SelectItem value="week">Próximos 7 dias</SelectItem>
            <SelectItem value="all">Todas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {isPending ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma tarefa no período</p>
        ) : (
          visible.map((task) => (
            <div
              key={task.id}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-card p-3",
                task.status === "done" && "opacity-60",
              )}
            >
              <Checkbox
                checked={task.status === "done"}
                onCheckedChange={(v) => toggleDone(task.id, v === true)}
              />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", task.status === "done" && "line-through")}>
                  {task.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {task.due_at
                    ? new Date(task.due_at).toLocaleString("pt-BR", {
                        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                      })
                    : "Sem data"}
                  {task.contact_id && contactNameById.get(task.contact_id) && (
                    <> · {contactNameById.get(task.contact_id)}</>
                  )}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => company && void deleteTask.mutateAsync({ id: task.id, company_id: company.id })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useUpdateContactMutation, useDeleteContactMutation, useCreateTaskMutation } from "@/hooks/queries";
import { PIPELINE_STAGES, getStageLabel, type Contact } from "@/lib/types";

interface ContactDetailModalProps {
  contact: Contact | null;
  open: boolean;
  onClose: () => void;
}

export default function ContactDetailModal({ contact, open, onClose }: ContactDetailModalProps) {
  const { user, company } = useAuth();
  const navigate = useNavigate();
  const updateContact = useUpdateContactMutation();
  const deleteContact = useDeleteContactMutation();
  const createTask = useCreateTaskMutation();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState("new");
  const [notes, setNotes] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueAt, setTaskDueAt] = useState("");

  useEffect(() => {
    if (!contact) return;
    setName(contact.name);
    setPhone(contact.phone ?? "");
    setEmail(contact.email ?? "");
    setStage(contact.stage);
    setNotes(contact.notes ?? "");
    setTaskTitle("");
    setTaskDueAt("");
  }, [contact]);

  if (!contact || !user || !company) return null;

  const handleSave = async () => {
    try {
      await updateContact.mutateAsync({
        id: contact.id,
        company_id: company.id,
        name: name.trim() || contact.name,
        phone: phone.trim() || null,
        email: email.trim() || null,
        stage,
        notes: notes.trim() || null,
      });
      toast.success("Contato salvo");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Excluir o contato "${contact.name}"? As mensagens e tarefas vinculadas também serão afetadas.`)) return;
    try {
      await deleteContact.mutateAsync({ id: contact.id, company_id: company.id });
      toast.success("Contato excluído");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    }
  };

  const handleCreateTask = async () => {
    if (!taskTitle.trim()) return;
    try {
      await createTask.mutateAsync({
        user_id: user.id,
        company_id: company.id,
        title: taskTitle.trim(),
        due_at: taskDueAt ? new Date(taskDueAt).toISOString() : null,
        contact_id: contact.id,
      });
      toast.success("Tarefa criada");
      setTaskTitle("");
      setTaskDueAt("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar tarefa");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {contact.name}
            <Badge variant="outline">{getStageLabel(contact.stage)}</Badge>
          </DialogTitle>
          <DialogDescription>Edite os dados do contato ou crie uma tarefa vinculada.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                onClose();
                navigate(`/chat?contato=${contact.id}`);
              }}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Abrir conversa
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={handleDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              Excluir
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Telefone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Etapa do funil</Label>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="rounded-lg border p-3">
            <p className="mb-2 text-sm font-medium">Nova tarefa para este contato</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="Título da tarefa"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
              />
              <Input
                type="datetime-local"
                value={taskDueAt}
                onChange={(e) => setTaskDueAt(e.target.value)}
                className="sm:w-52"
              />
              <Button variant="outline" onClick={handleCreateTask} disabled={!taskTitle.trim() || createTask.isPending}>
                Criar
              </Button>
            </div>
          </div>

          <Button className="w-full" onClick={handleSave} disabled={updateContact.isPending}>
            {updateContact.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

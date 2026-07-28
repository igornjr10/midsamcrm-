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
import {
  useUpdateContactMutation, useDeleteContactMutation, useCreateAppointmentMutation, usePipelineStagesQuery,
} from "@/hooks/queries";
import { getStageLabel, getStageTone, type Contact } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  const createAppointment = useCreateAppointmentMutation();
  const { data: stages = [] } = usePipelineStagesQuery(company?.id);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState("new");
  const [notes, setNotes] = useState("");
  const [apptTitle, setApptTitle] = useState("");
  const [apptStartsAt, setApptStartsAt] = useState("");

  useEffect(() => {
    if (!contact) return;
    setName(contact.name);
    setPhone(contact.phone ?? "");
    setEmail(contact.email ?? "");
    setStage(contact.stage);
    setNotes(contact.notes ?? "");
    setApptTitle("");
    setApptStartsAt("");
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

  const handleCreateAppointment = async () => {
    if (!apptTitle.trim() || !apptStartsAt) return;
    const startsAt = new Date(apptStartsAt);
    if (Number.isNaN(startsAt.getTime())) {
      toast.error("Data inválida");
      return;
    }
    try {
      await createAppointment.mutateAsync({
        user_id: user.id,
        company_id: company.id,
        title: apptTitle.trim(),
        starts_at: startsAt.toISOString(),
        contact_id: contact.id,
      });
      toast.success("Compromisso agendado");
      setApptTitle("");
      setApptStartsAt("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao agendar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {contact.name.trim().charAt(0).toUpperCase() || "?"}
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate">{contact.name}</span>
              <Badge variant="outline" className={cn(getStageTone(stages, contact.stage).badge)}>
                {getStageLabel(stages, contact.stage)}
              </Badge>
            </span>
          </DialogTitle>
          <DialogDescription>Edite os dados do contato ou agende um compromisso.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onClose();
                navigate(`/chat?contato=${contact.id}`);
              }}
            >
              <MessageSquare />
              Abrir conversa
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 />
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
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.key}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="mb-2 text-sm font-medium">Novo compromisso com este contato</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="Ex: reunião de apresentação"
                value={apptTitle}
                onChange={(e) => setApptTitle(e.target.value)}
              />
              <Input
                type="datetime-local"
                value={apptStartsAt}
                onChange={(e) => setApptStartsAt(e.target.value)}
                className="sm:w-52"
              />
              <Button
                variant="outline"
                onClick={handleCreateAppointment}
                disabled={!apptTitle.trim() || !apptStartsAt || createAppointment.isPending}
              >
                Agendar
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

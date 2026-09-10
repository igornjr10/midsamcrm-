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
  useContactFieldsQuery,
} from "@/hooks/queries";
import { getStageLabel, getStageTone, type Contact, type ContactFieldValue } from "@/lib/types";
import ContactFieldsForm from "@/components/contacts/ContactFieldsForm";
import TagPicker from "@/components/contacts/TagPicker";
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
  const { data: fieldDefs = [] } = useContactFieldsQuery(company?.id);

  const [name, setName] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, ContactFieldValue>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [stage, setStage] = useState("new");
  const [notes, setNotes] = useState("");
  const [apptTitle, setApptTitle] = useState("");
  const [apptStartsAt, setApptStartsAt] = useState("");

  useEffect(() => {
    if (!contact) return;
    setName(contact.name);
    setPhone(contact.phone ?? "");
    setEmail(contact.email ?? "");
    setBirthDate(contact.birth_date ?? "");
    setStage(contact.stage);
    setNotes(contact.notes ?? "");
    setFieldValues({ ...(contact.fields ?? {}) });
    setTags([...(contact.tags ?? [])]);
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
        birth_date: birthDate || null,
        stage,
        notes: notes.trim() || null,
        fields: fieldValues,
        tags,
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Telefone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Data de nascimento</Label>
              <Input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
              {/* Só o dia e o mês são usados: é o gatilho da régua de aniversário. */}
              <p className="text-xs text-muted-foreground">Usada pela régua de aniversário</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Etiquetas</Label>
            <TagPicker value={tags} onChange={setTags} />
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
          {fieldDefs.length > 0 && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Dados do negócio
              </p>
              <ContactFieldsForm
                fields={fieldDefs}
                values={fieldValues}
                onChange={(key, value) => setFieldValues((p) => ({ ...p, [key]: value }))}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-xs sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground">Entrou em contato</p>
              <p className="tabular mt-0.5 font-medium">
                {new Date(contact.created_at).toLocaleDateString("pt-BR")}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Última interação</p>
              <p className="tabular mt-0.5 font-medium">
                {contact.last_interaction_at
                  ? new Date(contact.last_interaction_at).toLocaleString("pt-BR", {
                      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                    })
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Última fala do lead</p>
              <p className="tabular mt-0.5 font-medium">
                {contact.last_inbound_at
                  ? new Date(contact.last_inbound_at).toLocaleString("pt-BR", {
                      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                    })
                  : "—"}
              </p>
            </div>
          </div>

          {contact.closing_signal_at && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950">
              <p className="font-medium text-emerald-800 dark:text-emerald-300">
                Sinal de fechamento · {contact.closing_signal_label ?? "detectado"} ·{" "}
                {new Date(contact.closing_signal_at).toLocaleDateString("pt-BR")}
              </p>
              {contact.closing_signal_excerpt && (
                <p className="mt-1 text-emerald-700 dark:text-emerald-400">
                  “{contact.closing_signal_excerpt}”
                </p>
              )}
            </div>
          )}

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

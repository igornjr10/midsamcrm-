import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactFieldsQuery,
  useCreateContactFieldMutation,
  useUpdateContactFieldMutation,
  useDeleteContactFieldMutation,
  useContactsQuery,
} from "@/hooks/queries";
import type { ContactField, ContactFieldType } from "@/lib/types";
import { fieldKeyFromLabel } from "@/lib/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const TYPE_LABEL: Record<ContactFieldType, string> = {
  text: "Texto",
  number: "Número",
  date: "Data",
  select: "Lista",
};

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Onde a empresa decide o que quer saber de cada contato além de nome,
 * telefone e e-mail. Os campos do nicho já chegam prontos; aqui ela renomeia,
 * reordena, marca o que aparece no card e cria os seus.
 */
export default function ContactFieldsDialog({ open, onOpenChange }: Props) {
  const { company } = useAuth();
  const { data: fields = [] } = useContactFieldsQuery(company?.id);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const createField = useCreateContactFieldMutation();
  const updateField = useUpdateContactFieldMutation();
  const deleteField = useDeleteContactFieldMutation();

  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<ContactFieldType>("text");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});

  const filledIn = (key: string) =>
    contacts.filter((c) => {
      const v = c.fields?.[key];
      return v !== null && v !== undefined && v !== "";
    }).length;

  const patch = async (field: ContactField, values: Partial<ContactField>) => {
    if (!company) return;
    try {
      await updateField.mutateAsync({ id: field.id, company_id: company.id, ...values });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar campo");
    }
  };

  const rename = async (field: ContactField) => {
    const label = (drafts[field.id] ?? field.label).trim();
    setDrafts((p) => {
      const next = { ...p };
      delete next[field.id];
      return next;
    });
    if (!label || label === field.label) return;
    await patch(field, { label });
  };

  const saveOptions = async (field: ContactField) => {
    const raw = optionDrafts[field.id];
    setOptionDrafts((p) => {
      const next = { ...p };
      delete next[field.id];
      return next;
    });
    if (raw === undefined) return;
    const options = raw.split(",").map((o) => o.trim()).filter(Boolean);
    if (options.join("|") === field.options.join("|")) return;
    await patch(field, { options });
  };

  const move = async (index: number, direction: -1 | 1) => {
    const current = fields[index];
    const neighbor = fields[index + direction];
    if (!current || !neighbor) return;
    await patch(current, { position: neighbor.position });
    await patch(neighbor, { position: current.position });
  };

  const remove = async (field: ContactField) => {
    if (!company) return;
    const used = filledIn(field.key);
    const aviso = used > 0
      ? `Excluir o campo "${field.label}"? ${used} ${used === 1 ? "contato tem" : "contatos têm"} valor nele; o valor deixa de aparecer.`
      : `Excluir o campo "${field.label}"?`;
    if (!window.confirm(aviso)) return;
    try {
      await deleteField.mutateAsync({ id: field.id, company_id: company.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir campo");
    }
  };

  const add = async () => {
    const label = newLabel.trim();
    if (!company || !label) return;
    const lastPosition = fields.length > 0 ? fields[fields.length - 1].position : 0;
    try {
      await createField.mutateAsync({
        company_id: company.id,
        key: fieldKeyFromLabel(label),
        label,
        type: newType,
        options: [],
        show_on_card: false,
        position: lastPosition + 1,
      });
      setNewLabel("");
      setNewType("text");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar campo");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Campos do contato</DialogTitle>
          <DialogDescription>
            O que a sua equipe precisa saber de cada contato. Os campos marcados aparecem no card do
            Pipeline e no painel do Chat; a IA enxerga todos ao conversar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {fields.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nenhum campo ainda. Crie o primeiro abaixo.
            </p>
          )}
          {fields.map((field, index) => (
            <div key={field.id} className="space-y-2 rounded-lg border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="h-9 min-w-40 flex-1"
                  value={drafts[field.id] ?? field.label}
                  onChange={(e) => setDrafts((p) => ({ ...p, [field.id]: e.target.value }))}
                  onBlur={() => void rename(field)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  aria-label="Nome do campo"
                />

                <Select
                  value={field.type}
                  onValueChange={(v) => void patch(field, { type: v as ContactFieldType })}
                >
                  <SelectTrigger aria-label="Tipo do campo" className="h-9 w-28 shrink-0">
                    <span>{TYPE_LABEL[field.type]}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_LABEL).map(([type, label]) => (
                      <SelectItem key={type} value={type}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={field.show_on_card}
                    onCheckedChange={(v) => void patch(field, { show_on_card: v === true })}
                  />
                  No card
                </label>

                <span className="tabular w-24 shrink-0 text-center text-xs text-muted-foreground">
                  {filledIn(field.key)} preenchido{filledIn(field.key) === 1 ? "" : "s"}
                </span>

                <div className="flex shrink-0 items-center gap-1">
                  <Button size="icon-sm" variant="ghost" aria-label="Mover para cima" disabled={index === 0} onClick={() => void move(index, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Mover para baixo" disabled={index === fields.length - 1} onClick={() => void move(index, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Excluir campo"
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void remove(field)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              {field.type === "select" && (
                <Input
                  className="h-9"
                  placeholder="Opções separadas por vírgula: Casamento, Aniversário, Formatura"
                  value={optionDrafts[field.id] ?? field.options.join(", ")}
                  onChange={(e) => setOptionDrafts((p) => ({ ...p, [field.id]: e.target.value }))}
                  onBlur={() => void saveOptions(field)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  aria-label="Opções da lista"
                />
              )}
            </div>
          ))}
        </div>

        <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3">
          <Label>Novo campo</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Ex: Data do evento, Vencimento, Unidade..."
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
            />
            <Select value={newType} onValueChange={(v) => setNewType(v as ContactFieldType)}>
              <SelectTrigger className="sm:w-32">
                <span>{TYPE_LABEL[newType]}</span>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_LABEL).map(([type, label]) => (
                  <SelectItem key={type} value={type}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void add()} disabled={!newLabel.trim() || createField.isPending}>
              <Plus />
              Adicionar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Campo de data ganha aviso no card quando faltam 7 dias ou menos.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

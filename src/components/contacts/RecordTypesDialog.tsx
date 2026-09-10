import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useRecordTypesQuery,
  useCreateRecordTypeMutation,
  useUpdateRecordTypeMutation,
  useDeleteRecordTypeMutation,
  useContactRecordsQuery,
} from "@/hooks/queries";
import type { ContactFieldType, FieldDef, RecordType } from "@/lib/types";
import { fieldKeyFromLabel } from "@/lib/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
 * Os tipos de registro da empresa: o que cada um guarda e qual campo é a data
 * principal (a que as réguas por data e a lista por vencimento usam).
 */
export default function RecordTypesDialog({ open, onOpenChange }: Props) {
  const { company } = useAuth();
  const { data: types = [] } = useRecordTypesQuery(company?.id);
  const { data: records = [] } = useContactRecordsQuery(company?.id);
  const createType = useCreateRecordTypeMutation();
  const updateType = useUpdateRecordTypeMutation();
  const deleteType = useDeleteRecordTypeMutation();

  const [newLabel, setNewLabel] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Partial<Pick<RecordType, "label" | "label_plural">>>>({});
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, { label: string; type: ContactFieldType }>>({});
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});

  const countOf = (key: string) => records.filter((r) => r.type_key === key).length;

  const patch = async (
    type: RecordType,
    values: Partial<Pick<RecordType, "label" | "label_plural" | "fields" | "date_field_key" | "position">>,
  ) => {
    if (!company) return;
    try {
      await updateType.mutateAsync({ id: type.id, company_id: company.id, ...values });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const commitLabels = async (type: RecordType) => {
    const d = drafts[type.id];
    setDrafts((p) => {
      const next = { ...p };
      delete next[type.id];
      return next;
    });
    if (!d) return;
    const label = (d.label ?? type.label).trim() || type.label;
    const label_plural = (d.label_plural ?? type.label_plural).trim() || type.label_plural;
    if (label === type.label && label_plural === type.label_plural) return;
    await patch(type, { label, label_plural });
  };

  const setFields = (type: RecordType, fields: FieldDef[]) => {
    const dateStillThere = fields.some((f) => f.key === type.date_field_key && f.type === "date");
    return patch(type, { fields, ...(dateStillThere ? {} : { date_field_key: null }) });
  };

  const addField = async (type: RecordType) => {
    const d = fieldDrafts[type.id];
    const label = d?.label.trim();
    if (!label) return;
    const key = fieldKeyFromLabel(label);
    if (type.fields.some((f) => f.key === key)) {
      toast.error("Já existe um campo com esse nome neste tipo.");
      return;
    }
    await setFields(type, [...type.fields, { key, label, type: d.type, options: [] }]);
    setFieldDrafts((p) => ({ ...p, [type.id]: { label: "", type: "text" } }));
  };

  const removeField = async (type: RecordType, key: string) => {
    if (!window.confirm("Excluir este campo? O valor some dos registros que o têm.")) return;
    await setFields(type, type.fields.filter((f) => f.key !== key));
  };

  const saveOptions = async (type: RecordType, key: string) => {
    const id = `${type.id}:${key}`;
    const raw = optionDrafts[id];
    setOptionDrafts((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
    if (raw === undefined) return;
    const options = raw.split(",").map((o) => o.trim()).filter(Boolean);
    await setFields(type, type.fields.map((f) => (f.key === key ? { ...f, options } : f)));
  };

  const removeType = async (type: RecordType) => {
    if (!company) return;
    const n = countOf(type.key);
    const aviso = n > 0
      ? `Excluir "${type.label_plural}"? Os ${n} registros continuam no banco, mas somem das telas.`
      : `Excluir "${type.label_plural}"?`;
    if (!window.confirm(aviso)) return;
    try {
      await deleteType.mutateAsync({ id: type.id, company_id: company.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    }
  };

  const addType = async () => {
    const label = newLabel.trim();
    if (!company || !label) return;
    const last = types.length > 0 ? types[types.length - 1].position : 0;
    try {
      await createType.mutateAsync({
        company_id: company.id,
        key: fieldKeyFromLabel(label),
        label,
        label_plural: label.endsWith("s") ? label : `${label}s`,
        fields: [],
        date_field_key: null,
        position: last + 1,
      });
      setNewLabel("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar tipo");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Registros do contato</DialogTitle>
          <DialogDescription>
            O que um contato pode ter vários: apólices, pacotes, unidades. Cada tipo tem seus campos
            e uma data principal, que as réguas por data e a lista por vencimento usam.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {types.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nenhum tipo de registro ainda.
            </p>
          )}
          {types.map((type) => {
            const dateFields = type.fields.filter((f) => f.type === "date");
            const fd = fieldDrafts[type.id] ?? { label: "", type: "text" as ContactFieldType };
            return (
              <div key={type.id} className="space-y-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-32 flex-1 space-y-1">
                    <Label className="text-xs">Nome</Label>
                    <Input
                      className="h-9"
                      value={drafts[type.id]?.label ?? type.label}
                      onChange={(e) => setDrafts((p) => ({ ...p, [type.id]: { ...p[type.id], label: e.target.value } }))}
                      onBlur={() => void commitLabels(type)}
                    />
                  </div>
                  <div className="min-w-32 flex-1 space-y-1">
                    <Label className="text-xs">Plural</Label>
                    <Input
                      className="h-9"
                      value={drafts[type.id]?.label_plural ?? type.label_plural}
                      onChange={(e) => setDrafts((p) => ({ ...p, [type.id]: { ...p[type.id], label_plural: e.target.value } }))}
                      onBlur={() => void commitLabels(type)}
                    />
                  </div>
                  <div className="min-w-40 space-y-1">
                    <Label className="text-xs">Data principal</Label>
                    <Select
                      value={type.date_field_key ?? "__none"}
                      onValueChange={(v) => void patch(type, { date_field_key: v === "__none" ? null : v })}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Nenhuma</SelectItem>
                        {dateFields.map((f) => (
                          <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <span className="tabular pb-2 text-xs text-muted-foreground">
                    {countOf(type.key)} {countOf(type.key) === 1 ? "registro" : "registros"}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Excluir tipo"
                    className="mb-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void removeType(type)}
                  >
                    <Trash2 />
                  </Button>
                </div>

                <div className="space-y-1.5">
                  {type.fields.map((f) => (
                    <div key={f.key} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-sm">
                      <span className="min-w-28 flex-1 font-medium">{f.label}</span>
                      <span className="text-xs text-muted-foreground">{TYPE_LABEL[f.type]}</span>
                      {f.type === "select" && (
                        <Input
                          className="h-8 min-w-48 flex-[2] text-xs"
                          placeholder="Opções separadas por vírgula"
                          value={optionDrafts[`${type.id}:${f.key}`] ?? f.options.join(", ")}
                          onChange={(e) => setOptionDrafts((p) => ({ ...p, [`${type.id}:${f.key}`]: e.target.value }))}
                          onBlur={() => void saveOptions(type, f.key)}
                          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        />
                      )}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Excluir campo"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void removeField(type, f.key)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      className="h-9"
                      placeholder="Novo campo: Seguradora, Validade..."
                      value={fd.label}
                      onChange={(e) => setFieldDrafts((p) => ({ ...p, [type.id]: { ...fd, label: e.target.value } }))}
                      onKeyDown={(e) => e.key === "Enter" && void addField(type)}
                    />
                    <Select value={fd.type} onValueChange={(v) => setFieldDrafts((p) => ({ ...p, [type.id]: { ...fd, type: v as ContactFieldType } }))}>
                      <SelectTrigger className="h-9 sm:w-32">
                        <span>{TYPE_LABEL[fd.type]}</span>
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(TYPE_LABEL).map(([t, l]) => (
                          <SelectItem key={t} value={t}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="h-9" onClick={() => void addField(type)} disabled={!fd.label.trim()}>
                      <Plus />
                      Campo
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3">
          <Label>Novo tipo de registro</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Ex: Apólice, Pacote, Unidade, Veículo..."
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addType()}
            />
            <Button variant="outline" onClick={() => void addType()} disabled={!newLabel.trim() || createType.isPending}>
              <Plus />
              Adicionar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

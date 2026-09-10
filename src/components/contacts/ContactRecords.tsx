import { useState } from "react";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useRecordTypesQuery,
  useContactRecordsQuery,
  useSaveContactRecordMutation,
  useDeleteContactRecordMutation,
} from "@/hooks/queries";
import type { Contact, ContactFieldValue, ContactRecord, RecordType } from "@/lib/types";
import { dateHint, recordSummary } from "@/lib/fields";
import ContactFieldsForm from "@/components/contacts/ContactFieldsForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Draft = {
  id: string | null;
  type: RecordType;
  title: string;
  fields: Record<string, ContactFieldValue>;
};

/**
 * Os registros de um contato, agrupados por tipo: as apólices, o pacote, a
 * unidade. Cada tipo tem sua lista e seu "Adicionar"; editar abre o mesmo
 * formulário. `compact` é a versão do painel do Chat: só leitura, sem botões.
 */
export default function ContactRecords({ contact, compact }: { contact: Contact; compact?: boolean }) {
  const { company } = useAuth();
  const { data: types = [] } = useRecordTypesQuery(company?.id);
  const { data: allRecords = [] } = useContactRecordsQuery(company?.id);
  const save = useSaveContactRecordMutation();
  const remove = useDeleteContactRecordMutation();

  const [draft, setDraft] = useState<Draft | null>(null);

  if (types.length === 0) return null;

  const records = allRecords.filter((r) => r.contact_id === contact.id);

  const openNew = (type: RecordType) => setDraft({ id: null, type, title: "", fields: {} });
  const openEdit = (type: RecordType, r: ContactRecord) =>
    setDraft({ id: r.id, type, title: r.title, fields: { ...r.fields } });

  const handleSave = async () => {
    if (!company || !draft) return;
    const title = draft.title.trim() || recordSummary(draft.type, draft.fields) || draft.type.label;
    try {
      await save.mutateAsync({
        id: draft.id,
        company_id: company.id,
        contact_id: contact.id,
        type_key: draft.type.key,
        title,
        fields: draft.fields,
      });
      toast.success(`${draft.type.label} salvo.`);
      setDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const handleRemove = async () => {
    if (!company || !draft?.id) return;
    if (!window.confirm(`Excluir "${draft.title}"?`)) return;
    try {
      await remove.mutateAsync({ id: draft.id, company_id: company.id });
      setDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    }
  };

  return (
    <>
      {types.map((type) => {
        const list = records.filter((r) => r.type_key === type.key);
        if (compact && list.length === 0) return null;
        return (
          <div key={type.id}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {type.label_plural}
                {list.length > 0 && <span className="ml-1.5 tabular font-medium">{list.length}</span>}
              </p>
              {!compact && (
                <Button size="sm" variant="ghost" onClick={() => openNew(type)}>
                  <Plus />
                  {type.label}
                </Button>
              )}
            </div>
            {list.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Nenhum registro de {type.label.toLowerCase()}.
              </p>
            ) : (
              <div className="space-y-1.5">
                {list.map((r) => {
                  const hint = r.main_date ? dateHint(r.main_date) : null;
                  const dateLabel = type.fields.find((f) => f.key === type.date_field_key)?.label;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={compact}
                      onClick={() => openEdit(type, r)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors",
                        !compact && "hover:border-primary/40 hover:bg-muted/40",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium leading-tight">{r.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {recordSummary(type, r.fields, r.title)}
                        </span>
                      </span>
                      {hint && (
                        <span
                          className={cn(
                            "tabular flex shrink-0 items-center gap-1 text-xs",
                            hint.urgent ? "font-medium text-warning" : "text-muted-foreground",
                          )}
                          title={dateLabel}
                        >
                          <CalendarClock className="h-3.5 w-3.5" />
                          {hint.label}
                          {hint.relative && ` · ${hint.relative}`}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <Dialog open={!!draft} onOpenChange={(v) => !v && setDraft(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {draft?.id ? `Editar ${draft.type.label.toLowerCase()}` : `Novo ${draft?.type.label.toLowerCase() ?? "registro"}`}
            </DialogTitle>
            <DialogDescription>De {contact.name}</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Título</Label>
                <Input
                  placeholder={`Ex: ${draft.type.label} principal`}
                  value={draft.title}
                  onChange={(e) => setDraft((d) => d && { ...d, title: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Vazio, monta a partir dos campos.</p>
              </div>
              <ContactFieldsForm
                fields={draft.type.fields}
                values={draft.fields}
                onChange={(key, value) =>
                  setDraft((d) => d && { ...d, fields: { ...d.fields, [key]: value } })
                }
              />
            </div>
          )}
          <DialogFooter className="sm:justify-between">
            {draft?.id ? (
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => void handleRemove()}
                disabled={remove.isPending}
              >
                <Trash2 />
                Excluir
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
              <Button onClick={() => void handleSave()} disabled={save.isPending}>
                {save.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

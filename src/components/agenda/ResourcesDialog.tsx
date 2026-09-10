import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useResourcesQuery, useSaveResourceMutation, useDeleteResourceMutation } from "@/hooks/queries";
import { RESOURCE_KINDS, type Resource } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

/** Quem ou o que atende: profissionais, salas, equipamentos. */
export default function ResourcesDialog({ open, onOpenChange }: Props) {
  const { company } = useAuth();
  const { data: resources = [] } = useResourcesQuery(company?.id);
  const save = useSaveResourceMutation();
  const remove = useDeleteResourceMutation();

  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<Resource["kind"]>("profissional");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const patch = async (r: Resource, values: Partial<Pick<Resource, "name" | "kind" | "active">>) => {
    if (!company) return;
    try {
      await save.mutateAsync({ id: r.id, company_id: company.id, name: r.name, kind: r.kind, active: r.active, ...values });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const rename = async (r: Resource) => {
    const name = (drafts[r.id] ?? r.name).trim();
    setDrafts((p) => {
      const next = { ...p };
      delete next[r.id];
      return next;
    });
    if (!name || name === r.name) return;
    await patch(r, { name });
  };

  const add = async () => {
    const name = newName.trim();
    if (!company || !name) return;
    try {
      await save.mutateAsync({ id: null, company_id: company.id, name, kind: newKind, position: resources.length + 1 });
      setNewName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar");
    }
  };

  const handleRemove = async (r: Resource) => {
    if (!company || !window.confirm(`Excluir "${r.name}"? Os compromissos ficam, só perdem o vínculo.`)) return;
    try {
      await remove.mutateAsync({ id: r.id, company_id: company.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Recursos da agenda</DialogTitle>
          <DialogDescription>
            Profissionais, salas e equipamentos. O compromisso aponta para um deles, e a agenda
            filtra por recurso. Inativo some das opções sem perder o histórico.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {resources.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nenhum recurso ainda.
            </p>
          )}
          {resources.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
              <Input
                className="h-9 min-w-32 flex-1"
                value={drafts[r.id] ?? r.name}
                onChange={(e) => setDrafts((p) => ({ ...p, [r.id]: e.target.value }))}
                onBlur={() => void rename(r)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                aria-label="Nome do recurso"
              />
              <Select value={r.kind} onValueChange={(v) => void patch(r, { kind: v as Resource["kind"] })}>
                <SelectTrigger className="h-9 w-36">
                  <span>{RESOURCE_KINDS.find((k) => k.id === r.kind)?.label}</span>
                </SelectTrigger>
                <SelectContent>
                  {RESOURCE_KINDS.map((k) => <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox checked={r.active} onCheckedChange={(v) => void patch(r, { active: v === true })} />
                Ativo
              </label>
              <Button
                size="icon-sm" variant="ghost" aria-label="Excluir recurso"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => void handleRemove(r)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3">
          <Label>Novo recurso</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Ex: Dra. Ana, Sala 2, Laser"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
            />
            <Select value={newKind} onValueChange={(v) => setNewKind(v as Resource["kind"])}>
              <SelectTrigger className="sm:w-36">
                <span>{RESOURCE_KINDS.find((k) => k.id === newKind)?.label}</span>
              </SelectTrigger>
              <SelectContent>
                {RESOURCE_KINDS.map((k) => <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void add()} disabled={!newName.trim() || save.isPending}>
              <Plus />
              Adicionar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactTagsQuery,
  useCreateContactTagMutation,
  useUpdateContactTagMutation,
  useDeleteContactTagMutation,
  useContactsQuery,
} from "@/hooks/queries";
import { STAGE_TONES, type ContactTag, type StageTone } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

/** O catálogo de etiquetas da empresa: nome, cor e se chama humano. */
export default function TagsDialog({ open, onOpenChange }: Props) {
  const { company } = useAuth();
  const { data: tags = [] } = useContactTagsQuery(company?.id);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const createTag = useCreateContactTagMutation();
  const updateTag = useUpdateContactTagMutation();
  const deleteTag = useDeleteContactTagMutation();

  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const usedBy = (name: string) => contacts.filter((c) => c.tags?.includes(name)).length;

  const patch = async (tag: ContactTag, values: Partial<Pick<ContactTag, "name" | "tone" | "escalate">>) => {
    if (!company) return;
    try {
      await updateTag.mutateAsync({ id: tag.id, company_id: company.id, ...values });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar etiqueta");
    }
  };

  const rename = async (tag: ContactTag) => {
    const name = (drafts[tag.id] ?? tag.name).trim();
    setDrafts((p) => {
      const next = { ...p };
      delete next[tag.id];
      return next;
    });
    if (!name || name === tag.name) return;
    await patch(tag, { name });
  };

  const remove = async (tag: ContactTag) => {
    if (!company) return;
    const n = usedBy(tag.name);
    const aviso = n > 0
      ? `Excluir "${tag.name}"? Ela sai de ${n} ${n === 1 ? "contato" : "contatos"}.`
      : `Excluir "${tag.name}"?`;
    if (!window.confirm(aviso)) return;
    try {
      await deleteTag.mutateAsync({ id: tag.id, company_id: company.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir etiqueta");
    }
  };

  const add = async () => {
    const name = newName.trim();
    if (!company || !name) return;
    const last = tags.length > 0 ? tags[tags.length - 1].position : 0;
    try {
      await createTag.mutateAsync({ company_id: company.id, name, tone: "slate", position: last + 1 });
      setNewName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar etiqueta");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Etiquetas</DialogTitle>
          <DialogDescription>
            Recortes livres da base: VIP, Atacado, Sinistro. Filtram Contatos e Disparos e a IA
            pode marcar. Etiqueta que "chama humano" pausa a IA e avisa a equipe ao ser aplicada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {tags.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nenhuma etiqueta ainda.
            </p>
          )}
          {tags.map((tag) => (
            <div key={tag.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
              <Select value={tag.tone} onValueChange={(v) => void patch(tag, { tone: v as StageTone })}>
                <SelectTrigger aria-label="Cor" className="h-9 w-auto shrink-0 gap-1.5 px-2.5">
                  <span className={cn("h-2.5 w-2.5 rounded-full", STAGE_TONES[tag.tone]?.dot)} />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STAGE_TONES).map(([tone, { label, dot }]) => (
                    <SelectItem key={tone} value={tone}>
                      <span className="flex items-center gap-2">
                        <span className={cn("h-2.5 w-2.5 rounded-full", dot)} />
                        {label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-9 min-w-32 flex-1"
                value={drafts[tag.id] ?? tag.name}
                onChange={(e) => setDrafts((p) => ({ ...p, [tag.id]: e.target.value }))}
                onBlur={() => void rename(tag)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                aria-label="Nome da etiqueta"
              />
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={tag.escalate}
                  onCheckedChange={(v) => void patch(tag, { escalate: v === true })}
                />
                Chama humano
              </label>
              <span className="tabular w-20 shrink-0 text-center text-xs text-muted-foreground">
                {usedBy(tag.name)} {usedBy(tag.name) === 1 ? "contato" : "contatos"}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Excluir etiqueta"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => void remove(tag)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3">
          <Label>Nova etiqueta</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Ex: VIP, Atacado, Sinistro..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
            />
            <Button variant="outline" onClick={() => void add()} disabled={!newName.trim() || createTag.isPending}>
              <Plus />
              Adicionar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

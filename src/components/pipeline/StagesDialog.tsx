import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  usePipelineStagesQuery,
  useCreateStageMutation,
  useUpdateStageMutation,
  useDeleteStageMutation,
  stageKeyFromName,
  useContactsQuery,
} from "@/hooks/queries";
import { STAGE_TONES, type PipelineStage, type StageKind, type StageTone } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<StageKind, string> = {
  open: "Em aberto",
  won: "Ganho",
  lost: "Perdido",
};

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

export default function StagesDialog({ open, onOpenChange }: Props) {
  const { company } = useAuth();
  const { data: stages = [] } = usePipelineStagesQuery(company?.id);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const createStage = useCreateStageMutation();
  const updateStage = useUpdateStageMutation();
  const deleteStage = useDeleteStageMutation();

  const [newName, setNewName] = useState("");

  // Nome em edição: o input é controlado localmente e só grava ao sair do campo,
  // senão cada tecla viraria um update.
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});

  const countIn = (key: string) => contacts.filter((c) => c.stage === key).length;

  const rename = async (stage: PipelineStage) => {
    const name = (draftNames[stage.id] ?? stage.name).trim();
    setDraftNames((p) => {
      const next = { ...p };
      delete next[stage.id];
      return next;
    });
    if (!company || !name || name === stage.name) return;
    try {
      await updateStage.mutateAsync({ id: stage.id, company_id: company.id, name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao renomear");
    }
  };

  const patch = async (stage: PipelineStage, values: Partial<PipelineStage>) => {
    if (!company) return;
    try {
      await updateStage.mutateAsync({ id: stage.id, company_id: company.id, ...values });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar etapa");
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const current = stages[index];
    const neighbor = stages[index + direction];
    if (!current || !neighbor) return;
    // Troca as posições em vez de renumerar a lista toda.
    await patch(current, { position: neighbor.position });
    await patch(neighbor, { position: current.position });
  };

  const remove = async (stage: PipelineStage) => {
    if (!company) return;
    const used = countIn(stage.key);
    if (used > 0) {
      toast.error(
        `${used} ${used === 1 ? "contato está" : "contatos estão"} em "${stage.name}". Mova ${used === 1 ? "ele" : "eles"} antes de excluir.`,
      );
      return;
    }
    if (stages.length <= 1) {
      toast.error("O funil precisa de pelo menos uma etapa.");
      return;
    }
    if (!window.confirm(`Excluir a etapa "${stage.name}"?`)) return;
    try {
      await deleteStage.mutateAsync({ id: stage.id, company_id: company.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir etapa");
    }
  };

  const add = async () => {
    const name = newName.trim();
    if (!company || !name) return;
    const lastPosition = stages.length > 0 ? stages[stages.length - 1].position : 0;
    try {
      await createStage.mutateAsync({
        company_id: company.id,
        key: stageKeyFromName(name),
        name,
        tone: "slate",
        kind: "open",
        position: lastPosition + 1,
      });
      setNewName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar etapa");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Etapas do funil</DialogTitle>
          <DialogDescription>
            Renomeie, reordene, mude a cor ou crie etapas. As mudanças valem para o Pipeline,
            Contatos, Chat e Disparos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {stages.map((stage, index) => (
            <div key={stage.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
              <Select
                value={stage.tone}
                onValueChange={(v) => void patch(stage, { tone: v as StageTone })}
              >
                <SelectTrigger aria-label="Cor da etapa" className="h-9 w-auto shrink-0 gap-1.5 px-2.5">
                  <span className="flex items-center gap-1.5">
                    <span className={cn("h-2.5 w-2.5 rounded-full", STAGE_TONES[stage.tone]?.dot)} />
                  </span>
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
                className="h-9 min-w-40 flex-1"
                value={draftNames[stage.id] ?? stage.name}
                onChange={(e) => setDraftNames((p) => ({ ...p, [stage.id]: e.target.value }))}
                onBlur={() => void rename(stage)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                aria-label="Nome da etapa"
              />

              <Select
                value={stage.kind}
                onValueChange={(v) => void patch(stage, { kind: v as StageKind })}
              >
                <SelectTrigger aria-label="Tipo da etapa" className="h-9 w-36 shrink-0">
                  <span>{KIND_LABEL[stage.kind]}</span>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(KIND_LABEL).map(([kind, label]) => (
                    <SelectItem key={kind} value={kind}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className="tabular w-20 shrink-0 text-center text-xs text-muted-foreground">
                {countIn(stage.key)} {countIn(stage.key) === 1 ? "contato" : "contatos"}
              </span>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Mover para cima"
                  disabled={index === 0}
                  onClick={() => void move(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Mover para baixo"
                  disabled={index === stages.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Excluir etapa"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => void remove(stage)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3">
          <Label>Nova etapa</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Ex: Follow-up, Contrato, Pós-venda..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
            />
            <Button variant="outline" onClick={() => void add()} disabled={!newName.trim() || createStage.isPending}>
              <Plus />
              Adicionar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A etapa entra no fim do funil; use as setas para posicioná-la.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo, useState } from "react";
import { Kanban, Phone, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useContactsQuery, useUpdateContactMutation, usePipelineStagesQuery } from "@/hooks/queries";
import { getToneClasses, type Contact } from "@/lib/types";
import ContactDetailModal from "@/components/contacts/ContactDetailModal";
import StagesDialog from "@/components/pipeline/StagesDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export default function Pipeline() {
  const { company } = useAuth();
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const { data: stages = [] } = usePipelineStagesQuery(company?.id);
  const updateContact = useUpdateContactMutation();

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [pendingLoss, setPendingLoss] = useState<{ contactId: string; stageKey: string } | null>(null);
  const [lossReason, setLossReason] = useState("");
  const [stagesOpen, setStagesOpen] = useState(false);

  // Contato numa etapa que foi excluída cai na primeira coluna — sem isso ele
  // sumiria do quadro sem deixar rastro.
  const byStage = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const stage of stages) map.set(stage.key, []);
    const fallback = stages[0]?.key;
    for (const contact of contacts) {
      const list = map.get(contact.stage) ?? (fallback ? map.get(fallback) : undefined);
      list?.push(contact);
    }
    return map;
  }, [contacts, stages]);

  const moveContact = async (contactId: string, stage: string, extra?: { loss_reason?: string | null }) => {
    if (!company) return;
    try {
      await updateContact.mutateAsync({ id: contactId, company_id: company.id, stage, ...extra });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao mover contato");
    }
  };

  const handleDrop = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const contactId = e.dataTransfer.getData("contactId");
    if (!contactId) return;
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact || contact.stage === stageId) return;

    const target = stages.find((s) => s.key === stageId);
    if (target?.kind === "lost") {
      setPendingLoss({ contactId, stageKey: stageId });
      setLossReason("");
      return;
    }
    void moveContact(contactId, stageId, { loss_reason: null });
  };

  const confirmLoss = () => {
    if (!pendingLoss) return;
    void moveContact(pendingLoss.contactId, pendingLoss.stageKey, { loss_reason: lossReason.trim() || null });
    setPendingLoss(null);
  };

  return (
    <div>
      <PageHeader
        icon={Kanban}
        title="Pipeline"
        description={`${contacts.length} ${contacts.length === 1 ? "contato" : "contatos"} · arraste os cards para mudar de etapa`}
        actions={
          <Button variant="outline" onClick={() => setStagesOpen(true)}>
            <SlidersHorizontal />
            Etapas
          </Button>
        }
      />

      <div className="scrollbar-slim flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const stageContacts = byStage.get(stage.key) ?? [];
          const tone = getToneClasses(stage.tone);
          const isDropTarget = dragOverCol === stage.key;
          return (
            <div
              key={stage.id}
              className={cn(
                "flex min-h-[420px] w-[272px] flex-shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors",
                isDropTarget && "border-primary/60 bg-accent/60 ring-2 ring-primary/20",
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverCol(stage.key);
              }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => handleDrop(e, stage.key)}
            >
              <div className="flex items-center justify-between gap-2 px-3.5 py-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.dot)} />
                  <span className="truncate text-sm font-semibold">{stage.name}</span>
                </span>
                <span className="tabular shrink-0 rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {stageContacts.length}
                </span>
              </div>

              <div className="flex-1 space-y-2 px-2 pb-2">
                {stageContacts.length === 0 ? (
                  <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border/70 px-3 text-center text-xs text-muted-foreground">
                    {isDropTarget ? "Solte aqui" : "Nenhum contato"}
                  </div>
                ) : (
                  stageContacts.map((contact) => (
                    <div
                      key={contact.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("contactId", contact.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingId(contact.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverCol(null);
                      }}
                      onClick={() => setSelected(contact)}
                      className={cn(
                        "group cursor-grab rounded-lg border border-border/70 bg-card p-3 text-sm shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card-hover active:cursor-grabbing",
                        draggingId === contact.id && "rotate-1 opacity-40",
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {contact.name.trim().charAt(0).toUpperCase() || "?"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium leading-tight">{contact.name}</p>
                          {contact.phone && (
                            <p className="tabular mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              <Phone className="h-3 w-3 shrink-0" />
                              <span className="truncate">{contact.phone}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ContactDetailModal contact={selected} open={!!selected} onClose={() => setSelected(null)} />

      <StagesDialog open={stagesOpen} onOpenChange={setStagesOpen} />

      <Dialog open={!!pendingLoss} onOpenChange={(v) => !v && setPendingLoss(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar perda</DialogTitle>
            <DialogDescription>Informe o motivo da perda (opcional).</DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            placeholder="Ex: comprou com concorrente, sem orçamento..."
            value={lossReason}
            onChange={(e) => setLossReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingLoss(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmLoss}>
              Confirmar perda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

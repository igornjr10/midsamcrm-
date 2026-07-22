import { useMemo, useState } from "react";
import { GripVertical, Phone } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useContactsQuery, useUpdateContactMutation } from "@/hooks/queries";
import { PIPELINE_STAGES, type Contact } from "@/lib/types";
import ContactDetailModal from "@/components/contacts/ContactDetailModal";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export default function Pipeline() {
  const { company } = useAuth();
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const updateContact = useUpdateContactMutation();

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [pendingLoss, setPendingLoss] = useState<{ contactId: string } | null>(null);
  const [lossReason, setLossReason] = useState("");

  const byStage = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const stage of PIPELINE_STAGES) map.set(stage.id, []);
    for (const contact of contacts) {
      const list = map.get(contact.stage) ?? map.get("new")!;
      list.push(contact);
    }
    return map;
  }, [contacts]);

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

    const target = PIPELINE_STAGES.find((s) => s.id === stageId);
    if (target?.kind === "lost") {
      setPendingLoss({ contactId });
      setLossReason("");
      return;
    }
    void moveContact(contactId, stageId, { loss_reason: null });
  };

  const confirmLoss = () => {
    if (!pendingLoss) return;
    void moveContact(pendingLoss.contactId, "lost", { loss_reason: lossReason.trim() || null });
    setPendingLoss(null);
  };

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold">Pipeline</h2>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {PIPELINE_STAGES.map((stage) => {
          const stageContacts = byStage.get(stage.id) ?? [];
          return (
            <div
              key={stage.id}
              className={cn(
                "flex min-h-[300px] w-64 flex-shrink-0 flex-col rounded-lg border bg-card/50 transition-colors",
                dragOverCol === stage.id && "border-primary bg-accent/40",
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverCol(stage.id);
              }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => handleDrop(e, stage.id)}
            >
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="text-sm font-semibold">{stage.label}</span>
                <span className="text-xs text-muted-foreground">{stageContacts.length}</span>
              </div>
              <div className="flex-1 space-y-2 p-2">
                {stageContacts.map((contact) => (
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
                      "cursor-grab rounded-md border bg-card p-2.5 text-sm shadow-sm transition-all hover:shadow active:cursor-grabbing",
                      draggingId === contact.id && "scale-95 opacity-50",
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      <GripVertical className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{contact.name}</p>
                        {contact.phone && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            {contact.phone}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <ContactDetailModal contact={selected} open={!!selected} onClose={() => setSelected(null)} />

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

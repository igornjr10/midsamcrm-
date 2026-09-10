import { useMemo, useState } from "react";
import { Check, Hourglass, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactsQuery, useResourcesQuery, useWaitlistQuery, useAddToWaitlistMutation, useSetWaitlistStatusMutation,
} from "@/hooks/queries";
import { contactLabel, type Appointment } from "@/lib/types";
import { sendWhatsappText, firstNameForMessage } from "@/lib/sendMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * Quem quer um horário que ainda não existe. Cancelou um compromisso, a
 * equipe oferece a vaga daqui, pelo WhatsApp, sem procurar ninguém.
 */
export default function WaitlistCard({
  offerSlot,
  onOfferHandled,
}: {
  /** Compromisso recém-cancelado: abre a oferta com data e hora preenchidas. */
  offerSlot: Appointment | null;
  onOfferHandled: () => void;
}) {
  const { company } = useAuth();
  const { data: entries = [] } = useWaitlistQuery(company?.id);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const { data: resources = [] } = useResourcesQuery(company?.id);
  const add = useAddToWaitlistMutation();
  const setStatus = useSetWaitlistStatusMutation();

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ contact_id: "", resource_id: "", notes: "" });

  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const contactsSorted = useMemo(
    () => contacts.filter((c) => c.phone).sort((a, b) => contactLabel(a).localeCompare(contactLabel(b), "pt-BR")),
    [contacts],
  );
  const resourceName = (id: string | null) => resources.find((r) => r.id === id)?.name;

  const handleAdd = async () => {
    if (!company || !form.contact_id) {
      toast.error("Escolha o contato.");
      return;
    }
    try {
      await add.mutateAsync({
        company_id: company.id,
        contact_id: form.contact_id,
        resource_id: form.resource_id || null,
        notes: form.notes.trim() || null,
      });
      setAddOpen(false);
      setForm({ contact_id: "", resource_id: "", notes: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao incluir");
    }
  };

  const slotText = (a: Appointment) => {
    const d = new Date(a.starts_at);
    const data = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
    const hora = a.all_day ? "" : ` às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    return `${data}${hora}`;
  };

  const offer = async (entryId: string, contactId: string) => {
    const contact = byId.get(contactId);
    if (!company || !offerSlot || !contact?.phone) return;
    const nome = firstNameForMessage(contact.name);
    const text = `${nome ? `Oi ${nome}! ` : "Oi! "}Abriu um horário ${slotText(offerSlot)}${offerSlot.resource_id ? ` com ${resourceName(offerSlot.resource_id)}` : ""}. Quer ficar com ele? Responda por aqui que eu confirmo.`;
    try {
      await sendWhatsappText({ company_id: company.id, contact_id: contact.id, phone: contact.phone, text });
      toast.success(`Vaga oferecida para ${contactLabel(contact)}.`);
      void setStatus.mutateAsync({ id: entryId, company_id: company.id, status: "atendido" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar");
    }
  };

  // Quem está esperando o recurso que vagou (ou qualquer um) vem primeiro.
  const candidates = offerSlot
    ? entries.filter((e) => !e.resource_id || !offerSlot.resource_id || e.resource_id === offerSlot.resource_id)
    : [];

  return (
    <>
      <div className="rounded-xl border bg-card p-4 shadow-card">
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Hourglass className="h-4 w-4 text-muted-foreground" />
            Lista de espera
            {entries.length > 0 && <span className="tabular text-xs font-medium text-muted-foreground">{entries.length}</span>}
          </p>
          <Button size="icon-sm" variant="ghost" aria-label="Incluir na lista de espera" onClick={() => setAddOpen(true)}>
            <Plus />
          </Button>
        </div>
        {entries.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            Ninguém esperando horário. Inclua quem pediu um encaixe.
          </p>
        ) : (
          <div className="space-y-1.5">
            {entries.map((e) => {
              const c = byId.get(e.contact_id);
              return (
                <div key={e.id} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c ? contactLabel(c) : "Contato"}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[resourceName(e.resource_id), e.notes].filter(Boolean).join(" · ") || "Qualquer horário"}
                    </span>
                  </span>
                  <Button
                    size="icon-sm" variant="ghost" aria-label="Atendido"
                    onClick={() => company && void setStatus.mutateAsync({ id: e.id, company_id: company.id, status: "atendido" })}
                  >
                    <Check />
                  </Button>
                  <Button
                    size="icon-sm" variant="ghost" aria-label="Remover" className="text-muted-foreground hover:text-destructive"
                    onClick={() => company && void setStatus.mutateAsync({ id: e.id, company_id: company.id, status: "cancelado" })}
                  >
                    <X />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Incluir na lista de espera</DialogTitle>
            <DialogDescription>Quando abrir um horário, você oferece daqui.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Contato</Label>
              <Select value={form.contact_id || "none"} onValueChange={(v) => setForm((f) => ({ ...f, contact_id: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Escolha o contato</SelectItem>
                  {contactsSorted.map((c) => <SelectItem key={c.id} value={c.id}>{contactLabel(c)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {resources.length > 0 && (
              <div className="space-y-1.5">
                <Label>Com quem (opcional)</Label>
                <Select value={form.resource_id || "any"} onValueChange={(v) => setForm((f) => ({ ...f, resource_id: v === "any" ? "" : v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Qualquer um</SelectItem>
                    {resources.filter((r) => r.active).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Observação (opcional)</Label>
              <Input placeholder="Prefere de manhã, só às terças..." value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button onClick={() => void handleAdd()} disabled={add.isPending}>Incluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!offerSlot} onOpenChange={(v) => !v && onOfferHandled()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Oferecer o horário</DialogTitle>
            <DialogDescription>
              {offerSlot ? `Vagou ${slotText(offerSlot)}. Quem da lista de espera recebe a oferta?` : ""}
            </DialogDescription>
          </DialogHeader>
          {candidates.length === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Ninguém na lista de espera para este horário.
            </p>
          ) : (
            <div className="space-y-1.5">
              {candidates.map((e) => {
                const c = byId.get(e.contact_id);
                return (
                  <div key={e.id} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c ? contactLabel(c) : "Contato"}</span>
                      <span className="block truncate text-xs text-muted-foreground">{e.notes ?? ""}</span>
                    </span>
                    <Button size="sm" variant="outline" disabled={!c?.phone} onClick={() => void offer(e.id, e.contact_id)}>
                      <Send />
                      Oferecer
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onOfferHandled}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

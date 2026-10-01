import { useEffect, useState } from "react";
import { Copy, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useDeleteLeadSourceCodeMutation, useLeadSourceCodesQuery, useSaveLeadSourceCodeMutation,
  useWhatsappConfigQuery,
} from "@/hooks/queries";
import { LEAD_SOURCES, leadSourceLabel, type LeadSourceCode } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Origens que fazem sentido para um link: as automáticas (WhatsApp direto,
// prospecção, cadastro manual, formulário) o CRM já resolve sozinho.
const LINK_SOURCES = LEAD_SOURCES.filter((s) => !["whatsapp", "prospeccao", "manual", "captacao"].includes(s.key));

const PHONE_KEY = (companyId: string) => `mini-crm:tracked-links-phone:${companyId}`;

type Draft = { code: string; source: string; label: string; message: string };
const EMPTY: Draft = { code: "", source: "anuncio", label: "", message: "Olá! Quero saber mais" };

export function trackedLink(phone: string, message: string, code: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(`${message.trim()} [${code}]`)}`;
}

function nextCode(existing: LeadSourceCode[]): string {
  const used = new Set(existing.map((c) => c.code.toUpperCase()));
  for (let i = 1; ; i++) if (!used.has(`L${i}`)) return `L${i}`;
}

/**
 * Links de WhatsApp com código na mensagem pronta ("Olá! Quero saber mais
 * [A1]"). O lead novo que chega por um deles entra com a origem certa — mesmo
 * onde o WhatsApp não anexa o cartão do anúncio: bio, site, anúncio que leva ao
 * Instagram, QR code impresso.
 */
export default function TrackedLinksCard() {
  const { company } = useAuth();
  const companyId = company?.id;
  const { data: codes = [] } = useLeadSourceCodesQuery(companyId);
  const { data: waConfig } = useWhatsappConfigQuery(companyId);
  const save = useSaveLeadSourceCodeMutation();
  const remove = useDeleteLeadSourceCodeMutation();

  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState<LeadSourceCode | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  // O número da empresa: o salvo neste navegador, senão o da conexão.
  useEffect(() => {
    if (!companyId) return;
    let stored = "";
    try {
      stored = localStorage.getItem(PHONE_KEY(companyId)) ?? "";
    } catch {
      /* sem storage: cai no número da conexão */
    }
    setPhone(stored || waConfig?.phone_number || "");
  }, [companyId, waConfig?.phone_number]);

  const updatePhone = (value: string) => {
    setPhone(value);
    if (!companyId) return;
    try {
      localStorage.setItem(PHONE_KEY(companyId), value);
    } catch {
      /* sem storage: vale só nesta sessão */
    }
  };

  const phoneOk = phone.replace(/\D/g, "").length >= 10;

  const openNew = () => {
    setDraft({ ...EMPTY, code: nextCode(codes) });
    setEditing("new");
  };

  const openEdit = (c: LeadSourceCode) => {
    setDraft({ code: c.code, source: c.source, label: c.label, message: c.message });
    setEditing(c);
  };

  const handleSave = async () => {
    if (!companyId || !editing) return;
    const code = draft.code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,20}$/.test(code)) {
      toast.error("Código: só letras, números, _ ou -, até 20 caracteres.");
      return;
    }
    if (!draft.label.trim()) {
      toast.error("Dê um nome para o link (ex: Anúncio Black Friday).");
      return;
    }
    try {
      await save.mutateAsync({
        id: editing === "new" ? null : editing.id,
        company_id: companyId,
        code,
        source: draft.source,
        label: draft.label.trim(),
        message: draft.message.trim() || EMPTY.message,
      });
      toast.success("Link salvo.");
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const handleDelete = async (c: LeadSourceCode) => {
    if (!companyId) return;
    if (!window.confirm(`Apagar o link "${c.label}"? Quem chegar com o código [${c.code}] vai entrar como WhatsApp direto.`)) return;
    try {
      await remove.mutateAsync({ id: c.id, company_id: companyId });
      toast.success("Link apagado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao apagar");
    }
  };

  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toast.success("Link copiado."),
      () => toast.error("Não deu para copiar. Selecione e copie o link manualmente."),
    );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            Links rastreáveis de WhatsApp
          </CardTitle>
          <CardDescription className="mt-1.5">
            Use na bio, no site, em anúncio que leva ao Instagram ou em QR code. A mensagem já vai escrita
            com um código, e o lead novo entra no CRM com a origem certa.
          </CardDescription>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus />
          Novo link
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="tracked-phone">WhatsApp da empresa (com DDD)</Label>
          <Input
            id="tracked-phone"
            inputMode="tel"
            placeholder="55 99 99999-9999"
            value={phone}
            onChange={(e) => updatePhone(e.target.value)}
          />
          {!phoneOk && <p className="text-xs text-muted-foreground">Informe o número para gerar os links.</p>}
        </div>

        {codes.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Nenhum link ainda. Crie um para cada lugar onde você divulga: um para o anúncio do mês, outro
            para a bio do Instagram, outro para o site.
          </p>
        ) : (
          <div className="divide-y rounded-lg border">
            {codes.map((c) => {
              const link = phoneOk ? trackedLink(phone, c.message, c.code) : "";
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-3 p-3">
                  <Badge variant="secondary" className="font-mono">[{c.code}]</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {leadSourceLabel(c.source)} · “{c.message} [{c.code}]”
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" disabled={!link} onClick={() => copy(link)}>
                      <Copy />
                      Copiar link
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Editar ${c.label}`} onClick={() => openEdit(c)}>
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Apagar ${c.label}`}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void handleDelete(c)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Vale para o lead <strong>novo</strong> que mandar a mensagem com o código. Se ele apagar o código
          antes de enviar, entra como WhatsApp direto. Anúncio de clique para o WhatsApp não precisa de link: o
          CRM reconhece o anúncio sozinho.
        </p>
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Novo link" : "Editar link"}</DialogTitle>
            <DialogDescription>O código vai entre colchetes no fim da mensagem pronta.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="link-label">Nome</Label>
              <Input
                id="link-label"
                placeholder="Ex: Anúncio Black Friday, Bio do Instagram"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="link-code">Código</Label>
                <Input
                  id="link-code"
                  className="font-mono uppercase"
                  maxLength={20}
                  value={draft.code}
                  onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Origem</Label>
                <Select value={draft.source} onValueChange={(v) => setDraft((d) => ({ ...d, source: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINK_SOURCES.map((s) => (
                      <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="link-message">Mensagem pronta</Label>
              <Input
                id="link-message"
                value={draft.message}
                onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                O lead vai ver: “{draft.message.trim() || EMPTY.message} [{draft.code.trim().toUpperCase() || "…"}]”
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button className="w-full" onClick={() => void handleSave()} disabled={save.isPending}>
              {save.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

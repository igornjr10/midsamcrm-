import { useEffect, useMemo, useState } from "react";
import { Copy, MousePointerClick, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useContactsQuery, useContactFieldsQuery, useContactTagsQuery, useLeadFormsQuery, useSaveLeadFormMutation } from "@/hooks/queries";
import { SUPABASE_URL } from "@/integrations/supabase/client";
import type { LeadForm } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";

const BASE_FIELDS: Array<{ key: string; label: string; locked?: boolean }> = [
  { key: "name", label: "Nome" },
  { key: "phone", label: "WhatsApp", locked: true },
  { key: "email", label: "E-mail" },
  { key: "birth_date", label: "Data de nascimento" },
];

type Draft = Omit<LeadForm, "id" | "company_id" | "token" | "created_at" | "updated_at">;

const DEFAULT_DRAFT: Draft = {
  title: "Ganhe um desconto na primeira compra",
  subtitle: "Deixe seu WhatsApp e receba o cupom na hora.",
  button_label: "Quero meu desconto",
  fields: ["name", "phone"],
  tag: null,
  coupon_percent: 10,
  coupon_validity_days: 15,
  success_message: "Pronto! Seu cupom chega no WhatsApp em instantes.",
  theme_color: "#1b56de",
  active: true,
};

export default function Captacao() {
  const { company } = useAuth();
  const { data: forms = [] } = useLeadFormsQuery(company?.id);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const { data: contactFields = [] } = useContactFieldsQuery(company?.id);
  const { data: tags = [] } = useContactTagsQuery(company?.id);
  const save = useSaveLeadFormMutation();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);

  const current = useMemo(() => forms.find((f) => f.id === selectedId) ?? forms[0] ?? null, [forms, selectedId]);

  useEffect(() => {
    if (current) {
      const { id: _id, company_id: _c, token: _t, created_at: _ca, updated_at: _ua, ...rest } = current;
      setDraft(rest);
    }
  }, [current]);

  const captured = useMemo(
    () => (current?.tag ? contacts.filter((c) => c.tags?.includes(current.tag as string)).length : 0),
    [contacts, current],
  );

  const embed = current ? `<script src="${SUPABASE_URL}/functions/v1/lead-capture?token=${current.token}" async></script>` : "";

  const toggleField = (key: string) => {
    if (key === "phone") return;
    setDraft((d) => ({ ...d, fields: d.fields.includes(key) ? d.fields.filter((f) => f !== key) : [...d.fields, key] }));
  };

  const handleSave = async () => {
    if (!company) return;
    try {
      await save.mutateAsync({ id: current?.id ?? null, company_id: company.id, ...draft, fields: draft.fields.includes("phone") ? draft.fields : [...draft.fields, "phone"] });
      toast.success("Pop-up salvo.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const createNew = async () => {
    if (!company) return;
    try {
      await save.mutateAsync({ id: null, company_id: company.id, ...DEFAULT_DRAFT, tag: tags[0]?.name ?? null });
      toast.success("Pop-up criado. Copie o código e cole no site.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar");
    }
  };

  return (
    <div>
      <PageHeader
        icon={MousePointerClick}
        title="Captação"
        description="Pop-up no site que cadastra o lead direto no CRM, com etiqueta e cupom de boas-vindas."
        badges={current && !current.active ? <Badge variant="outline">Desligado</Badge> : undefined}
        actions={forms.length > 0 ? <Button variant="outline" onClick={() => void createNew()}><Plus />Novo pop-up</Button> : undefined}
      />

      {forms.length === 0 ? (
        <EmptyState
          icon={MousePointerClick}
          title="Nenhum pop-up ainda"
          description="Você define os campos, o cupom e o texto. O lead cai no CRM na hora e a IA já pode atender."
          action={<Button onClick={() => void createNew()}><Plus />Criar meu pop-up</Button>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="space-y-4">
            {forms.length > 1 && (
              <Select value={current?.id ?? ""} onValueChange={setSelectedId}>
                <SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
                <SelectContent>{forms.map((f) => <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>)}</SelectContent>
              </Select>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Código para o site</CardTitle>
                <CardDescription>Cole antes do <code>&lt;/body&gt;</code> em qualquer página. Aparece uma vez a cada 7 dias por visitante.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input readOnly value={embed} className="font-mono text-xs" />
                  <Button size="icon" variant="outline" aria-label="Copiar" onClick={() => { void navigator.clipboard.writeText(embed); toast.success("Copiado!"); }}><Copy /></Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{captured} {captured === 1 ? "lead capturado" : "leads capturados"}{current?.tag ? ` com a etiqueta "${current.tag}"` : ""}.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Texto e campos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5"><Label>Título</Label><Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Subtítulo</Label><Input value={draft.subtitle} onChange={(e) => setDraft((d) => ({ ...d, subtitle: e.target.value }))} /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label>Botão</Label><Input value={draft.button_label} onChange={(e) => setDraft((d) => ({ ...d, button_label: e.target.value }))} /></div>
                  <div className="space-y-1.5"><Label>Cor</Label><div className="flex gap-2"><Input type="color" className="w-14 p-1" value={draft.theme_color} onChange={(e) => setDraft((d) => ({ ...d, theme_color: e.target.value }))} /><Input value={draft.theme_color} onChange={(e) => setDraft((d) => ({ ...d, theme_color: e.target.value }))} /></div></div>
                </div>
                <div className="space-y-1.5">
                  <Label>Campos do formulário</Label>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {BASE_FIELDS.map((f) => (
                      <label key={f.key} className="flex cursor-pointer items-center gap-2"><Checkbox checked={draft.fields.includes(f.key)} disabled={f.locked} onCheckedChange={() => toggleField(f.key)} />{f.label}</label>
                    ))}
                    {contactFields.map((f) => (
                      <label key={f.key} className="flex cursor-pointer items-center gap-2"><Checkbox checked={draft.fields.includes(f.key)} onCheckedChange={() => toggleField(f.key)} />{f.label}</label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Campos de Contatos → Campos também podem entrar: tamanho, preferência, faixa de preço.</p>
                </div>
                <div className="space-y-1.5"><Label>Mensagem de sucesso</Label><Textarea rows={2} value={draft.success_message} onChange={(e) => setDraft((d) => ({ ...d, success_message: e.target.value }))} /></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>O que acontece com o lead</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Etiqueta</Label>
                    <Select value={draft.tag ?? "none"} onValueChange={(v) => setDraft((d) => ({ ...d, tag: v === "none" ? null : v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma</SelectItem>
                        {tags.map((t) => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5"><Label>Cupom de boas-vindas (%)</Label><Input type="number" min={0} placeholder="0 = sem cupom" value={draft.coupon_percent ?? ""} onChange={(e) => setDraft((d) => ({ ...d, coupon_percent: e.target.value === "" ? null : Number(e.target.value) }))} /></div>
                  <div className="space-y-1.5"><Label>Validade do cupom (dias)</Label><Input type="number" min={1} value={draft.coupon_validity_days} onChange={(e) => setDraft((d) => ({ ...d, coupon_validity_days: Number(e.target.value) }))} /></div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={draft.active} onCheckedChange={(v) => setDraft((d) => ({ ...d, active: v === true }))} />Pop-up ligado</label>
                <p className="text-xs text-muted-foreground">O cupom vai por WhatsApp na hora, se a empresa tiver WhatsApp conectado. O lead entra em Contatos e a IA pode atender.</p>
                <Button onClick={() => void handleSave()} disabled={save.isPending}>{save.isPending ? "Salvando..." : "Salvar pop-up"}</Button>
              </CardContent>
            </Card>
          </div>

          {/* Prévia: o mesmo visual do script, para não ter surpresa no site. */}
          <div className="h-fit rounded-xl border border-dashed p-6">
            <p className="mb-3 text-center text-xs text-muted-foreground">Prévia no site</p>
            <div className="mx-auto max-w-xs overflow-hidden rounded-2xl bg-white text-[#141a2e] shadow-modal">
              <div className="h-2" style={{ background: draft.theme_color }} />
              <div className="space-y-3 p-5">
                <p className="text-lg font-bold leading-tight">{draft.title}</p>
                <p className="text-sm text-[#5e6784]">{draft.subtitle}</p>
                {[...BASE_FIELDS, ...contactFields.map((f) => ({ key: f.key, label: f.label }))].filter((f) => draft.fields.includes(f.key)).map((f) => (
                  <div key={f.key} className="rounded-lg border border-[#dde1eb] px-3 py-2 text-sm text-[#9aa1b8]">{f.label}</div>
                ))}
                <div className="rounded-lg py-2.5 text-center text-sm font-semibold text-white" style={{ background: draft.theme_color }}>{draft.button_label}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

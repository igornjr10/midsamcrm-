import { useEffect, useMemo, useState } from "react";
import { Gift, MessageSquare, Plus, Search, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactsQuery, useCouponsQuery, useCreateCouponMutation, useUpdateCouponMutation,
  useGiftbackSettingsQuery, useSaveGiftbackSettingsMutation,
} from "@/hooks/queries";
import { money, renderGiftback } from "@/lib/retail";
import { contactLabel, formatPhone, type Coupon, type GiftbackSettings } from "@/lib/types";
import { sendWhatsappText } from "@/lib/sendMessage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const STATUS: Record<Coupon["status"], { label: string; variant: "success" | "secondary" | "warning" | "outline" }> = {
  ativo: { label: "Ativo", variant: "success" },
  usado: { label: "Usado", variant: "secondary" },
  expirado: { label: "Expirado", variant: "outline" },
  cancelado: { label: "Cancelado", variant: "outline" },
};

const DEFAULTS: Omit<GiftbackSettings, "company_id" | "created_at" | "updated_at"> = {
  enabled: false, percent: 5, validity_days: 30, min_purchase: 0, prefix: "GB", send_message: true,
  message: "Oi {{primeiro_nome}}! Obrigado pela compra 💜 Você ganhou {{valor}} de giftback para usar até {{validade}}. Seu código: {{codigo}}",
  reminder_days: 3,
  reminder_message: "Oi {{primeiro_nome}}! Seu giftback de {{valor}} vence em {{validade}}. Passa aqui para usar: {{codigo}} 😉",
  post_sale_task_days: 3,
};

export default function Bonus() {
  const { company } = useAuth();
  const { data: coupons = [] } = useCouponsQuery(company?.id);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const { data: settings } = useGiftbackSettingsQuery(company?.id);
  const saveSettings = useSaveGiftbackSettingsMutation();
  const createCoupon = useCreateCouponMutation();
  const updateCoupon = useUpdateCouponMutation();

  const [tab, setTab] = useState<"todos" | "giftback" | "cupom">("todos");
  const [search, setSearch] = useState("");
  const [cfg, setCfg] = useState(DEFAULTS);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ code: "", discount_type: "percent" as Coupon["discount_type"], value: "10", min_purchase: "", expires: "", contact_id: "" });

  useEffect(() => {
    if (settings) setCfg({ ...DEFAULTS, ...settings });
  }, [settings]);

  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const now = Date.now();
  const effectiveStatus = (c: Coupon): Coupon["status"] =>
    c.status === "ativo" && c.expires_at && new Date(c.expires_at).getTime() < now ? "expirado" : c.status;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const d = term.replace(/\D/g, "");
    return coupons.filter((c) => {
      if (tab !== "todos" && c.kind !== tab) return false;
      if (!term) return true;
      const contact = c.contact_id ? byId.get(c.contact_id) : undefined;
      return c.code.toLowerCase().includes(term) || (contact ? contactLabel(contact).toLowerCase().includes(term) || (d && (contact.phone ?? "").replace(/\D/g, "").includes(d)) : false);
    });
  }, [coupons, tab, search, byId]);

  const stats = useMemo(() => {
    const gb = coupons.filter((c) => c.kind === "giftback");
    const active = gb.filter((c) => effectiveStatus(c) === "ativo");
    return { generated: gb.length, used: gb.filter((c) => c.status === "usado").length, active: active.length, activeValue: active.reduce((a, c) => a + Number(c.value), 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coupons]);

  const handleSaveSettings = async () => {
    if (!company) return;
    try {
      await saveSettings.mutateAsync({ company_id: company.id, ...cfg });
      toast.success(cfg.enabled ? "Giftback ligado: cada venda gera crédito." : "Configuração salva.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const handleCreate = async () => {
    if (!company) return;
    const code = form.code.trim().toUpperCase().replace(/\s+/g, "-");
    const value = Number(form.value.replace(",", "."));
    if (!code || !Number.isFinite(value) || value <= 0) return void toast.error("Código e valor são obrigatórios.");
    try {
      await createCoupon.mutateAsync({
        company_id: company.id,
        contact_id: form.contact_id || null,
        code, kind: "cupom",
        discount_type: form.discount_type,
        value,
        min_purchase: form.min_purchase ? Number(form.min_purchase.replace(",", ".")) : null,
        expires_at: form.expires ? new Date(`${form.expires}T23:59`).toISOString() : null,
      });
      toast.success(`Cupom ${code} criado.`);
      setCreateOpen(false);
      setForm({ code: "", discount_type: "percent", value: "10", min_purchase: "", expires: "", contact_id: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar cupom");
    }
  };

  const cancel = async (c: Coupon) => {
    if (!company || !window.confirm(`Cancelar ${c.code}?`)) return;
    try {
      await updateCoupon.mutateAsync({ id: c.id, company_id: company.id, status: "cancelado" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  };

  const resend = async (c: Coupon) => {
    const contact = c.contact_id ? byId.get(c.contact_id) : undefined;
    if (!company || !contact?.phone) return void toast.error("Cupom sem cliente com telefone.");
    try {
      await sendWhatsappText({ company_id: company.id, contact_id: contact.id, phone: contact.phone, text: renderGiftback(cfg.message, c, contact) });
      await updateCoupon.mutateAsync({ id: c.id, company_id: company.id, sent_at: new Date().toISOString() });
      toast.success(`Enviado para ${contactLabel(contact)}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar");
    }
  };

  return (
    <div>
      <PageHeader
        icon={Gift}
        title="Bônus"
        description={`${stats.active} giftbacks ativos · ${money(stats.activeValue)} de crédito na rua · ${stats.used} de ${stats.generated} usados`}
        badges={settings?.enabled ? <Badge variant="success">Giftback ligado</Badge> : undefined}
        actions={<Button onClick={() => setCreateOpen(true)}><Plus />Novo cupom</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList>
                <TabsTrigger value="todos">Todos</TabsTrigger>
                <TabsTrigger value="giftback">Giftback</TabsTrigger>
                <TabsTrigger value="cupom">Cupons</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative sm:ml-auto sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Código, cliente ou telefone" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-card shadow-card">
            <div className="scrollbar-slim overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left">
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Código</th>
                    <th className="px-4 py-3 font-semibold">Cliente</th>
                    <th className="px-4 py-3 font-semibold">Valor</th>
                    <th className="px-4 py-3 font-semibold">Validade</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">{coupons.length === 0 ? "Nenhum cupom ainda. Ligue o giftback ao lado ou crie um cupom." : "Nada encontrado."}</td></tr>
                  ) : filtered.slice(0, 300).map((c) => {
                    const contact = c.contact_id ? byId.get(c.contact_id) : undefined;
                    const st = effectiveStatus(c);
                    return (
                      <tr key={c.id} className="border-t">
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs font-semibold">{c.code}</span>
                          <span className="block text-[11px] text-muted-foreground">{c.kind === "giftback" ? "Giftback" : "Cupom"}{c.sent_at ? " · enviado" : ""}</span>
                        </td>
                        <td className="px-4 py-3">{contact ? <>{contactLabel(contact)}<span className="block text-xs text-muted-foreground">{formatPhone(contact.phone)}</span></> : <span className="text-muted-foreground">Todos</span>}</td>
                        <td className="tabular px-4 py-3 font-medium">{c.discount_type === "percent" ? `${c.value}%` : money(c.value)}{c.min_purchase ? <span className="block text-xs font-normal text-muted-foreground">mín. {money(c.min_purchase)}</span> : null}</td>
                        <td className="tabular px-4 py-3 text-muted-foreground">{c.expires_at ? new Date(c.expires_at).toLocaleDateString("pt-BR") : "—"}</td>
                        <td className="px-4 py-3"><Badge variant={STATUS[st].variant}>{STATUS[st].label}</Badge></td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            {st === "ativo" && contact?.phone && (
                              <Button size="icon-sm" variant="ghost" title="Enviar por WhatsApp" onClick={() => void resend(c)}><MessageSquare /></Button>
                            )}
                            {st === "ativo" && (
                              <Button size="icon-sm" variant="ghost" title="Cancelar" className="text-muted-foreground hover:text-destructive" onClick={() => void cancel(c)}><XCircle /></Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Gift className="h-4 w-4 text-muted-foreground" />Regra do giftback</CardTitle>
            <CardDescription>Toda venda registrada gera um crédito para a próxima compra. É o que traz o cliente de volta.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={cfg.enabled} onCheckedChange={(v) => setCfg((c) => ({ ...c, enabled: v === true }))} />
              Gerar giftback a cada venda
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>% da compra</Label><Input type="number" min={0} step="0.5" value={cfg.percent} onChange={(e) => setCfg((c) => ({ ...c, percent: Number(e.target.value) }))} /></div>
              <div className="space-y-1.5"><Label>Validade (dias)</Label><Input type="number" min={1} value={cfg.validity_days} onChange={(e) => setCfg((c) => ({ ...c, validity_days: Number(e.target.value) }))} /></div>
              <div className="space-y-1.5"><Label>Compra mínima</Label><Input type="number" min={0} value={cfg.min_purchase} onChange={(e) => setCfg((c) => ({ ...c, min_purchase: Number(e.target.value) }))} /></div>
              <div className="space-y-1.5"><Label>Prefixo</Label><Input className="font-mono uppercase" maxLength={6} value={cfg.prefix} onChange={(e) => setCfg((c) => ({ ...c, prefix: e.target.value.toUpperCase() }))} /></div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={cfg.send_message} onCheckedChange={(v) => setCfg((c) => ({ ...c, send_message: v === true }))} />
              Enviar o código por WhatsApp na hora
            </label>
            <div className="space-y-1.5">
              <Label>Mensagem</Label>
              <Textarea rows={3} value={cfg.message} onChange={(e) => setCfg((c) => ({ ...c, message: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Use {"{{primeiro_nome}}"}, {"{{codigo}}"}, {"{{valor}}"} e {"{{validade}}"}.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Lembrar antes (dias)</Label><Input type="number" min={0} value={cfg.reminder_days} onChange={(e) => setCfg((c) => ({ ...c, reminder_days: Number(e.target.value) }))} /></div>
              <div className="space-y-1.5"><Label>Pós-venda (dias)</Label><Input type="number" min={0} value={cfg.post_sale_task_days} onChange={(e) => setCfg((c) => ({ ...c, post_sale_task_days: Number(e.target.value) }))} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Mensagem do lembrete</Label>
              <Textarea rows={2} value={cfg.reminder_message} onChange={(e) => setCfg((c) => ({ ...c, reminder_message: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Sai pela régua "Giftback vencendo" em SDR IA → Relacionamento. Pós-venda 0 = sem tarefa.</p>
            </div>
            <Button className="w-full" onClick={() => void handleSaveSettings()} disabled={saveSettings.isPending}>{saveSettings.isPending ? "Salvando..." : "Salvar regra"}</Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo cupom</DialogTitle>
            <DialogDescription>Cupom avulso para uma campanha ou para um cliente específico.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Código</Label><Input className="font-mono uppercase" placeholder="PRIMAVERA10" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={form.discount_type} onValueChange={(v) => setForm((f) => ({ ...f, discount_type: v as Coupon["discount_type"] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="percent">Porcentagem</SelectItem><SelectItem value="fixed">Valor fixo</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>{form.discount_type === "percent" ? "%" : "R$"}</Label><Input value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Compra mínima</Label><Input placeholder="R$" value={form.min_purchase} onChange={(e) => setForm((f) => ({ ...f, min_purchase: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Validade</Label><Input type="date" value={form.expires} onChange={(e) => setForm((f) => ({ ...f, expires: e.target.value }))} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Cliente (opcional)</Label>
              <Select value={form.contact_id || "all"} onValueChange={(v) => setForm((f) => ({ ...f, contact_id: v === "all" ? "" : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Vale para qualquer cliente</SelectItem>
                  {contacts.slice().sort((a, b) => contactLabel(a).localeCompare(contactLabel(b), "pt-BR")).map((c) => <SelectItem key={c.id} value={c.id}>{contactLabel(c)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={() => void handleCreate()} disabled={createCoupon.isPending}>Criar cupom</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

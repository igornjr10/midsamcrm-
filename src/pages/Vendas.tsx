import { useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Plus, Receipt, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactsQuery, useCreateContactMutation, useCompanyTeamQuery, useSalesQuery, useCreateSaleMutation,
  useImportSalesMutation, useDeleteSaleMutation, useCouponsQuery, useGiftbackSettingsQuery, useUpdateCouponMutation,
} from "@/hooks/queries";
import { supabase } from "@/integrations/supabase/client";
import { money, parseCsv, parseDateLoose, parseMoney, renderGiftback } from "@/lib/retail";
import { contactLabel, formatPhone, teamLabel, type Contact, type Coupon, type SaleItem } from "@/lib/types";
import { sendWhatsappText } from "@/lib/sendMessage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const NEW_ITEM: SaleItem = { name: "", qty: 1, price: null };
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const ORIGIN_LABEL: Record<string, string> = { manual: "Manual", planilha: "Planilha", pedido: "Pedido", captacao: "Captação" };

export default function Vendas() {
  const { user, company } = useAuth();
  const { data: sales = [], isPending } = useSalesQuery(company?.id);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const { data: team = [] } = useCompanyTeamQuery(company?.id);
  const { data: coupons = [] } = useCouponsQuery(company?.id);
  const { data: giftback } = useGiftbackSettingsQuery(company?.id);
  const createSale = useCreateSaleMutation();
  const importSales = useImportSalesMutation();
  const deleteSale = useDeleteSaleMutation();
  const createContact = useCreateContactMutation();
  const updateCoupon = useUpdateCouponMutation();

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const byPhone = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) {
      const d = digits(c.phone);
      if (d) m.set(d.slice(-8), c);
    }
    return m;
  }, [contacts]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sales;
    return sales.filter((s) => {
      const c = s.contact_id ? byId.get(s.contact_id) : undefined;
      return String(s.number).includes(term) || (c ? contactLabel(c).toLowerCase().includes(term) || digits(c.phone).includes(term.replace(/\D/g, "")) : false) || (s.coupon_code ?? "").toLowerCase().includes(term);
    });
  }, [sales, search, byId]);

  // ── Lançamento ────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    clientSearch: "", contact_id: "", newName: "", newPhone: "",
    items: [{ ...NEW_ITEM }] as SaleItem[], total: "", discount: "", shipping: "",
    coupon: "", seller_id: user?.id ?? "", store: "", date: new Date().toISOString().slice(0, 10), notes: "",
  });
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);

  const clientMatches = useMemo(() => {
    const term = form.clientSearch.trim().toLowerCase();
    if (!term) return [];
    const d = term.replace(/\D/g, "");
    return contacts.filter((c) => contactLabel(c).toLowerCase().includes(term) || (d && digits(c.phone).includes(d))).slice(0, 6);
  }, [contacts, form.clientSearch]);

  const itemsTotal = form.items.reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
  const gross = form.total ? parseMoney(form.total) : itemsTotal;
  const couponDiscount = appliedCoupon
    ? appliedCoupon.discount_type === "percent" ? Math.round(gross * Number(appliedCoupon.value)) / 100 : Math.min(gross, Number(appliedCoupon.value))
    : 0;
  const discount = parseMoney(form.discount || "0") + couponDiscount;
  const shipping = parseMoney(form.shipping || "0");
  const net = Math.max(0, gross - discount + shipping);

  const applyCoupon = () => {
    const code = form.coupon.trim().toUpperCase();
    if (!code) return;
    const c = coupons.find((x) => x.code.toUpperCase() === code);
    if (!c) return void toast.error("Cupom não encontrado.");
    if (c.status !== "ativo") return void toast.error(`Cupom ${c.status}.`);
    if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return void toast.error("Cupom vencido.");
    if (c.contact_id && c.contact_id !== form.contact_id) return void toast.error("Este giftback é de outro cliente.");
    if (c.min_purchase && gross < Number(c.min_purchase)) return void toast.error(`Compra mínima de ${money(c.min_purchase)}.`);
    setAppliedCoupon(c);
    toast.success(`Cupom aplicado: ${c.discount_type === "percent" ? `${c.value}%` : money(c.value)}.`);
  };

  const handleCreate = async () => {
    if (!company || !user) return;
    let contactId = form.contact_id || null;
    if (!contactId && form.newName.trim()) {
      const phone = digits(form.newPhone);
      const existing = phone ? byPhone.get(phone.slice(-8)) : undefined;
      if (existing) contactId = existing.id;
      else {
        const created = await createContact.mutateAsync({ user_id: user.id, company_id: company.id, name: form.newName.trim(), phone: phone || null });
        contactId = created?.id ?? null;
      }
    }
    if (net <= 0 && itemsTotal <= 0) return void toast.error("Informe o valor da venda ou os itens.");
    const items = form.items.map((i) => ({ ...i, name: i.name.trim(), qty: Math.max(1, Number(i.qty) || 1) })).filter((i) => i.name);
    try {
      const sale = await createSale.mutateAsync({
        company_id: company.id,
        contact_id: contactId,
        total: Math.round(net * 100) / 100,
        discount: Math.round(discount * 100) / 100,
        shipping,
        items,
        seller_id: form.seller_id || null,
        store: form.store.trim() || null,
        coupon_id: appliedCoupon?.id ?? null,
        coupon_code: appliedCoupon?.code ?? null,
        sold_at: new Date(`${form.date}T12:00`).toISOString(),
        notes: form.notes.trim() || null,
      });
      toast.success(sale ? `Venda #${sale.number} registrada.` : "Venda registrada.");
      setCreateOpen(false);
      setAppliedCoupon(null);
      setForm((f) => ({ ...f, clientSearch: "", contact_id: "", newName: "", newPhone: "", items: [{ ...NEW_ITEM }], total: "", discount: "", shipping: "", coupon: "", notes: "" }));

      // Giftback gerado pelo trigger: manda a mensagem se a regra pede.
      if (sale && contactId && giftback?.enabled && giftback.send_message) {
        const contact = byId.get(contactId);
        const { data } = await supabase.from("crm_coupons").select("*").eq("origin_sale_id", sale.id).maybeSingle();
        const gb = data as Coupon | null;
        if (gb && contact?.phone) {
          try {
            await sendWhatsappText({ company_id: company.id, contact_id: contact.id, phone: contact.phone, text: renderGiftback(giftback.message, gb, contact) });
            await updateCoupon.mutateAsync({ id: gb.id, company_id: company.id, sent_at: new Date().toISOString() });
            toast.success(`Giftback ${gb.code} enviado para ${contactLabel(contact)}.`);
          } catch (err) {
            toast.error(`Giftback gerado, mas não enviado: ${err instanceof Error ? err.message : "erro"}`);
          }
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar venda");
    }
  };

  // ── Importação ────────────────────────────────────────────────────────────
  const [preview, setPreview] = useState<{ rows: Array<{ phone: string; name: string; sold_at: string; total: number; items: string; seller: string; store: string }>; skipped: number } | null>(null);

  const handleFile = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 2) return void toast.error("Planilha vazia.");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
    const iPhone = col("telefone", "celular", "whatsapp", "phone");
    const iName = col("nome", "cliente", "name");
    const iDate = col("data", "date");
    const iTotal = col("valor", "total", "amount");
    const iItems = col("item", "produto", "descri");
    const iSeller = col("vendedor", "seller");
    const iStore = col("loja", "store", "filial");
    if (iTotal < 0 || iDate < 0) return void toast.error("A planilha precisa das colunas Data e Valor. Telefone e Nome são recomendados.");
    const parsed: NonNullable<typeof preview>["rows"] = [];
    let skipped = 0;
    for (const r of rows.slice(1)) {
      const sold_at = parseDateLoose(r[iDate] ?? "");
      const total = parseMoney(r[iTotal] ?? "");
      if (!sold_at || total <= 0) { skipped += 1; continue; }
      parsed.push({
        phone: iPhone >= 0 ? digits(r[iPhone]) : "",
        name: iName >= 0 ? (r[iName] ?? "").trim() : "",
        sold_at, total,
        items: iItems >= 0 ? (r[iItems] ?? "").trim() : "",
        seller: iSeller >= 0 ? (r[iSeller] ?? "").trim() : "",
        store: iStore >= 0 ? (r[iStore] ?? "").trim() : "",
      });
    }
    setPreview({ rows: parsed, skipped });
  };

  const handleImport = async () => {
    if (!company || !user || !preview) return;
    try {
      // Contatos novos primeiro, um por telefone desconhecido.
      const phoneMap = new Map(byPhone);
      const newContacts = new Map<string, { name: string; phone: string }>();
      for (const r of preview.rows) {
        if (r.phone.length < 10) continue;
        const key = r.phone.slice(-8);
        if (!phoneMap.has(key) && !newContacts.has(key)) newContacts.set(key, { name: r.name || r.phone, phone: r.phone });
      }
      if (newContacts.size > 0) {
        const { data, error } = await supabase
          .from("contacts")
          .insert([...newContacts.values()].map((c) => ({ user_id: user.id, company_id: company.id, name: c.name, phone: c.phone })))
          .select("id, phone");
        if (error) throw error;
        for (const c of (data ?? []) as Array<{ id: string; phone: string | null }>) {
          const key = digits(c.phone).slice(-8);
          phoneMap.set(key, { id: c.id } as Contact);
        }
      }
      const sellerByName = new Map(team.map((m) => [teamLabel(m).toLowerCase(), m.user_id]));
      const rowsToInsert = preview.rows.map((r) => ({
        contact_id: r.phone.length >= 10 ? phoneMap.get(r.phone.slice(-8))?.id ?? null : null,
        total: Math.round(r.total * 100) / 100,
        items: r.items ? r.items.split(/[;|,]/).map((n) => ({ name: n.trim(), qty: 1, price: null })).filter((i) => i.name) : [],
        seller_id: sellerByName.get(r.seller.toLowerCase()) ?? null,
        store: r.store || null,
        sold_at: r.sold_at,
      }));
      const n = await importSales.mutateAsync({ company_id: company.id, rows: rowsToInsert });
      toast.success(`${n} vendas importadas${newContacts.size ? `, ${newContacts.size} contatos criados` : ""}.`);
      setImportOpen(false);
      setPreview(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar");
    }
  };

  const remove = async (id: string, number: number) => {
    if (!company || !window.confirm(`Excluir a venda #${number}? O giftback gerado por ela continua.`)) return;
    try {
      await deleteSale.mutateAsync({ id, company_id: company.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    }
  };

  const setItem = (index: number, patch: Partial<SaleItem>) =>
    setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));

  return (
    <div>
      <PageHeader
        icon={Receipt}
        title="Vendas"
        description={`${sales.length} ${sales.length === 1 ? "venda registrada" : "vendas registradas"} · cada venda gera giftback e tarefa de pós-venda`}
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet />
              Importar planilha
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Lançar venda
            </Button>
          </>
        }
      />

      <div className="relative mb-4 sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Nº, cliente, telefone ou cupom" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {!isPending && sales.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nenhuma venda ainda"
          description="Lance a primeira venda ou importe a planilha do seu sistema. Pedidos marcados como entregues também viram vendas."
          action={<Button onClick={() => setCreateOpen(true)}><Plus />Lançar venda</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <div className="scrollbar-slim overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Nº</th>
                  <th className="px-4 py-3 font-semibold">Data</th>
                  <th className="px-4 py-3 font-semibold">Cliente</th>
                  <th className="px-4 py-3 font-semibold">Itens</th>
                  <th className="px-4 py-3 font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Cupom</th>
                  <th className="px-4 py-3 font-semibold">Vendedor</th>
                  <th className="px-4 py-3 font-semibold">Origem</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((s) => {
                  const c = s.contact_id ? byId.get(s.contact_id) : undefined;
                  const seller = team.find((m) => m.user_id === s.seller_id);
                  return (
                    <tr key={s.id} className={cn("border-t", s.status === "cancelado" && "opacity-50")}>
                      <td className="tabular px-4 py-3 font-semibold">#{s.number}</td>
                      <td className="tabular px-4 py-3 text-muted-foreground">{new Date(s.sold_at).toLocaleDateString("pt-BR")}</td>
                      <td className="px-4 py-3">{c ? contactLabel(c) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="max-w-xs px-4 py-3"><span className="line-clamp-1 text-muted-foreground">{(s.items ?? []).map((i) => `${i.qty}× ${i.name}`).join(", ") || "—"}</span></td>
                      <td className="tabular px-4 py-3 font-medium">{money(s.total)}{Number(s.discount) > 0 && <span className="block text-xs font-normal text-muted-foreground">-{money(s.discount)}</span>}</td>
                      <td className="px-4 py-3">{s.coupon_code ? <Badge variant="outline" className="font-mono text-[11px]">{s.coupon_code}</Badge> : "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{seller ? teamLabel(seller) : "—"}</td>
                      <td className="px-4 py-3"><Badge variant="secondary">{ORIGIN_LABEL[s.origin] ?? s.origin}</Badge></td>
                      <td className="px-4 py-3">
                        <Button size="icon-sm" variant="ghost" aria-label="Excluir venda" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => void remove(s.id, s.number)}>
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Lançar venda ─────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) setAppliedCoupon(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Lançar venda</DialogTitle>
            <DialogDescription>Cliente, itens e valor. Giftback e tarefa de pós-venda saem sozinhos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              {form.contact_id ? (
                <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                  <span className="font-medium">{contactLabel(byId.get(form.contact_id)!)} <span className="text-muted-foreground">{formatPhone(byId.get(form.contact_id)?.phone)}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => setForm((f) => ({ ...f, contact_id: "" }))}>Trocar</Button>
                </div>
              ) : (
                <>
                  <Input placeholder="Buscar por nome ou telefone" value={form.clientSearch} onChange={(e) => setForm((f) => ({ ...f, clientSearch: e.target.value }))} />
                  {clientMatches.length > 0 && (
                    <div className="rounded-lg border bg-popover shadow-popover">
                      {clientMatches.map((c) => (
                        <button key={c.id} type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setForm((f) => ({ ...f, contact_id: c.id, clientSearch: "" }))}>
                          <span>{contactLabel(c)}</span><span className="text-xs text-muted-foreground">{formatPhone(c.phone)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input placeholder="Ou nome do cliente novo" value={form.newName} onChange={(e) => setForm((f) => ({ ...f, newName: e.target.value }))} />
                    <Input placeholder="Telefone com DDD" value={form.newPhone} onChange={(e) => setForm((f) => ({ ...f, newPhone: e.target.value }))} />
                  </div>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Itens (opcional)</Label>
              <div className="space-y-2">
                {form.items.map((item, index) => (
                  <div key={index} className="flex gap-2">
                    <Input placeholder="Produto" className="flex-1" value={item.name} onChange={(e) => setItem(index, { name: e.target.value })} />
                    <Input type="number" min={1} className="w-16" aria-label="Quantidade" value={item.qty} onChange={(e) => setItem(index, { qty: Number(e.target.value) })} />
                    <Input type="number" min={0} step="0.01" className="w-24" placeholder="R$" aria-label="Preço" value={item.price ?? ""} onChange={(e) => setItem(index, { price: e.target.value === "" ? null : Number(e.target.value) })} />
                    <Button size="icon" variant="ghost" aria-label="Remover" disabled={form.items.length === 1} onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }))}><Trash2 /></Button>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => setForm((f) => ({ ...f, items: [...f.items, { ...NEW_ITEM }] }))}><Plus />Item</Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Valor bruto</Label>
                <Input placeholder={itemsTotal ? money(itemsTotal) : "R$ 0,00"} value={form.total} onChange={(e) => setForm((f) => ({ ...f, total: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Desconto</Label>
                <Input placeholder="R$ 0,00" value={form.discount} onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Frete</Label>
                <Input placeholder="R$ 0,00" value={form.shipping} onChange={(e) => setForm((f) => ({ ...f, shipping: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Cupom ou giftback</Label>
              <div className="flex gap-2">
                <Input placeholder="GB-XXXXXX" className="font-mono uppercase" value={form.coupon} onChange={(e) => setForm((f) => ({ ...f, coupon: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && applyCoupon()} />
                <Button variant="outline" onClick={applyCoupon} disabled={!form.coupon.trim()}>Aplicar</Button>
              </div>
              {appliedCoupon && (
                <p className="text-xs text-success">{appliedCoupon.code} aplicado: -{money(couponDiscount)}. <button type="button" className="underline" onClick={() => setAppliedCoupon(null)}>remover</button></p>
              )}
              {form.contact_id && coupons.some((c) => c.contact_id === form.contact_id && c.status === "ativo") && !appliedCoupon && (
                <p className="text-xs text-muted-foreground">
                  Este cliente tem giftback ativo: {coupons.filter((c) => c.contact_id === form.contact_id && c.status === "ativo").map((c) => `${c.code} (${money(c.value)})`).join(", ")}
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Vendedor</Label>
                <Select value={form.seller_id || "none"} onValueChange={(v) => setForm((f) => ({ ...f, seller_id: v === "none" ? "" : v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem vendedor</SelectItem>
                    {team.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{teamLabel(m)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Loja (opcional)</Label>
                <Input placeholder="Centro, Shopping..." value={form.store} onChange={(e) => setForm((f) => ({ ...f, store: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Observações</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <span className="tabular self-center text-sm font-semibold">Total {money(net)}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button onClick={() => void handleCreate()} disabled={createSale.isPending}>{createSale.isPending ? "Registrando..." : "Registrar venda"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Importar planilha ────────────────────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={(v) => { setImportOpen(v); if (!v) setPreview(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar vendas de planilha</DialogTitle>
            <DialogDescription>
              CSV exportado do seu sistema. Colunas reconhecidas pelo nome: Data, Valor, Telefone, Nome, Itens, Vendedor, Loja. Vendas importadas não geram giftback nem tarefa.
            </DialogDescription>
          </DialogHeader>
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }} />
          {!preview ? (
            <Button variant="outline" onClick={() => fileInput.current?.click()}><FileSpreadsheet />Escolher arquivo CSV</Button>
          ) : (
            <div className="space-y-2 text-sm">
              <p><b>{preview.rows.length}</b> vendas prontas para importar{preview.skipped > 0 && <span className="text-muted-foreground"> · {preview.skipped} linhas sem data ou valor foram ignoradas</span>}.</p>
              <p className="text-muted-foreground">{preview.rows.filter((r) => r.phone.length >= 10).length} com telefone (viram cliente); as demais entram sem cliente.</p>
              <div className="max-h-40 overflow-auto rounded-lg border text-xs">
                <table className="w-full">
                  <tbody>
                    {preview.rows.slice(0, 8).map((r, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-2 py-1">{new Date(r.sold_at).toLocaleDateString("pt-BR")}</td>
                        <td className="px-2 py-1">{r.name || r.phone || "—"}</td>
                        <td className="tabular px-2 py-1 text-right">{money(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportOpen(false); setPreview(null); }}>Cancelar</Button>
            <Button onClick={() => void handleImport()} disabled={!preview || importSales.isPending}>{importSales.isPending ? "Importando..." : "Importar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useMemo, useState } from "react";
import { MessageSquare, Plus, Search, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactsQuery, useOrdersQuery, useCreateOrderMutation, useUpdateOrderMutation, useDeleteOrderMutation,
} from "@/hooks/queries";
import {
  ORDER_STATUSES, contactLabel, orderTotal, type Contact, type Order, type OrderItem, type OrderStatus,
} from "@/lib/types";
import { sendWhatsappText, firstNameForMessage } from "@/lib/sendMessage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function relative(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** O que o cliente recebe quando o status muda. */
function statusMessage(order: Order, contact: Contact | undefined, status: OrderStatus): string {
  const nome = firstNameForMessage(contact?.name);
  const oi = nome ? `Oi ${nome}! ` : "";
  switch (status) {
    case "recebido":
      return `${oi}Recebemos seu pedido #${order.number}${order.total ? ` (${money(order.total)})` : ""}. Já vamos começar a preparar.`;
    case "preparo":
      return `${oi}Seu pedido #${order.number} está em preparo.`;
    case "saiu":
      return `${oi}Seu pedido #${order.number} saiu para entrega! 🛵`;
    case "entregue":
      return `${oi}Pedido #${order.number} entregue. Bom apetite, e obrigado!`;
    case "cancelado":
      return `${oi}Seu pedido #${order.number} foi cancelado. Qualquer dúvida, é só responder aqui.`;
  }
}

const NEW_ITEM: OrderItem = { name: "", qty: 1, price: null };

export default function Pedidos() {
  const { company } = useAuth();
  const { data: orders = [], isPending } = useOrdersQuery(company?.id);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const createOrder = useCreateOrderMutation();
  const updateOrder = useUpdateOrderMutation();
  const deleteOrder = useDeleteOrderMutation();

  const [tab, setTab] = useState<"abertos" | OrderStatus | "todos">("abertos");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    contact_id: "", items: [{ ...NEW_ITEM }] as OrderItem[], delivery_address: "", notes: "",
  });

  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const contactsSorted = useMemo(
    () => contacts.slice().sort((a, b) => contactLabel(a).localeCompare(contactLabel(b), "pt-BR")),
    [contacts],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { abertos: 0, todos: orders.length };
    for (const o of orders) {
      c[o.status] = (c[o.status] ?? 0) + 1;
      if (o.status !== "entregue" && o.status !== "cancelado") c.abertos += 1;
    }
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (tab === "abertos" && (o.status === "entregue" || o.status === "cancelado")) return false;
      if (tab !== "abertos" && tab !== "todos" && o.status !== tab) return false;
      if (!term) return true;
      const contact = o.contact_id ? byId.get(o.contact_id) : undefined;
      return (
        String(o.number).includes(term) ||
        (contact ? contactLabel(contact).toLowerCase().includes(term) : false) ||
        o.items.some((i) => i.name.toLowerCase().includes(term))
      );
    });
  }, [orders, tab, search, byId]);

  const notify = async (order: Order, status: OrderStatus) => {
    const contact = order.contact_id ? byId.get(order.contact_id) : undefined;
    if (!company || !contact?.phone) {
      toast.error("Pedido sem contato com telefone.");
      return;
    }
    try {
      await sendWhatsappText({
        company_id: company.id,
        contact_id: contact.id,
        phone: contact.phone,
        text: statusMessage(order, contact, status),
      });
      toast.success(`Cliente avisado: pedido #${order.number}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao avisar");
    }
  };

  const changeStatus = async (order: Order, status: OrderStatus) => {
    if (!company || status === order.status) return;
    try {
      await updateOrder.mutateAsync({ id: order.id, company_id: company.id, status });
      const contact = order.contact_id ? byId.get(order.contact_id) : undefined;
      const label = ORDER_STATUSES.find((s) => s.id === status)?.label ?? status;
      if (contact?.phone) {
        // Avisar é um clique, não automático: nem todo status merece mensagem.
        toast.success(`#${order.number} · ${label}`, {
          action: { label: "Avisar cliente", onClick: () => void notify({ ...order, status }, status) },
        });
      } else {
        toast.success(`#${order.number} · ${label}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao mudar status");
    }
  };

  const handleCreate = async () => {
    if (!company) return;
    const items = form.items
      .map((i) => ({ ...i, name: i.name.trim(), qty: Math.max(1, Number(i.qty) || 1) }))
      .filter((i) => i.name);
    if (items.length === 0) {
      toast.error("Adicione pelo menos um item.");
      return;
    }
    try {
      const created = await createOrder.mutateAsync({
        company_id: company.id,
        contact_id: form.contact_id || null,
        items,
        total: orderTotal(items),
        delivery_address: form.delivery_address.trim() || null,
        notes: form.notes.trim() || null,
      });
      toast.success(created ? `Pedido #${created.number} criado.` : "Pedido criado.");
      setCreateOpen(false);
      setForm({ contact_id: "", items: [{ ...NEW_ITEM }], delivery_address: "", notes: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar pedido");
    }
  };

  const remove = async (order: Order) => {
    if (!company || !window.confirm(`Excluir o pedido #${order.number}?`)) return;
    try {
      await deleteOrder.mutateAsync({ id: order.id, company_id: company.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    }
  };

  const setItem = (index: number, patch: Partial<OrderItem>) =>
    setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));

  return (
    <div>
      <PageHeader
        icon={ShoppingBag}
        title="Pedidos"
        description={`${counts.abertos} ${counts.abertos === 1 ? "pedido aberto" : "pedidos abertos"} · a IA registra o que o cliente pede no chat`}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            Novo pedido
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="abertos">Abertos <span className="ml-1 text-xs text-muted-foreground">{counts.abertos}</span></TabsTrigger>
            {ORDER_STATUSES.map((s) => (
              <TabsTrigger key={s.id} value={s.id}>
                {s.label} <span className="ml-1 text-xs text-muted-foreground">{counts[s.id] ?? 0}</span>
              </TabsTrigger>
            ))}
            <TabsTrigger value="todos">Todos</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative sm:ml-auto sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Nº, contato ou item" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {!isPending && orders.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Nenhum pedido ainda"
          description="Crie o primeiro aqui ou deixe a IA registrar quando o cliente pedir pelo WhatsApp."
          action={<Button onClick={() => setCreateOpen(true)}><Plus />Novo pedido</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <div className="scrollbar-slim overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Nº</th>
                  <th className="px-4 py-3 font-semibold">Contato</th>
                  <th className="px-4 py-3 font-semibold">Itens</th>
                  <th className="px-4 py-3 font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Criado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">Nada aqui.</td></tr>
                ) : (
                  filtered.map((order) => {
                    const contact = order.contact_id ? byId.get(order.contact_id) : undefined;
                    const status = ORDER_STATUSES.find((s) => s.id === order.status);
                    return (
                      <tr key={order.id} className="border-t">
                        <td className="tabular px-4 py-3 font-semibold">
                          #{order.number}
                          {order.created_by === "ai" && <Badge variant="outline" className="ml-2">IA</Badge>}
                        </td>
                        <td className="px-4 py-3">
                          {contact ? contactLabel(contact) : <span className="text-muted-foreground">—</span>}
                          {order.delivery_address && (
                            <span className="block truncate text-xs text-muted-foreground">{order.delivery_address}</span>
                          )}
                        </td>
                        <td className="max-w-xs px-4 py-3">
                          <span className="line-clamp-2 text-muted-foreground">
                            {order.items.map((i) => `${i.qty}× ${i.name}`).join(", ") || "—"}
                          </span>
                          {order.notes && <span className="block truncate text-xs italic text-muted-foreground">{order.notes}</span>}
                        </td>
                        <td className="tabular px-4 py-3">{money(order.total)}</td>
                        <td className="px-4 py-3">
                          <Select value={order.status} onValueChange={(v) => void changeStatus(order, v as OrderStatus)}>
                            <SelectTrigger className={cn("h-8 w-40 text-xs", status?.badge)}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ORDER_STATUSES.map((s) => (
                                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="tabular px-4 py-3 text-muted-foreground">{relative(order.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon-sm" variant="ghost" title="Avisar cliente do status atual"
                              disabled={!contact?.phone}
                              onClick={() => void notify(order, order.status)}
                            >
                              <MessageSquare />
                            </Button>
                            <Button
                              size="icon-sm" variant="ghost" aria-label="Excluir pedido"
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void remove(order)}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo pedido</DialogTitle>
            <DialogDescription>Itens, quantidade e preço. O total é calculado.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Contato</Label>
              <Select value={form.contact_id || "none"} onValueChange={(v) => setForm((f) => ({ ...f, contact_id: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Escolha o contato" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem contato</SelectItem>
                  {contactsSorted.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{contactLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Itens</Label>
              <div className="space-y-2">
                {form.items.map((item, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder="Item"
                      className="flex-1"
                      value={item.name}
                      onChange={(e) => setItem(index, { name: e.target.value })}
                    />
                    <Input
                      type="number" min={1} className="w-16" aria-label="Quantidade"
                      value={item.qty}
                      onChange={(e) => setItem(index, { qty: Number(e.target.value) })}
                    />
                    <Input
                      type="number" min={0} step="0.01" className="w-24" placeholder="R$" aria-label="Preço"
                      value={item.price ?? ""}
                      onChange={(e) => setItem(index, { price: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                    <Button
                      size="icon" variant="ghost" aria-label="Remover item"
                      disabled={form.items.length === 1}
                      onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <Button size="sm" variant="outline" onClick={() => setForm((f) => ({ ...f, items: [...f.items, { ...NEW_ITEM }] }))}>
                  <Plus />
                  Item
                </Button>
                <span className="tabular text-sm font-medium">Total {money(orderTotal(form.items))}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Endereço de entrega (opcional)</Label>
              <Input value={form.delivery_address} onChange={(e) => setForm((f) => ({ ...f, delivery_address: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Observações (opcional)</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={() => void handleCreate()} disabled={createOrder.isPending}>
              {createOrder.isPending ? "Criando..." : "Criar pedido"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

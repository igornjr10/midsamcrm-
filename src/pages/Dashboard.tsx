import { useMemo, useState } from "react";
import { LayoutDashboard } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactsQuery, useSalesQuery, useCouponsQuery, useCompanyTeamQuery,
} from "@/hooks/queries";
import {
  RFM_SEGMENTS, computeMetrics, money, npsSummary, repurchase, revenueByMonth, revenueByWeekday,
  summarize, topProducts,
} from "@/lib/retail";
import { contactLabel, getToneClasses, teamLabel, type Sale } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

type Period = "mes" | "30" | "90" | "12m" | "tudo";
const PERIODS: Array<{ id: Period; label: string }> = [
  { id: "mes", label: "Este mês" },
  { id: "30", label: "Últimos 30 dias" },
  { id: "90", label: "Últimos 90 dias" },
  { id: "12m", label: "Últimos 12 meses" },
  { id: "tudo", label: "Desde o início" },
];

function periodStart(p: Period, now = new Date()): number | null {
  switch (p) {
    case "mes": return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    case "30": return now.getTime() - 30 * 86_400_000;
    case "90": return now.getTime() - 90 * 86_400_000;
    case "12m": return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).getTime();
    default: return null;
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Tile de indicador: rótulo, número grande e uma linha de apoio. */
function Tile({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-card">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("tabular mt-1 text-2xl font-semibold tracking-tight", accent && "text-primary")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Barras simples em SVG: sem biblioteca, mesma cor do tema. */
function Bars({ data, format }: { data: Array<{ label: string; value: number }>; format: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / data.length;
  return (
    <div>
      <svg viewBox="0 0 100 40" className="h-40 w-full" preserveAspectRatio="none" aria-hidden>
        {data.map((d, i) => {
          const h = (d.value / max) * 34;
          return (
            <rect
              key={i}
              x={i * w + w * 0.15}
              y={38 - h}
              width={w * 0.7}
              height={h}
              rx={0.8}
              className={cn("fill-primary/80", d.value === 0 && "fill-muted")}
            >
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex text-[11px] text-muted-foreground">
        {data.map((d, i) => (
          <span key={i} className="flex-1 truncate text-center">{d.label}</span>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { company } = useAuth();
  const { data: sales = [], isPending } = useSalesQuery(company?.id);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const { data: coupons = [] } = useCouponsQuery(company?.id);
  const { data: team = [] } = useCompanyTeamQuery(company?.id);

  const [period, setPeriod] = useState<Period>("mes");
  const [store, setStore] = useState("all");

  const stores = useMemo(
    () => Array.from(new Set(sales.map((s) => s.store).filter((s): s is string => !!s))).sort(),
    [sales],
  );

  // RFM e LTV olham a base inteira; o recorte por período vale para receita e vendas.
  const allMetrics = useMemo(() => computeMetrics(sales), [sales]);
  const filtered = useMemo(() => {
    const start = periodStart(period);
    return sales.filter((s) => (start === null || new Date(s.sold_at).getTime() >= start) && (store === "all" || s.store === store));
  }, [sales, period, store]);
  const summary = useMemo(() => summarize(filtered, computeMetrics(filtered)), [filtered]);
  const base = useMemo(() => summarize(sales, allMetrics), [sales, allMetrics]);
  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  const months = useMemo(() => revenueByMonth(sales.filter((s) => store === "all" || s.store === store)), [sales, store]);
  const weekdays = useMemo(() => revenueByWeekday(filtered), [filtered]);
  const products = useMemo(() => topProducts(filtered), [filtered]);
  const rep = useMemo(() => repurchase(sales), [sales]);
  const nps = useMemo(() => npsSummary(contacts), [contacts]);

  const bySeller = useMemo(() => {
    const acc = new Map<string, { sales: number; revenue: number }>();
    for (const s of filtered) {
      if (s.status !== "pago") continue;
      const k = s.seller_id ?? "none";
      const cur = acc.get(k) ?? { sales: 0, revenue: 0 };
      cur.sales += 1;
      cur.revenue += Number(s.total) || 0;
      acc.set(k, cur);
    }
    return [...acc.entries()]
      .map(([id, v]) => ({
        id,
        name: id === "none" ? "Sem vendedor" : (team.find((m) => m.user_id === id) ? teamLabel(team.find((m) => m.user_id === id)!) : "Vendedor"),
        ...v,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filtered, team]);

  const rfmCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of allMetrics.values()) counts.set(m.segment, (counts.get(m.segment) ?? 0) + 1);
    counts.set("sem_compra", contacts.filter((c) => !allMetrics.has(c.id)).length);
    return counts;
  }, [allMetrics, contacts]);

  // Matriz recência × frequência (5×5) com o número de clientes em cada célula.
  const matrix = useMemo(() => {
    const grid = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]);
    for (const m of allMetrics.values()) grid[5 - m.r][m.f - 1] += 1;
    return grid;
  }, [allMetrics]);

  const couponStats = useMemo(() => {
    const gb = coupons.filter((c) => c.kind === "giftback");
    const used = gb.filter((c) => c.status === "usado");
    const active = gb.filter((c) => c.status === "ativo");
    const cupons = coupons.filter((c) => c.kind === "cupom");
    const revenueWithCoupon = filtered.filter((s) => s.coupon_id && s.status === "pago").reduce((a, s) => a + (Number(s.total) || 0), 0);
    return {
      generated: gb.length,
      used: used.length,
      active: active.length,
      activeValue: active.reduce((a, c) => a + Number(c.value), 0),
      rate: gb.length ? used.length / gb.length : 0,
      cupons: cupons.length,
      cuponsUsed: cupons.filter((c) => c.status === "usado").length,
      revenueWithCoupon,
    };
  }, [coupons, filtered]);

  const npsResponses = useMemo(
    () => contacts.filter((c) => c.nps_score !== null && c.nps_score !== undefined)
      .sort((a, b) => (b.nps_answered_at ?? "").localeCompare(a.nps_answered_at ?? "")).slice(0, 20),
    [contacts],
  );

  const salesOf = (s: Sale) => (s.contact_id ? byId.get(s.contact_id) : undefined);

  return (
    <div>
      <PageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        description="Receita, recompra e retenção. Tudo a partir das vendas registradas."
        actions={
          <>
            {stores.length > 0 && (
              <Select value={store} onValueChange={setStore}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as lojas</SelectItem>
                  {stores.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        }
      />

      {!isPending && sales.length === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          title="Nenhuma venda registrada ainda"
          description="Lance uma venda em Vendas, importe a planilha do seu sistema ou marque um pedido como entregue. O dashboard nasce daí."
        />
      ) : (
        <Tabs defaultValue="geral">
          <TabsList className="flex-wrap">
            <TabsTrigger value="geral">Visão geral</TabsTrigger>
            <TabsTrigger value="rfm">Matriz RFM</TabsTrigger>
            <TabsTrigger value="nps">NPS</TabsTrigger>
            <TabsTrigger value="vendedor">Vendedor</TabsTrigger>
            <TabsTrigger value="recompra">Recompra</TabsTrigger>
            <TabsTrigger value="cupom">Cupom</TabsTrigger>
            <TabsTrigger value="produtos">Produtos</TabsTrigger>
          </TabsList>

          <TabsContent value="geral" className="mt-4 space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Tile label="Receita" value={money(summary.revenue)} hint={`${summary.sales} ${summary.sales === 1 ? "venda" : "vendas"} no período`} />
              <Tile label="Ticket médio" value={money(summary.avgTicket)} />
              <Tile label="Receita com giftback" value={money(summary.influenced.giftback)} hint="Vendas em que um cupom foi usado" accent />
              <Tile label="Retenção" value={pct(base.retention)} hint="Clientes que compraram 2 ou mais vezes" />
              <Tile label="LTV médio" value={money(base.ltv)} hint="Receita total por cliente" />
              <Tile label="Clientes com compra" value={String(base.customers)} hint={`de ${contacts.length} contatos`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-card p-4 shadow-card">
                <p className="mb-3 text-sm font-semibold">Evolução de vendas · 12 meses</p>
                <Bars data={months.map((m) => ({ label: m.label, value: m.revenue }))} format={money} />
              </div>
              <div className="rounded-xl border border-border/60 bg-card p-4 shadow-card">
                <p className="mb-3 text-sm font-semibold">Vendas por dia da semana</p>
                <Bars data={weekdays.map((d) => ({ label: d.label, value: d.revenue }))} format={money} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="rfm" className="mt-4 space-y-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="rounded-xl border border-border/60 bg-card p-4 shadow-card">
                <p className="text-sm font-semibold">Matriz RFM</p>
                <p className="mb-3 text-xs text-muted-foreground">Linhas: recência (em cima, comprou há pouco). Colunas: frequência (à direita, compra mais). O número é quantos clientes.</p>
                <div className="grid grid-cols-[auto_repeat(5,minmax(0,1fr))] gap-1 text-xs">
                  <span />
                  {[1, 2, 3, 4, 5].map((f) => <span key={f} className="text-center text-muted-foreground">F{f}</span>)}
                  {matrix.map((row, i) => (
                    <div key={i} className="contents">
                      <span className="pr-1 text-muted-foreground">R{5 - i}</span>
                      {row.map((n, j) => {
                        const intensity = n === 0 ? 0 : Math.min(1, 0.25 + n / Math.max(1, allMetrics.size) * 3);
                        return (
                          <span
                            key={j}
                            className="tabular flex h-10 items-center justify-center rounded-md border border-border/50 font-medium"
                            style={{ background: `hsl(var(--primary) / ${intensity * 0.6})` }}
                          >
                            {n || ""}
                          </span>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                {RFM_SEGMENTS.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", getToneClasses(s.tone).dot)} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{s.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{s.hint}</span>
                    </span>
                    <span className="tabular font-semibold">{rfmCounts.get(s.id) ?? 0}</span>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="nps" className="mt-4 space-y-4">
            <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
              <div className="rounded-xl border border-border/60 bg-card p-4 shadow-card">
                <p className="text-sm font-semibold">NPS</p>
                <p className={cn("tabular mt-2 text-5xl font-semibold tracking-tight", nps.score === null ? "text-muted-foreground" : nps.score >= 50 ? "text-success" : nps.score >= 0 ? "text-warning" : "text-destructive")}>
                  {nps.score ?? "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{nps.total} {nps.total === 1 ? "resposta" : "respostas"} · de -100 a 100</p>
                <div className="mt-4 space-y-1.5 text-xs">
                  <div className="flex justify-between"><span>Promotores (9-10)</span><span className="tabular font-medium text-success">{nps.promoters}</span></div>
                  <div className="flex justify-between"><span>Neutros (7-8)</span><span className="tabular font-medium">{nps.passives}</span></div>
                  <div className="flex justify-between"><span>Detratores (0-6)</span><span className="tabular font-medium text-destructive">{nps.detractors}</span></div>
                </div>
                <div className="mt-4">
                  <Bars data={nps.distribution.map((n, i) => ({ label: String(i), value: n }))} format={(n) => `${n} resp.`} />
                </div>
              </div>
              <div className="rounded-xl border border-border/60 bg-card p-4 shadow-card">
                <p className="mb-3 text-sm font-semibold">Respostas recentes</p>
                {npsResponses.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">Nenhuma resposta ainda. Ligue a régua de NPS em SDR IA → Relacionamento.</p>
                ) : (
                  <div className="space-y-1.5">
                    {npsResponses.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                        <span className="truncate">{contactLabel(c)}</span>
                        <span className="flex items-center gap-2">
                          <span className="tabular text-xs text-muted-foreground">{c.nps_answered_at ? new Date(c.nps_answered_at).toLocaleDateString("pt-BR") : ""}</span>
                          <Badge variant={(c.nps_score as number) >= 9 ? "success" : (c.nps_score as number) <= 6 ? "destructive" : "secondary"}>{c.nps_score}</Badge>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="vendedor" className="mt-4">
            <div className="overflow-hidden rounded-xl border bg-card shadow-card">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-4 py-3 font-semibold">Vendedor</th><th className="px-4 py-3 font-semibold">Vendas</th><th className="px-4 py-3 font-semibold">Receita</th><th className="px-4 py-3 font-semibold">Ticket médio</th></tr>
                </thead>
                <tbody>
                  {bySeller.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">Nenhuma venda no período.</td></tr>
                  ) : bySeller.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="px-4 py-3 font-medium">{s.name}</td>
                      <td className="tabular px-4 py-3">{s.sales}</td>
                      <td className="tabular px-4 py-3">{money(s.revenue)}</td>
                      <td className="tabular px-4 py-3 text-muted-foreground">{money(s.revenue / s.sales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="recompra" className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="Taxa de recompra" value={pct(rep.rate)} hint={`${rep.repeaters} de ${rep.customers} clientes voltaram`} />
              <Tile label="Tempo médio entre compras" value={rep.avgDays === null ? "—" : `${rep.avgDays} dias`} hint="Use como prazo da régua de recompra" />
              <Tile label="Clientes com 1 compra só" value={String(rep.customers - rep.repeaters)} hint="Candidatos à régua de reativação" />
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-4 shadow-card">
              <p className="mb-3 text-sm font-semibold">Quem mais volta</p>
              <div className="space-y-1.5">
                {[...allMetrics.values()].sort((a, b) => b.purchases - a.purchases || b.spent - a.spent).slice(0, 10).map((m) => {
                  const c = byId.get(m.contactId);
                  return (
                    <div key={m.contactId} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                      <span className="truncate">{c ? contactLabel(c) : "Contato"}</span>
                      <span className="tabular text-xs text-muted-foreground">{m.purchases} compras · {money(m.spent)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="cupom" className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Giftbacks gerados" value={String(couponStats.generated)} />
              <Tile label="Giftbacks usados" value={String(couponStats.used)} hint={`${pct(couponStats.rate)} de uso`} accent />
              <Tile label="Crédito ativo na rua" value={money(couponStats.activeValue)} hint={`${couponStats.active} giftbacks válidos`} />
              <Tile label="Receita com cupom" value={money(couponStats.revenueWithCoupon)} hint="No período" />
            </div>
            <p className="text-xs text-muted-foreground">Cupons avulsos: {couponStats.cupons} criados, {couponStats.cuponsUsed} usados. Gerencie em Bônus.</p>
          </TabsContent>

          <TabsContent value="produtos" className="mt-4">
            <div className="overflow-hidden rounded-xl border bg-card shadow-card">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-4 py-3 font-semibold">Produto</th><th className="px-4 py-3 font-semibold">Unidades</th><th className="px-4 py-3 font-semibold">Receita</th></tr>
                </thead>
                <tbody>
                  {products.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">As vendas do período não têm itens detalhados.</td></tr>
                  ) : products.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="px-4 py-3 font-medium">{p.name}</td>
                      <td className="tabular px-4 py-3">{p.qty}</td>
                      <td className="tabular px-4 py-3">{money(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {filtered.filter((s) => (s.items?.length ?? 0) > 0).length} de {filtered.length} vendas com itens. Última venda: {filtered[0] ? `${salesOf(filtered[0]) ? contactLabel(salesOf(filtered[0])!) : "sem contato"} · ${money(filtered[0].total)}` : "—"}.
              </p>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

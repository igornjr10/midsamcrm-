import type { Contact, Coupon, Sale, Segment, SegmentRules } from "@/lib/types";
import { firstNameForMessage } from "@/lib/sendMessage";

const DAY = 86_400_000;

export const money = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ── Métricas por cliente ────────────────────────────────────────────────────

export type RfmSegment =
  | "campeoes" | "leais" | "promissores" | "novos" | "atencao" | "em_risco" | "inativos" | "sem_compra";

export const RFM_SEGMENTS: Array<{ id: RfmSegment; label: string; hint: string; tone: string }> = [
  { id: "campeoes", label: "Campeões", hint: "Compraram há pouco, muitas vezes e gastam mais", tone: "emerald" },
  { id: "leais", label: "Leais", hint: "Compram com frequência", tone: "teal" },
  { id: "promissores", label: "Promissores", hint: "Recentes, com poucas compras ainda", tone: "sky" },
  { id: "novos", label: "Novos", hint: "Primeira compra recente", tone: "indigo" },
  { id: "atencao", label: "Precisam de atenção", hint: "Já foram bons, estão esfriando", tone: "amber" },
  { id: "em_risco", label: "Em risco", hint: "Compravam bastante e sumiram", tone: "rose" },
  { id: "inativos", label: "Inativos", hint: "Há muito tempo sem comprar", tone: "slate" },
  { id: "sem_compra", label: "Sem compra", hint: "Contato sem venda registrada", tone: "slate" },
];

export interface ContactMetrics {
  contactId: string;
  purchases: number;
  spent: number;
  avgTicket: number;
  lastPurchaseAt: string | null;
  firstPurchaseAt: string | null;
  recencyDays: number | null;
  /** 1 a 5, quintis dentro da base. 0 = sem compra. */
  r: number;
  f: number;
  m: number;
  segment: RfmSegment;
}

function quintile(sorted: number[], value: number, higherIsBetter: boolean): number {
  if (sorted.length === 0) return 3;
  // Posição relativa na base: 0 (pior) a 1 (melhor).
  let idx = 0;
  while (idx < sorted.length && sorted[idx] < value) idx++;
  const pct = sorted.length === 1 ? 1 : idx / (sorted.length - 1);
  const score = 1 + Math.min(4, Math.floor((higherIsBetter ? pct : 1 - pct) * 5));
  return Math.max(1, Math.min(5, score));
}

function classify(r: number, f: number, m: number): RfmSegment {
  if (r >= 4 && f >= 4 && m >= 4) return "campeoes";
  if (f >= 4) return r >= 3 ? "leais" : "em_risco";
  if (r >= 4) return f >= 2 ? "promissores" : "novos";
  if (r === 3) return "atencao";
  if (r <= 2 && (f >= 3 || m >= 4)) return "em_risco";
  return "inativos";
}

/** Recência, frequência e valor de cada contato, com os quintis calculados na base inteira. */
export function computeMetrics(sales: Sale[], now = Date.now()): Map<string, ContactMetrics> {
  const acc = new Map<string, { n: number; spent: number; last: number; first: number }>();
  for (const s of sales) {
    if (!s.contact_id || s.status !== "pago") continue;
    const t = new Date(s.sold_at).getTime();
    const cur = acc.get(s.contact_id) ?? { n: 0, spent: 0, last: 0, first: Infinity };
    cur.n += 1;
    cur.spent += Number(s.total) || 0;
    cur.last = Math.max(cur.last, t);
    cur.first = Math.min(cur.first, t);
    acc.set(s.contact_id, cur);
  }
  const recencies = [...acc.values()].map((v) => (now - v.last) / DAY).sort((a, b) => a - b);
  const freqs = [...acc.values()].map((v) => v.n).sort((a, b) => a - b);
  const monies = [...acc.values()].map((v) => v.spent).sort((a, b) => a - b);

  const out = new Map<string, ContactMetrics>();
  for (const [id, v] of acc) {
    const recency = (now - v.last) / DAY;
    const r = quintile(recencies, recency, false);
    const f = quintile(freqs, v.n, true);
    const m = quintile(monies, v.spent, true);
    out.set(id, {
      contactId: id,
      purchases: v.n,
      spent: Math.round(v.spent * 100) / 100,
      avgTicket: Math.round((v.spent / v.n) * 100) / 100,
      lastPurchaseAt: new Date(v.last).toISOString(),
      firstPurchaseAt: new Date(v.first).toISOString(),
      recencyDays: Math.floor(recency),
      r, f, m,
      segment: classify(r, f, m),
    });
  }
  return out;
}

export function metricsFor(map: Map<string, ContactMetrics>, contactId: string): ContactMetrics {
  return (
    map.get(contactId) ?? {
      contactId, purchases: 0, spent: 0, avgTicket: 0, lastPurchaseAt: null, firstPurchaseAt: null,
      recencyDays: null, r: 0, f: 0, m: 0, segment: "sem_compra",
    }
  );
}

// ── Resumo do negócio ───────────────────────────────────────────────────────

export interface BusinessSummary {
  revenue: number;
  sales: number;
  avgTicket: number;
  /** Clientes com 2+ compras sobre clientes com compra. */
  retention: number;
  ltv: number;
  customers: number;
  influenced: { giftback: number; rules: number; campaigns: number; total: number };
}

export function summarize(sales: Sale[], metrics: Map<string, ContactMetrics>): BusinessSummary {
  const paid = sales.filter((s) => s.status === "pago");
  const revenue = paid.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const customers = metrics.size;
  const repeat = [...metrics.values()].filter((m) => m.purchases >= 2).length;
  const giftback = paid.filter((s) => s.coupon_id).reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  return {
    revenue,
    sales: paid.length,
    avgTicket: paid.length ? revenue / paid.length : 0,
    retention: customers ? repeat / customers : 0,
    ltv: customers ? revenue / customers : 0,
    customers,
    influenced: { giftback, rules: 0, campaigns: 0, total: giftback },
  };
}

/** Receita por mês, últimos N meses, do mais antigo ao mais novo. */
export function revenueByMonth(sales: Sale[], months = 12, now = new Date()) {
  const out: Array<{ key: string; label: string; revenue: number; count: number }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
      revenue: 0,
      count: 0,
    });
  }
  const idx = new Map(out.map((m, i) => [m.key, i]));
  for (const s of sales) {
    if (s.status !== "pago") continue;
    const d = new Date(s.sold_at);
    const i = idx.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    if (i === undefined) continue;
    out[i].revenue += Number(s.total) || 0;
    out[i].count += 1;
  }
  return out;
}

export function revenueByWeekday(sales: Sale[]) {
  const labels = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const out = labels.map((label) => ({ label, revenue: 0, count: 0 }));
  for (const s of sales) {
    if (s.status !== "pago") continue;
    const d = new Date(s.sold_at).getDay();
    out[d].revenue += Number(s.total) || 0;
    out[d].count += 1;
  }
  return out;
}

export function topProducts(sales: Sale[], limit = 10) {
  const acc = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const s of sales) {
    if (s.status !== "pago") continue;
    for (const it of s.items ?? []) {
      const key = it.name.trim().toLowerCase();
      if (!key) continue;
      const cur = acc.get(key) ?? { name: it.name.trim(), qty: 0, revenue: 0 };
      cur.qty += Number(it.qty) || 1;
      cur.revenue += (Number(it.price) || 0) * (Number(it.qty) || 1);
      acc.set(key, cur);
    }
  }
  return [...acc.values()].sort((a, b) => b.revenue - a.revenue || b.qty - a.qty).slice(0, limit);
}

/** Dias médios entre compras de quem comprou 2+ vezes, e taxa de recompra. */
export function repurchase(sales: Sale[]) {
  const byContact = new Map<string, number[]>();
  for (const s of sales) {
    if (!s.contact_id || s.status !== "pago") continue;
    const list = byContact.get(s.contact_id) ?? [];
    list.push(new Date(s.sold_at).getTime());
    byContact.set(s.contact_id, list);
  }
  let gaps = 0;
  let gapSum = 0;
  let repeaters = 0;
  for (const times of byContact.values()) {
    if (times.length < 2) continue;
    repeaters += 1;
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      gaps += 1;
      gapSum += (times[i] - times[i - 1]) / DAY;
    }
  }
  return {
    customers: byContact.size,
    repeaters,
    rate: byContact.size ? repeaters / byContact.size : 0,
    avgDays: gaps ? Math.round(gapSum / gaps) : null,
  };
}

/** NPS clássico: % promotores (9-10) menos % detratores (0-6). */
export function npsSummary(contacts: Contact[]) {
  const scored = contacts.filter((c) => c.nps_score !== null && c.nps_score !== undefined);
  const promoters = scored.filter((c) => (c.nps_score as number) >= 9).length;
  const detractors = scored.filter((c) => (c.nps_score as number) <= 6).length;
  const passives = scored.length - promoters - detractors;
  return {
    total: scored.length,
    promoters, passives, detractors,
    score: scored.length ? Math.round(((promoters - detractors) / scored.length) * 100) : null,
    distribution: Array.from({ length: 11 }, (_, n) => scored.filter((c) => c.nps_score === n).length),
  };
}

// ── Segmentos ───────────────────────────────────────────────────────────────

export function matchesSegment(
  contact: Contact,
  rules: SegmentRules,
  metrics: Map<string, ContactMetrics>,
  coupons: Coupon[],
  now = Date.now(),
): boolean {
  const m = metricsFor(metrics, contact.id);
  if (rules.rfm?.length && !rules.rfm.includes(m.segment)) return false;
  if (rules.last_purchase_days) {
    if (m.recencyDays === null) return false;
    const { min, max } = rules.last_purchase_days;
    if (min !== undefined && min !== null && m.recencyDays < min) return false;
    if (max !== undefined && max !== null && m.recencyDays > max) return false;
  }
  if (rules.purchases) {
    const { min, max } = rules.purchases;
    if (min !== undefined && min !== null && m.purchases < min) return false;
    if (max !== undefined && max !== null && m.purchases > max) return false;
  }
  if (rules.spent) {
    const { min, max } = rules.spent;
    if (min !== undefined && min !== null && m.spent < min) return false;
    if (max !== undefined && max !== null && m.spent > max) return false;
  }
  if (rules.tags?.length && !rules.tags.some((t) => contact.tags?.includes(t))) return false;
  if (rules.stage?.length && !rules.stage.includes(contact.stage)) return false;
  if (rules.gender?.length) {
    const g = String(contact.fields?.genero ?? "");
    if (!rules.gender.includes(g)) return false;
  }
  if (rules.birthday_month) {
    if (!contact.birth_date) return false;
    const month = Number(contact.birth_date.slice(5, 7));
    if (month !== new Date(now).getMonth() + 1) return false;
  }
  if (rules.has_giftback) {
    const ok = coupons.some(
      (c) => c.contact_id === contact.id && c.kind === "giftback" && c.status === "ativo" &&
        (!c.expires_at || new Date(c.expires_at).getTime() > now),
    );
    if (!ok) return false;
  }
  if (rules.no_purchase && m.purchases > 0) return false;
  return true;
}

export function segmentMembers(
  segment: Pick<Segment, "rules">,
  contacts: Contact[],
  metrics: Map<string, ContactMetrics>,
  coupons: Coupon[],
): Contact[] {
  return contacts.filter((c) => matchesSegment(c, segment.rules, metrics, coupons));
}

/** Sugestões prontas, na linguagem da loja. */
export const SEGMENT_PRESETS: Array<Pick<Segment, "name" | "description" | "rules">> = [
  { name: "Clientes campeões", description: "Compram há pouco, com frequência e gastam mais.", rules: { rfm: ["campeoes"] } },
  { name: "Clientes ativos", description: "Compraram nos últimos 60 dias.", rules: { last_purchase_days: { max: 60 } } },
  { name: "Clientes inativos", description: "Sem compra há mais de 90 dias.", rules: { last_purchase_days: { min: 90 } } },
  { name: "Em risco", description: "Já compraram bastante e estão sumindo.", rules: { rfm: ["em_risco", "atencao"] } },
  { name: "Com giftback ativo", description: "Têm crédito para usar na loja.", rules: { has_giftback: true } },
  { name: "Aniversariantes do mês", description: "Fazem aniversário este mês.", rules: { birthday_month: true } },
  { name: "Nunca compraram", description: "Leads que ainda não viraram clientes.", rules: { no_purchase: true } },
];

// ── CSV ─────────────────────────────────────────────────────────────────────

/** Separador por vírgula ou ponto e vírgula, aspas simples de planilha. */
export function parseCsv(text: string): string[][] {
  const sep = (text.split("\n")[0]?.match(/;/g)?.length ?? 0) > (text.split("\n")[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(";")).join("\r\n");
}

export function downloadText(filename: string, content: string) {
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** "12/03/2026", "2026-03-12", "12/03/26" → ISO; senão null. */
export function parseDateLoose(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).toISOString();
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(y, Number(m[2]) - 1, Number(m[1]), 12).toISOString();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function parseMoney(raw: string): number {
  const s = raw.replace(/[R$\s]/g, "");
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

/** Texto do giftback com os placeholders da configuração. */
export function renderGiftback(template: string, coupon: Coupon, contact: Contact | undefined): string {
  const nome = firstNameForMessage(contact?.name);
  const validade = coupon.expires_at ? new Date(coupon.expires_at).toLocaleDateString("pt-BR") : "—";
  return template
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, nome)
    .replace(/\{\{\s*nome\s*\}\}/gi, contact?.name ?? "")
    .replace(/\{\{\s*codigo\s*\}\}/gi, coupon.code)
    .replace(/\{\{\s*valor\s*\}\}/gi, coupon.discount_type === "percent" ? `${coupon.value}%` : money(coupon.value))
    .replace(/\{\{\s*validade\s*\}\}/gi, validade)
    .replace(/\s{2,}/g, " ")
    .trim();
}

import { useMemo, useState } from "react";
import { Download, Filter, Megaphone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactsQuery, useSalesQuery, useCouponsQuery, useSegmentsQuery, useSaveSegmentMutation,
  useDeleteSegmentMutation, useContactTagsQuery, usePipelineStagesQuery,
} from "@/hooks/queries";
import { RFM_SEGMENTS, SEGMENT_PRESETS, computeMetrics, downloadText, metricsFor, money, segmentMembers, toCsv } from "@/lib/retail";
import { contactLabel, formatPhone, type Segment, type SegmentRules } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Draft = { id: string | null; name: string; description: string; rules: SegmentRules };

function Range({ label, value, onChange, unit }: { label: string; value?: { min?: number | null; max?: number | null }; onChange: (v: { min?: number | null; max?: number | null } | undefined) => void; unit?: string }) {
  const set = (k: "min" | "max", raw: string) => {
    const n = raw === "" ? null : Number(raw);
    const next = { ...(value ?? {}), [k]: n };
    onChange(next.min == null && next.max == null ? undefined : next);
  };
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Input type="number" min={0} placeholder="mín" value={value?.min ?? ""} onChange={(e) => set("min", e.target.value)} />
        <span className="text-xs text-muted-foreground">a</span>
        <Input type="number" min={0} placeholder="máx" value={value?.max ?? ""} onChange={(e) => set("max", e.target.value)} />
        {unit && <span className="shrink-0 text-xs text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

export default function Segmentos() {
  const { company } = useAuth();
  const navigate = useNavigate();
  const { data: segments = [] } = useSegmentsQuery(company?.id);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const { data: sales = [] } = useSalesQuery(company?.id);
  const { data: coupons = [] } = useCouponsQuery(company?.id);
  const { data: tags = [] } = useContactTagsQuery(company?.id);
  const { data: stages = [] } = usePipelineStagesQuery(company?.id);
  const save = useSaveSegmentMutation();
  const remove = useDeleteSegmentMutation();

  const metrics = useMemo(() => computeMetrics(sales), [sales]);
  const [draft, setDraft] = useState<Draft | null>(null);

  const countOf = (rules: SegmentRules) => segmentMembers({ rules }, contacts, metrics, coupons).length;
  const previewMembers = useMemo(
    () => (draft ? segmentMembers({ rules: draft.rules }, contacts, metrics, coupons) : []),
    [draft, contacts, metrics, coupons],
  );

  const openNew = (preset?: Pick<Segment, "name" | "description" | "rules">) =>
    setDraft({ id: null, name: preset?.name ?? "", description: preset?.description ?? "", rules: preset?.rules ?? {} });

  const handleSave = async () => {
    if (!company || !draft || !draft.name.trim()) return void toast.error("Dê um nome ao segmento.");
    try {
      await save.mutateAsync({ id: draft.id, company_id: company.id, name: draft.name.trim(), description: draft.description.trim() || null, rules: draft.rules, position: segments.length + 1 });
      toast.success("Segmento salvo.");
      setDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const handleRemove = async (s: Segment) => {
    if (!company || !window.confirm(`Excluir "${s.name}"?`)) return;
    await remove.mutateAsync({ id: s.id, company_id: company.id });
  };

  const exportCsv = (s: Segment) => {
    const members = segmentMembers(s, contacts, metrics, coupons);
    const rows = [["Nome", "Telefone", "E-mail", "Compras", "Total gasto", "Última compra", "Perfil"]];
    for (const c of members) {
      const m = metricsFor(metrics, c.id);
      rows.push([contactLabel(c), formatPhone(c.phone) ?? "", c.email ?? "", String(m.purchases), m.spent.toFixed(2).replace(".", ","), m.lastPurchaseAt ? new Date(m.lastPurchaseAt).toLocaleDateString("pt-BR") : "", RFM_SEGMENTS.find((r) => r.id === m.segment)?.label ?? ""]);
    }
    downloadText(`${s.name.toLowerCase().replace(/\s+/g, "-")}.csv`, toCsv(rows));
  };

  const r = draft?.rules ?? {};
  const setRules = (patch: Partial<SegmentRules>) => setDraft((d) => d && { ...d, rules: { ...d.rules, ...patch } });
  const toggleIn = (key: "rfm" | "tags" | "stage" | "gender", value: string) => {
    const cur = (r[key] as string[] | undefined) ?? [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    setRules({ [key]: next.length ? next : undefined } as Partial<SegmentRules>);
  };

  return (
    <div>
      <PageHeader
        icon={Filter}
        title="Segmentos"
        description="Recortes salvos da base: quem compra, quem sumiu, quem tem crédito. Cada um vira público de Disparos."
        actions={<Button onClick={() => openNew()}><Plus />Novo segmento</Button>}
      />

      {segments.length === 0 ? (
        <EmptyState icon={Filter} title="Nenhum segmento salvo" description="Comece por uma sugestão abaixo ou monte o seu." className="mb-6" />
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {segments.map((s) => (
            <div key={s.id} className="group flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="min-w-0 text-left" onClick={() => setDraft({ id: s.id, name: s.name, description: s.description ?? "", rules: s.rules })}>
                  <span className="block font-semibold">{s.name}</span>
                  {s.description && <span className="block text-xs text-muted-foreground">{s.description}</span>}
                </button>
                <span className="tabular shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{countOf(s.rules)}</span>
              </div>
              <div className="mt-auto flex flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={() => navigate(`/disparos?segmento=${s.id}`)}><Megaphone />Disparar</Button>
                <Button size="sm" variant="ghost" onClick={() => exportCsv(s)}><Download />CSV</Button>
                <Button size="icon-sm" variant="ghost" aria-label="Excluir" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => void handleRemove(s)}><Trash2 /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mb-2 text-sm font-semibold">Sugestões prontas</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SEGMENT_PRESETS.map((p) => (
          <button key={p.name} type="button" onClick={() => openNew(p)} className="flex flex-col gap-1 rounded-xl border border-dashed border-border bg-card/50 p-4 text-left transition-colors hover:border-primary/40 hover:bg-card">
            <span className="flex items-center justify-between gap-2">
              <span className="font-medium">{p.name}</span>
              <span className="tabular text-xs text-muted-foreground">{countOf(p.rules)} contatos</span>
            </span>
            <span className="text-xs text-muted-foreground">{p.description}</span>
          </button>
        ))}
      </div>

      <Dialog open={!!draft} onOpenChange={(v) => !v && setDraft(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Editar segmento" : "Novo segmento"}</DialogTitle>
            <DialogDescription>Combine regras. Um contato entra quando atende a todas.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Nome</Label><Input value={draft.name} onChange={(e) => setDraft((d) => d && { ...d, name: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Descrição</Label><Input value={draft.description} onChange={(e) => setDraft((d) => d && { ...d, description: e.target.value })} /></div>
              </div>

              <div className="space-y-1.5">
                <Label>Perfil RFM</Label>
                <div className="flex flex-wrap gap-1.5">
                  {RFM_SEGMENTS.filter((s) => s.id !== "sem_compra").map((s) => (
                    <button key={s.id} type="button" onClick={() => toggleIn("rfm", s.id)} className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${r.rfm?.includes(s.id) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>{s.label}</button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Range label="Última compra" unit="dias" value={r.last_purchase_days} onChange={(v) => setRules({ last_purchase_days: v })} />
                <Range label="Nº de compras" value={r.purchases} onChange={(v) => setRules({ purchases: v })} />
                <Range label="Total gasto" unit="R$" value={r.spent} onChange={(v) => setRules({ spent: v })} />
              </div>

              {tags.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Etiquetas (qualquer uma)</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => (
                      <button key={t.id} type="button" onClick={() => toggleIn("tags", t.name)} className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${r.tags?.includes(t.name) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>{t.name}</button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Etapa do funil</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {stages.map((s) => (
                      <button key={s.key} type="button" onClick={() => toggleIn("stage", s.key)} className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${r.stage?.includes(s.key) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>{s.name}</button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Gênero</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {["Feminino", "Masculino", "Outro"].map((g) => (
                      <button key={g} type="button" onClick={() => toggleIn("gender", g)} className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${r.gender?.includes(g) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>{g}</button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex cursor-pointer items-center gap-2"><Checkbox checked={!!r.birthday_month} onCheckedChange={(v) => setRules({ birthday_month: v === true || undefined })} />Aniversariantes do mês</label>
                <label className="flex cursor-pointer items-center gap-2"><Checkbox checked={!!r.has_giftback} onCheckedChange={(v) => setRules({ has_giftback: v === true || undefined })} />Com giftback ativo</label>
                <label className="flex cursor-pointer items-center gap-2"><Checkbox checked={!!r.no_purchase} onCheckedChange={(v) => setRules({ no_purchase: v === true || undefined })} />Nunca compraram</label>
              </div>

              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <span className="font-semibold">{previewMembers.length}</span> {previewMembers.length === 1 ? "contato entra" : "contatos entram"} neste segmento
                {previewMembers.length > 0 && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {previewMembers.slice(0, 5).map((c) => contactLabel(c)).join(", ")}{previewMembers.length > 5 ? "…" : ""}
                    {" · "}gasto total {money(previewMembers.reduce((a, c) => a + metricsFor(metrics, c.id).spent, 0))}
                  </span>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancelar</Button>
            <Button onClick={() => void handleSave()} disabled={save.isPending}>Salvar segmento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useState } from "react";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactFieldsQuery,
  useRecordTypesQuery,
  useDateRulesQuery,
  useSaveDateRuleMutation,
  useDeleteRelationshipRuleMutation,
} from "@/hooks/queries";
import type { RelationshipRule } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Draft = {
  id: string | null;
  title: string;
  field_key: string;
  /** Sempre positivo no formulário; `when` dá o sinal. */
  days: number;
  when: "antes" | "no_dia" | "depois";
  message: string;
  cooldown: number;
  enabled: boolean;
};

const NOVA: Omit<Draft, "id" | "field_key"> = {
  title: "",
  days: 7,
  when: "antes",
  message: "Oi {{primeiro_nome}}! Passando para lembrar da data {{data}}. Qualquer dúvida, é só responder aqui.",
  cooldown: 30,
  enabled: false,
};

function toDraft(rule: RelationshipRule): Draft {
  const off = rule.offset_days ?? 0;
  return {
    id: rule.id,
    title: rule.title ?? "",
    field_key: rule.field_key ?? "",
    days: Math.abs(off),
    when: off < 0 ? "antes" : off > 0 ? "depois" : "no_dia",
    message: rule.message,
    cooldown: rule.cooldown_days,
    enabled: rule.enabled,
  };
}

/** "7 dias antes de Vencimento da apólice" — a régua explicada numa linha. */
function describe(d: Draft, fieldLabel: string | undefined): string {
  const campo = fieldLabel ?? "campo";
  if (d.when === "no_dia") return `No dia de ${campo}`;
  return `${d.days} ${d.days === 1 ? "dia" : "dias"} ${d.when} de ${campo}`;
}

/**
 * Réguas que disparam a partir de um campo de data do contato: renovação,
 * retorno, cobrança, pós-evento. O nicho sugere as suas (desligadas); a
 * empresa ajusta a mensagem e liga, ou cria outras sobre qualquer campo de data.
 */
export default function DateRulesSettings() {
  const { company } = useAuth();
  const { data: rules = [] } = useDateRulesQuery(company?.id);
  const { data: fields = [] } = useContactFieldsQuery(company?.id);
  const { data: recordTypes = [] } = useRecordTypesQuery(company?.id);
  const save = useSaveDateRuleMutation();
  const remove = useDeleteRelationshipRuleMutation();

  // Gatilhos possíveis: campos de data do contato e a data principal de cada
  // tipo de registro ("Apólice · Vencimento" vira record:apolice).
  const dateOptions = [
    ...fields.filter((f) => f.type === "date").map((f) => ({ value: f.key, label: f.label })),
    ...recordTypes
      .filter((t) => t.date_field_key)
      .map((t) => ({
        value: `record:${t.key}`,
        label: `${t.label} · ${t.fields.find((f) => f.key === t.date_field_key)?.label ?? "data"}`,
      })),
  ];
  const labelOf = (key: string) => dateOptions.find((o) => o.value === key)?.label;

  const [drafts, setDrafts] = useState<Draft[]>([]);

  // O formulário espelha o que está gravado; uma régua nova (sem id) fica no
  // fim até ser salva.
  useEffect(() => {
    setDrafts((prev) => {
      const saved = rules.map(toDraft);
      const pendentes = prev.filter((d) => d.id === null);
      return [...saved, ...pendentes];
    });
  }, [rules]);

  const patch = (index: number, values: Partial<Draft>) =>
    setDrafts((p) => p.map((d, i) => (i === index ? { ...d, ...values } : d)));

  const add = () => {
    if (dateOptions.length === 0) return;
    setDrafts((p) => [...p, { ...NOVA, id: null, field_key: dateOptions[0].value }]);
  };

  const handleSave = async (d: Draft, override?: Partial<Draft>) => {
    if (!company) return;
    const final = { ...d, ...override };
    if (!final.field_key) {
      toast.error("Escolha o campo de data.");
      return;
    }
    if (!final.message.trim()) {
      toast.error("Escreva a mensagem.");
      return;
    }
    const offset = final.when === "antes" ? -Math.abs(final.days) : final.when === "depois" ? Math.abs(final.days) : 0;
    try {
      await save.mutateAsync({
        id: final.id,
        company_id: company.id,
        title: final.title.trim() || describe(final, labelOf(final.field_key)),
        field_key: final.field_key,
        offset_days: offset,
        message: final.message.trim(),
        cooldown_days: Math.max(1, final.cooldown),
        enabled: final.enabled,
      });
      toast.success(final.enabled ? "Régua ligada." : "Régua salva.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar régua");
    }
  };

  const handleRemove = async (d: Draft, index: number) => {
    if (d.id === null) {
      setDrafts((p) => p.filter((_, i) => i !== index));
      return;
    }
    if (!company || !window.confirm(`Excluir a régua "${d.title || describe(d, labelOf(d.field_key))}"?`)) return;
    try {
      await remove.mutateAsync({ id: d.id, company_id: company.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir régua");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          Réguas por data
          {rules.some((r) => r.enabled) && (
            <Badge variant="success">{rules.filter((r) => r.enabled).length} ativas</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Disparam N dias antes ou depois de um campo de data do contato: vencimento, retorno,
          data do evento. O nicho sugere as suas; você pode criar outras.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {dateOptions.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            Nenhum campo de data no contato. Crie um em Contatos → Campos (tipo "Data") para usar
            réguas por data.
          </p>
        ) : (
          <>
            {drafts.map((d, index) => (
              <div key={d.id ?? `nova-${index}`} className="space-y-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={d.enabled}
                      onCheckedChange={(v) => {
                        const ligando = v === true;
                        patch(index, { enabled: ligando });
                        // Desligar salva na hora, como nas outras réguas.
                        if (!ligando && d.id) void handleSave(d, { enabled: false });
                      }}
                    />
                    <span className="font-medium">{d.title || describe(d, labelOf(d.field_key))}</span>
                  </label>
                  {d.id === null && <Badge variant="outline">não salva</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {describe(d, labelOf(d.field_key))}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Excluir régua"
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void handleRemove(d, index)}
                  >
                    <Trash2 />
                  </Button>
                </div>

                {(d.enabled || d.id === null) && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Nome da régua</Label>
                        <Input
                          placeholder="Ex: Renovação em 30 dias"
                          value={d.title}
                          onChange={(e) => patch(index, { title: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Campo de data</Label>
                        <Select value={d.field_key} onValueChange={(v) => patch(index, { field_key: v })}>
                          <SelectTrigger>
                            <SelectValue placeholder="Escolha o campo" />
                          </SelectTrigger>
                          <SelectContent>
                            {dateOptions.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>Quando</Label>
                        <Select value={d.when} onValueChange={(v) => patch(index, { when: v as Draft["when"] })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="antes">Dias antes</SelectItem>
                            <SelectItem value="no_dia">No dia</SelectItem>
                            <SelectItem value="depois">Dias depois</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {d.when !== "no_dia" && (
                        <div className="space-y-1.5">
                          <Label>Dias</Label>
                          <Input
                            type="number"
                            min={1}
                            value={d.days}
                            onChange={(e) => patch(index, { days: Math.max(1, Number(e.target.value)) })}
                          />
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label>Não repetir por (dias)</Label>
                        <Input
                          type="number"
                          min={1}
                          value={d.cooldown}
                          onChange={(e) => patch(index, { cooldown: Number(e.target.value) })}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Mensagem</Label>
                      <Textarea
                        rows={3}
                        value={d.message}
                        onChange={(e) => patch(index, { message: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Use <span className="font-mono">{"{{primeiro_nome}}"}</span>,{" "}
                        <span className="font-mono">{"{{nome}}"}</span>,{" "}
                        <span className="font-mono">{"{{data}}"}</span> (a data do campo),{" "}
                        <span className="font-mono">{"{{dias}}"}</span> e, em registros,{" "}
                        <span className="font-mono">{"{{titulo}}"}</span>.
                      </p>
                    </div>

                    <Button onClick={() => void handleSave(d)} disabled={save.isPending}>
                      {save.isPending ? "Salvando..." : d.enabled ? "Salvar e ligar" : "Salvar"}
                    </Button>
                  </>
                )}
              </div>
            ))}

            <Button variant="outline" onClick={add}>
              <Plus />
              Nova régua por data
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

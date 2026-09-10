import { useEffect, useState } from "react";
import { Cake, HeartHandshake, Star } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useRelationshipRulesQuery,
  useSaveRelationshipRuleMutation,
  useRelationshipLogsQuery,
} from "@/hooks/queries";
import type { RelationshipKind } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * As três réguas.
 *
 * Cada uma tem um gatilho diferente e um campo de ajuste só seu, então elas
 * moram no mesmo formulário mas se salvam separado: mexer no aniversário não
 * pode obrigar a revisar a reativação.
 */
const RULES: Array<{
  kind: RelationshipKind;
  titulo: string;
  descricao: string;
  icone: typeof Cake;
  padrao: string;
  campo?: { chave: "inactive_days" | "ask_after_days"; label: string; hint: string };
}> = [
  {
    kind: "aniversario",
    titulo: "Aniversário",
    descricao: "Mensagem no dia, para quem tem a data preenchida na ficha",
    icone: Cake,
    padrao:
      "Feliz aniversário, {{primeiro_nome}}! 🎉 Passando para desejar um dia ótimo — e um mimo separado para você aqui na loja.",
  },
  {
    kind: "reativacao",
    titulo: "Reativação",
    descricao: "Para quem não fala com a empresa há um tempo",
    icone: HeartHandshake,
    padrao:
      "Oi {{primeiro_nome}}! Faz um tempo que a gente não se fala. Chegaram novidades que combinam com você — quer dar uma olhada?",
    campo: {
      chave: "inactive_days",
      label: "Dias sem interação",
      hint: "Conta a partir da última mensagem trocada, em qualquer sentido",
    },
  },
  {
    kind: "nps",
    titulo: "Pesquisa de satisfação (NPS)",
    descricao: "Pergunta a nota depois que o negócio é marcado como Ganho",
    icone: Star,
    padrao:
      "Oi {{primeiro_nome}}! De 0 a 10, o quanto você indicaria a gente para um amigo? Responda só com o número — leva um segundo. 🙏",
    campo: {
      chave: "ask_after_days",
      label: "Dias após fechar",
      hint: "Tempo entre o negócio ir para Ganho e a pergunta sair",
    },
  },
];

const KIND_LABEL: Record<string, string> = {
  aniversario: "Aniversário",
  reativacao: "Reativação",
  nps: "NPS",
};

export default function RelationshipSettings() {
  const { company } = useAuth();
  const { data: rules } = useRelationshipRulesQuery(company?.id);
  const { data: logs = [] } = useRelationshipLogsQuery(company?.id);
  const save = useSaveRelationshipRuleMutation();

  // Um rascunho por régua: o formulário é a régua gravada até alguém digitar.
  const [draft, setDraft] = useState<Record<string, {
    enabled: boolean;
    message: string;
    days: number;
    cooldown: number;
  }>>({});

  useEffect(() => {
    const next: typeof draft = {};
    for (const r of RULES) {
      const saved = rules?.get(r.kind);
      next[r.kind] = {
        enabled: saved?.enabled ?? false,
        message: saved?.message ?? r.padrao,
        days: r.campo?.chave === "ask_after_days"
          ? saved?.ask_after_days ?? 3
          : saved?.inactive_days ?? 60,
        cooldown: saved?.cooldown_days ?? 180,
      };
    }
    setDraft(next);
  }, [rules]);

  const handleSave = async (kind: RelationshipKind) => {
    if (!company) return;
    const rule = RULES.find((r) => r.kind === kind)!;
    const d = draft[kind];
    if (!d) return;
    if (d.enabled && !d.message.trim()) {
      toast.error("Escreva a mensagem antes de ligar a régua.");
      return;
    }
    try {
      await save.mutateAsync({
        company_id: company.id,
        kind,
        enabled: d.enabled,
        message: d.message.trim(),
        cooldown_days: d.cooldown,
        ...(rule.campo?.chave === "ask_after_days"
          ? { ask_after_days: d.days }
          : { inactive_days: d.days }),
      });
      toast.success(d.enabled ? `${rule.titulo}: régua ligada.` : `${rule.titulo}: régua salva.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  return (
    <div className="space-y-4">
      {RULES.map((rule) => {
        const d = draft[rule.kind];
        if (!d) return null;
        return (
          <Card key={rule.kind}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <rule.icone className="h-4 w-4 text-muted-foreground" />
                {rule.titulo}
                {rules?.get(rule.kind)?.enabled && <Badge variant="success">Ativa</Badge>}
              </CardTitle>
              <CardDescription>{rule.descricao}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={d.enabled}
                  onCheckedChange={(v) =>
                    setDraft((p) => ({ ...p, [rule.kind]: { ...d, enabled: v === true } }))
                  }
                />
                Ligar esta régua
              </label>

              <div className="space-y-1.5">
                <Label>Mensagem</Label>
                <Textarea
                  rows={3}
                  value={d.message}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, [rule.kind]: { ...d, message: e.target.value } }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Use <span className="font-mono">{"{{primeiro_nome}}"}</span> ou{" "}
                  <span className="font-mono">{"{{nome}}"}</span>.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {rule.campo && (
                  <div className="space-y-1.5">
                    <Label>{rule.campo.label}</Label>
                    <Input
                      type="number"
                      min={1}
                      value={d.days}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          [rule.kind]: { ...d, days: Number(e.target.value) },
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">{rule.campo.hint}</p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Não repetir por (dias)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={d.cooldown}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        [rule.kind]: { ...d, cooldown: Number(e.target.value) },
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Impede o mesmo contato de receber esta régua de novo cedo demais
                  </p>
                </div>
              </div>

              <Button onClick={() => void handleSave(rule.kind)} disabled={save.isPending}>
                {save.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Últimos envios</CardTitle>
          <CardDescription>
            As réguas rodam uma vez por dia, e só entre 9h e 20h — "parabéns" às 3 da manhã é o tipo
            de automação que faz o cliente pedir para sair da lista.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Nada enviado ainda.
            </p>
          ) : (
            <div className="space-y-1.5">
              {logs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 rounded-lg border p-2.5 text-sm">
                  <Badge variant={log.status === "sent" ? "secondary" : "outline"}>
                    {KIND_LABEL[log.kind] ?? log.kind}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {log.contacts?.name ?? log.contacts?.phone ?? "contato"}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {log.error ?? log.content}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-[11px] text-muted-foreground">
                    {new Date(log.created_at).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

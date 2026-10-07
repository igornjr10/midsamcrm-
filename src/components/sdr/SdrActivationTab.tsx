import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useContactTagsQuery, useContactsQuery, usePipelineStagesQuery } from "@/hooks/queries";
import { LEAD_SOURCES, contactLabel } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { parsePhrases, type SdrDraft, type UpdateDraft } from "./sdrDraft";

/** Caixa de opção grande, igual às que a página já usava. */
export function OptionCard({
  checked,
  onChange,
  title,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  children?: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors",
        checked ? "border-primary/40 bg-primary/5" : "hover:bg-accent/50",
      )}
    >
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        {children && <div className="mt-0.5 text-xs text-muted-foreground">{children}</div>}
      </div>
    </label>
  );
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function SdrActivationTab({
  draft,
  update,
  activatedAt,
}: {
  draft: SdrDraft;
  update: UpdateDraft;
  /** activated_at salvo; com o SDR ainda desligado, a ativação seria agora. */
  activatedAt: string | null;
}) {
  const { data: tags = [] } = useContactTagsQuery(useAuth().company?.id);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Quem o SDR atende</CardTitle>
          <CardDescription>
            Estas regras decidem quem o SDR <strong>começa</strong> a atender. Depois que um lead entra no
            atendimento, a conversa continua normalmente — mesmo que ele deixe de ser "novo". Só as etiquetas
            excluídas e a pausa da IA continuam valendo durante a conversa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <OptionCard checked={draft.enabled} onChange={(v) => update({ enabled: v })} title="Ligar SDR IA">
            Responder leads automaticamente no WhatsApp, seguindo as regras abaixo.
          </OptionCard>

          <OptionCard
            checked={draft.onlyNewLeads}
            onChange={(v) => update({ onlyNewLeads: v })}
            title="Atender somente leads novos"
          >
            Lead novo é o contato <strong>sem nenhuma conversa anterior à ativação do SDR</strong>. Quem já
            tinha conversado com a empresa antes de você ligar o SDR fica com a equipe.
            {activatedAt && (
              <> Ativação atual: {new Date(activatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.</>
            )}
          </OptionCard>

          <OptionCard
            checked={draft.onlyOpenStages}
            onChange={(v) => update({ onlyOpenStages: v })}
            title="Não falar com negócio já fechado"
          >
            Contatos em etapa de Ganho ou Perdido ficam fora, inclusive quando o próprio funil moveu o contato
            depois do pagamento.
          </OptionCard>

          <div className="space-y-1.5 rounded-lg border p-3.5">
            <Label htmlFor="sdr-phrases">Ativar só com uma mensagem específica (opcional)</Label>
            <Textarea
              id="sdr-phrases"
              rows={3}
              placeholder={"Quero saber mais\nVi o anúncio\nPacotes gestante"}
              value={draft.triggerPhrases}
              onChange={(e) => update({ triggerPhrases: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Uma frase por linha. O SDR só começa quando a mensagem do lead contém uma delas (sem diferenciar
              maiúsculas e acentos). Em branco, qualquer mensagem serve.
            </p>
          </div>

          <div className="space-y-2 rounded-lg border p-3.5">
            <p className="text-sm font-medium">Atender só leads destas origens (opcional)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {LEAD_SOURCES.map((s) => (
                <label key={s.key} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.allowedSources.includes(s.key)}
                    onCheckedChange={() => update({ allowedSources: toggle(draft.allowedSources, s.key) })}
                  />
                  {s.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Nenhuma marcada = todas as origens. Ex.: marque só "Anúncio (Meta)" para o SDR atender quem veio dos
              anúncios.
            </p>
          </div>

          <div className="space-y-2 rounded-lg border p-3.5">
            <p className="text-sm font-medium">Nunca atender contatos com estas etiquetas</p>
            {tags.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Crie etiquetas em Contatos › Etiquetas (ex.: Cliente, Equipe, Em atendimento) para poder excluí-las.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {tags.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={draft.excludedTags.includes(t.name)}
                      onCheckedChange={() => update({ excludedTags: toggle(draft.excludedTags, t.name) })}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Vale sempre, inclusive no meio de uma conversa e no follow-up. Para pessoas específicas, use a
              etiqueta ou o botão "Pausar IA" no Chat.
            </p>
          </div>
        </CardContent>
      </Card>

      <EligibilityPreview draft={draft} activatedAt={activatedAt} />
    </div>
  );
}

type Reason = "atende" | "seguindo" | "pausado" | "etiqueta" | "fechado" | "historico" | "origem" | "frase";

const REASON_LABEL: Record<Reason, string> = {
  atende: "Seriam atendidos na próxima mensagem",
  seguindo: "Já em atendimento pelo SDR (a conversa segue)",
  frase: "Só se mandarem a frase de ativação",
  pausado: "IA pausada nesta conversa",
  etiqueta: "Têm etiqueta excluída",
  fechado: "Negócio já fechado (Ganho/Perdido)",
  historico: "Já conversavam antes da ativação",
  origem: "Origem fora das escolhidas",
};

/**
 * Quem seria atendido hoje, com as regras da tela (salvas ou não). Segue a
 * mesma ordem do webhook (sdrEligible), para a prévia não prometer o que ele
 * não faz.
 */
function EligibilityPreview({ draft, activatedAt }: { draft: SdrDraft; activatedAt: string | null }) {
  const { company } = useAuth();
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const { data: stages = [] } = usePipelineStagesQuery(company?.id);
  const { data: firstAt } = useQuery({
    queryKey: ["contact-first-message", company?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("contact_first_message_at", { p_company_id: company!.id });
      if (error) throw error;
      return new Map(((data ?? []) as Array<{ contact_id: string; first_at: string }>).map((r) => [r.contact_id, r.first_at]));
    },
    enabled: !!company?.id,
    staleTime: 60_000,
  });

  const groups = useMemo(() => {
    const closed = new Set(stages.filter((s) => s.kind !== "open").map((s) => s.key));
    const excluded = draft.excludedTags.map((t) => t.toLowerCase());
    const phrases = parsePhrases(draft.triggerPhrases);
    // SDR desligado: ligar agora faria de agora a data de ativação.
    const cutoff = activatedAt && draft.enabled ? Date.parse(activatedAt) : Date.now();
    const out = new Map<Reason, string[]>();

    for (const c of contacts) {
      let reason: Reason;
      if (c.ai_paused) reason = "pausado";
      else if (excluded.length && (c.tags ?? []).some((t) => excluded.includes(t.toLowerCase()))) reason = "etiqueta";
      else if (draft.onlyOpenStages && closed.has(c.stage)) reason = "fechado";
      else if (c.sdr_engaged_at) reason = "seguindo";
      else if (draft.onlyNewLeads && firstAt?.get(c.id) && Date.parse(firstAt.get(c.id)!) < cutoff) reason = "historico";
      else if (draft.allowedSources.length && !draft.allowedSources.includes(c.source ?? "")) reason = "origem";
      else if (phrases.length) reason = "frase";
      else reason = "atende";
      const list = out.get(reason) ?? [];
      list.push(contactLabel(c));
      out.set(reason, list);
    }
    return out;
  }, [contacts, stages, firstAt, draft, activatedAt]);

  const order: Reason[] = ["atende", "seguindo", "frase", "pausado", "etiqueta", "fechado", "historico", "origem"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Prévia: quem seria atendido
        </CardTitle>
        <CardDescription>
          Com as regras desta tela, aplicadas aos {contacts.length} contatos de hoje. Lead que chegar depois segue
          as mesmas regras.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {order
          .filter((r) => groups.get(r)?.length)
          .map((r) => {
            const names = groups.get(r)!;
            const good = r === "atende" || r === "seguindo";
            return (
              <div key={r} className="rounded-lg border p-3">
                <p className="flex items-baseline justify-between gap-3 text-sm">
                  <span className={good ? "font-medium text-foreground" : "text-muted-foreground"}>{REASON_LABEL[r]}</span>
                  <span className={cn("tabular font-semibold", good ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                    {names.length}
                  </span>
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {names.slice(0, 6).join(", ")}
                  {names.length > 6 ? ` e mais ${names.length - 6}` : ""}
                </p>
              </div>
            );
          })}
        {contacts.length === 0 && <p className="text-sm text-muted-foreground">Nenhum contato ainda.</p>}
      </CardContent>
    </Card>
  );
}

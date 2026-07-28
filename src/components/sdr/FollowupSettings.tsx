import { useEffect, useState } from "react";
import { Clock, Loader2, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useAiConfigQuery,
  useFollowupStepsQuery,
  useRunFollowupMutation,
  useSaveAiConfigMutation,
  useSaveFollowupStepsMutation,
  useWhatsappTemplatesQuery,
} from "@/hooks/queries";
import type { AiConfig, FollowupStep, FollowupStepDraft } from "@/lib/types";
import FollowupStepCard from "@/components/sdr/FollowupStepCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Belem",
  "America/Cuiaba",
  "America/Rio_Branco",
  "America/Fortaleza",
];

const HOURS = Array.from({ length: 25 }, (_, i) => i);

const NEW_STEP: FollowupStepDraft = {
  delay_hours: 24,
  kind: "text",
  message: "",
  template_name: null,
  template_language: "pt_BR",
  template_body: null,
  variable_map: {},
  active: true,
};

function toDraft(step: FollowupStep): FollowupStepDraft {
  return {
    delay_hours: Number(step.delay_hours),
    kind: step.kind,
    message: step.message,
    template_name: step.template_name,
    template_language: step.template_language,
    template_body: step.template_body,
    variable_map: step.variable_map ?? {},
    active: step.active,
  };
}

/** Valores de follow-up de uma empresa que ainda não salvou nada. */
const DEFAULTS: Pick<
  AiConfig,
  | "followup_enabled"
  | "followup_timezone"
  | "followup_window_start"
  | "followup_window_end"
  | "followup_skip_weekends"
  | "followup_only_open_stages"
> = {
  followup_enabled: false,
  followup_timezone: "America/Sao_Paulo",
  followup_window_start: 9,
  followup_window_end: 20,
  followup_skip_weekends: true,
  followup_only_open_stages: true,
};

export default function FollowupSettings() {
  const { company } = useAuth();
  const { data: config, isPending: configLoading } = useAiConfigQuery(company?.id);
  const { data: savedSteps = [], isPending: stepsLoading } = useFollowupStepsQuery(company?.id);
  const { data: templates = [], isPending: templatesLoading } = useWhatsappTemplatesQuery(company?.id);
  const saveConfig = useSaveAiConfigMutation();
  const saveSteps = useSaveFollowupStepsMutation();
  const runNow = useRunFollowupMutation();

  const [enabled, setEnabled] = useState(DEFAULTS.followup_enabled);
  const [timezone, setTimezone] = useState(DEFAULTS.followup_timezone);
  const [windowStart, setWindowStart] = useState(DEFAULTS.followup_window_start);
  const [windowEnd, setWindowEnd] = useState(DEFAULTS.followup_window_end);
  const [skipWeekends, setSkipWeekends] = useState(DEFAULTS.followup_skip_weekends);
  const [onlyOpenStages, setOnlyOpenStages] = useState(DEFAULTS.followup_only_open_stages);
  const [steps, setSteps] = useState<FollowupStepDraft[]>([]);

  useEffect(() => {
    if (!config) return;
    setEnabled(config.followup_enabled ?? DEFAULTS.followup_enabled);
    setTimezone(config.followup_timezone ?? DEFAULTS.followup_timezone);
    setWindowStart(config.followup_window_start ?? DEFAULTS.followup_window_start);
    setWindowEnd(config.followup_window_end ?? DEFAULTS.followup_window_end);
    setSkipWeekends(config.followup_skip_weekends ?? DEFAULTS.followup_skip_weekends);
    setOnlyOpenStages(config.followup_only_open_stages ?? DEFAULTS.followup_only_open_stages);
  }, [config]);

  useEffect(() => {
    setSteps(savedSteps.map(toDraft));
  }, [savedSteps]);

  const updateStep = (index: number, next: FollowupStepDraft) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? next : s)));
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    setSteps((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    if (!company) return;

    if (windowEnd <= windowStart) {
      toast.error("O fim da janela de envio precisa ser depois do início.");
      return;
    }
    const invalid = steps.findIndex((s) =>
      s.kind === "template" ? !s.template_name : !(s.message ?? "").trim(),
    );
    if (invalid >= 0) {
      toast.error(
        `Passo ${invalid + 1}: ${
          steps[invalid].kind === "template"
            ? "escolha um template aprovado."
            : "escreva a mensagem ou a instrução."
        }`,
      );
      return;
    }
    if (enabled && steps.filter((s) => s.active).length === 0) {
      toast.error("Adicione ao menos um passo ativo para ligar o follow-up.");
      return;
    }

    try {
      await Promise.all([
        saveConfig.mutateAsync({
          company_id: company.id,
          followup_enabled: enabled,
          followup_timezone: timezone,
          followup_window_start: windowStart,
          followup_window_end: windowEnd,
          followup_skip_weekends: skipWeekends,
          followup_only_open_stages: onlyOpenStages,
        }),
        saveSteps.mutateAsync({ companyId: company.id, steps }),
      ]);
      toast.success(enabled ? "Follow-up ligado e cadência salva." : "Cadência salva.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const handleRunNow = async () => {
    if (!company) return;
    try {
      const result = await runNow.mutateAsync(company.id);
      if (result.reason) {
        toast.info(`Nada enviado: ${result.reason}.`);
      } else if (result.sent === 0 && result.skipped === 0 && result.failed === 0) {
        toast.info("Nenhum contato estava no ponto de receber follow-up agora.");
      } else {
        toast.success(
          `Follow-up executado: ${result.sent} enviado(s), ${result.failed} com falha, ${result.skipped} pulado(s).`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao executar");
    }
  };

  const saving = saveConfig.isPending || saveSteps.isPending;

  if (configLoading || stepsLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Como o follow-up funciona</CardTitle>
          <CardDescription>
            Quando um contato para de responder, os passos abaixo são enviados na ordem, respeitando o
            tempo de espera de cada um. Se o contato responder, a cadência zera e recomeça do passo 1 na
            próxima vez que ele ficar em silêncio. Pausar a IA no Chat também pausa o follow-up daquele
            contato.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            <div>
              <p className="text-sm font-medium">Ligar follow-up automático</p>
              <p className="text-xs text-muted-foreground">
                Cobra automaticamente os leads que ficaram sem responder
              </p>
            </div>
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Fuso horário</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz.replace("America/", "").replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Enviar a partir das</Label>
              <Select value={String(windowStart)} onValueChange={(v) => setWindowStart(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.slice(0, 24).map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Até</Label>
              <Select value={String(windowEnd)} onValueChange={(v) => setWindowEnd(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.slice(1).map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={skipWeekends}
                onCheckedChange={(v) => setSkipWeekends(v === true)}
              />
              Não enviar aos sábados e domingos
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={onlyOpenStages}
                onCheckedChange={(v) => setOnlyOpenStages(v === true)}
              />
              Ignorar contatos em Ganho ou Perdido
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Cadência</CardTitle>
            <CardDescription>
              O tempo do passo 1 conta a partir da última mensagem da conversa; os demais contam a
              partir do passo anterior.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => setSteps((prev) => [...prev, { ...NEW_STEP }])}
          >
            <Plus className="h-4 w-4" />
            Passo
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {steps.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Clock className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
              <p className="font-medium">Nenhum passo configurado</p>
              <p className="text-sm text-muted-foreground">
                Comece com algo simples: uma mensagem 24h depois e um template 3 dias depois.
              </p>
            </div>
          ) : (
            steps.map((step, index) => (
              <FollowupStepCard
                key={index}
                index={index}
                total={steps.length}
                step={step}
                templates={templates}
                templatesLoading={templatesLoading}
                onChange={(next) => updateStep(index, next)}
                onMove={(direction) => moveStep(index, direction)}
                onRemove={() => setSteps((prev) => prev.filter((_, i) => i !== index))}
              />
            ))
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Salvando..." : "Salvar follow-up"}
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => void handleRunNow()}
              disabled={runNow.isPending}
            >
              {runNow.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Executar agora
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            "Executar agora" processa a fila na hora — útil para testar. Em produção, agende a function{" "}
            <span className="font-mono">sdr-followup</span> para rodar a cada 15 minutos.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

import { useMemo } from "react";
import { AlertCircle, ArrowDown, ArrowUp, Bot, FileText, MessageSquare, Trash2 } from "lucide-react";
import {
  bodyPlaceholders,
  defaultVariables,
  headerTextPlaceholders,
  templateBody,
  type WhatsappTemplate,
} from "@/lib/templates";
import type { FollowupKind, FollowupStepDraft, VariableSource } from "@/lib/types";
import VariableRow from "@/components/campaigns/VariableRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const KIND_OPTIONS: Array<{ value: FollowupKind; label: string; hint: string }> = [
  {
    value: "text",
    label: "Mensagem pronta",
    hint: "Envia exatamente o texto abaixo. Só funciona dentro das 24h da última resposta do contato.",
  },
  {
    value: "ai",
    label: "Escrita pela IA",
    hint: "O agente escreve na hora, com o histórico da conversa e a instrução abaixo. Também limitado às 24h.",
  },
  {
    value: "template",
    label: "Template aprovado",
    hint: "Único formato que reabre a conversa depois das 24h de silêncio.",
  },
];

const KIND_ICONS: Record<FollowupKind, typeof Bot> = {
  text: MessageSquare,
  ai: Bot,
  template: FileText,
};

/** "36" horas -> "1 dia e 12h", para dar noção do intervalo configurado. */
function humanDelay(hours: number): string {
  if (!hours || hours <= 0) return "imediato";
  if (hours < 24) return `${Number(hours.toFixed(2))}h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  const dayLabel = `${days} dia${days === 1 ? "" : "s"}`;
  return rest > 0 ? `${dayLabel} e ${rest}h` : dayLabel;
}

export default function FollowupStepCard({
  index,
  total,
  step,
  templates,
  templatesLoading,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  step: FollowupStepDraft;
  templates: WhatsappTemplate[];
  templatesLoading: boolean;
  onChange: (next: FollowupStepDraft) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const Icon = KIND_ICONS[step.kind];
  const kindHint = KIND_OPTIONS.find((k) => k.value === step.kind)?.hint ?? "";

  const template = useMemo(
    () => templates.find((t) => t.name === step.template_name),
    [templates, step.template_name],
  );

  const headerVars = step.variable_map.header ?? [];
  const bodyVars = step.variable_map.body ?? [];

  const setKind = (kind: FollowupKind) => {
    onChange({
      ...step,
      kind,
      // Campos do outro formato ficariam pendurados sem uso na cadência.
      ...(kind === "template"
        ? { message: null }
        : { template_name: null, template_body: null, variable_map: {} }),
    });
  };

  const setTemplate = (name: string) => {
    const chosen = templates.find((t) => t.name === name);
    if (!chosen) return;
    onChange({
      ...step,
      template_name: chosen.name,
      template_language: chosen.language,
      template_body: templateBody(chosen),
      variable_map: {
        header: defaultVariables(headerTextPlaceholders(chosen), false),
        body: defaultVariables(bodyPlaceholders(chosen), true),
      },
    });
  };

  const setVariable = (scope: "header" | "body", position: number, next: VariableSource) => {
    const current = step.variable_map[scope] ?? [];
    onChange({
      ...step,
      variable_map: {
        ...step.variable_map,
        [scope]: current.map((v, i) => (i === position ? next : v)),
      },
    });
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5">
            <Icon className="h-3.5 w-3.5" />
            Passo {index + 1}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {index === 0
              ? `${humanDelay(step.delay_hours)} após a última mensagem`
              : `${humanDelay(step.delay_hours)} após o passo ${index}`}
          </span>
          {!step.active && <Badge variant="outline">Desativado</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label="Subir passo"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label="Descer passo"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-destructive"
            onClick={onRemove}
            aria-label="Remover passo"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Esperar (horas)</Label>
          <Input
            type="number"
            min={0.25}
            step={0.25}
            value={step.delay_hours}
            onChange={(e) => onChange({ ...step, delay_hours: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Formato</Label>
          <Select value={step.kind} onValueChange={(v) => setKind(v as FollowupKind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{kindHint}</p>

      {step.kind === "template" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Template aprovado</Label>
            {templatesLoading ? (
              <p className="text-sm text-muted-foreground">Carregando templates da sua WABA...</p>
            ) : templates.length === 0 ? (
              <div className="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                Nenhum template aprovado disponível. Crie um no Gerenciador do WhatsApp para usar este
                formato.
              </div>
            ) : (
              <Select value={step.template_name ?? ""} onValueChange={setTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha um template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={`${t.name}-${t.language}`} value={t.name}>
                      {t.name} · {t.language}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {(headerVars.length > 0 || bodyVars.length > 0) && (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Variáveis do template</p>
              {headerVars.map((variable, i) => (
                <VariableRow
                  key={`header-${i}`}
                  index={i}
                  value={variable}
                  onChange={(next) => setVariable("header", i, next)}
                />
              ))}
              {headerVars.length > 0 && bodyVars.length > 0 && <Separator />}
              {bodyVars.map((variable, i) => (
                <VariableRow
                  key={`body-${i}`}
                  index={i}
                  value={variable}
                  onChange={(next) => setVariable("body", i, next)}
                />
              ))}
            </div>
          )}

          {template && (
            <p className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-sm">
              {templateBody(template)}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>{step.kind === "ai" ? "Instrução para a IA" : "Mensagem"}</Label>
          <Textarea
            rows={3}
            placeholder={
              step.kind === "ai"
                ? "Ex: retome o assunto do orçamento e pergunte se ele ainda tem interesse."
                : "Ex: Oi {{primeiro_nome}}, tudo certo? Consegui separar aquela condição que conversamos."
            }
            value={step.message ?? ""}
            onChange={(e) => onChange({ ...step, message: e.target.value })}
          />
          {step.kind === "text" && (
            <p className="text-xs text-muted-foreground">
              Use <span className="font-mono">{"{{primeiro_nome}}"}</span> ou{" "}
              <span className="font-mono">{"{{nome}}"}</span> para personalizar.
            </p>
          )}
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={step.active}
          onCheckedChange={(v) => onChange({ ...step, active: v === true })}
        />
        Passo ativo
      </label>
    </div>
  );
}

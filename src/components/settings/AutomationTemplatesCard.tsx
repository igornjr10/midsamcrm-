import { useMemo, useState } from "react";
import { AlertTriangle, Check, MessageSquareWarning, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useAutomationTemplatesQuery, useSaveAutomationTemplateMutation, useDeleteAutomationTemplateMutation,
  useWhatsappTemplatesQuery, useFeatures,
} from "@/hooks/queries";
import {
  bodyPlaceholders, headerTextPlaceholders, templateBody, VARIABLE_SOURCE_LABELS,
  type WhatsappTemplate,
} from "@/lib/templates";
import { AUTOMATION_PURPOSES, type VariableSource } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Qual template aprovado cada automação usa fora da janela de 24 horas.
 *
 * A Meta só aceita texto livre nas 24h seguintes à última mensagem do cliente.
 * Como toda automação fala com quem está em silêncio, sem template mapeado ela
 * simplesmente não chega. Aqui a empresa liga cada uma a um template aprovado
 * e diz o que entra em cada variável numerada.
 */
export default function AutomationTemplatesCard() {
  const { company } = useAuth();
  const { has } = useFeatures(company?.id);
  const { data: mapped } = useAutomationTemplatesQuery(company?.id);
  const { data: templates = [], isError } = useWhatsappTemplatesQuery(company?.id);
  const save = useSaveAutomationTemplateMutation();
  const remove = useDeleteAutomationTemplateMutation();

  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; vars: VariableSource[] }>({ name: "", vars: [] });

  const approved = useMemo(
    () => templates.filter((t) => (t.status ?? "").toUpperCase() === "APPROVED"),
    [templates],
  );
  const byName = useMemo(() => new Map(approved.map((t) => [t.name, t])), [approved]);

  // Só as automações dos módulos que a empresa tem: mapear template de pedido
  // sem o módulo de Pedidos seria configurar o que não existe.
  const purposes = AUTOMATION_PURPOSES.filter((p) => !p.feature || has(p.feature));

  const varCount = (t: WhatsappTemplate | undefined) =>
    t ? headerTextPlaceholders(t) + bodyPlaceholders(t) : 0;

  const startEdit = (purpose: string) => {
    const current = mapped?.get(purpose);
    const t = current ? byName.get(current.template_name) : undefined;
    const saved = [...(current?.variable_map.header ?? []), ...(current?.variable_map.body ?? [])];
    setDraft({
      name: current?.template_name ?? "",
      vars: saved.length > 0 ? saved : Array.from({ length: varCount(t) }, () => ({ source: "contact_first_name" as const })),
    });
    setOpen(purpose);
  };

  const pickTemplate = (purpose: string, name: string) => {
    const t = byName.get(name);
    const def = AUTOMATION_PURPOSES.find((p) => p.id === purpose);
    const total = varCount(t);
    // Primeiro placeholder quase sempre é a saudação; o resto tenta casar com
    // os dados do evento na ordem em que a automação os oferece.
    const vars: VariableSource[] = Array.from({ length: total }, (_, i) => {
      if (i === 0) return { source: "contact_first_name" };
      const key = def?.context[i - 1]?.key;
      return key ? { source: "context", key } : { source: "text", value: "" };
    });
    setDraft({ name, vars });
  };

  const setVar = (index: number, value: VariableSource) =>
    setDraft((d) => ({ ...d, vars: d.vars.map((v, i) => (i === index ? value : v)) }));

  const handleSave = async (purpose: string) => {
    if (!company || !draft.name) {
      toast.error("Escolha um template aprovado.");
      return;
    }
    const t = byName.get(draft.name);
    const headerCount = t ? headerTextPlaceholders(t) : 0;
    try {
      await save.mutateAsync({
        company_id: company.id,
        purpose,
        template_name: draft.name,
        template_language: t?.language ?? "pt_BR",
        variable_map: {
          header: draft.vars.slice(0, headerCount),
          body: draft.vars.slice(headerCount),
        },
        body_preview: t ? templateBody(t) : null,
      });
      toast.success("Template mapeado.");
      setOpen(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const handleRemove = async (purpose: string) => {
    if (!company) return;
    await remove.mutateAsync({ company_id: company.id, purpose });
    setOpen(null);
  };

  const faltando = purposes.filter((p) => !mapped?.get(p.id)).length;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <MessageSquareWarning className="h-4 w-4 text-muted-foreground" />
          Templates das automações
          {faltando > 0
            ? <Badge variant="warning">{faltando} sem template</Badge>
            : <Badge variant="success">Tudo mapeado</Badge>}
        </CardTitle>
        <CardDescription>
          A Meta só aceita texto livre nas 24 horas seguintes à última mensagem do cliente. Como as
          automações falam justamente com quem está em silêncio, fora dessa janela elas precisam de
          um template aprovado. Dentro da janela, o texto que você escreveu continua valendo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isError && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            Não foi possível ler os templates da Meta. Confira o Access Token e o WABA ID acima.
          </p>
        )}
        {!isError && approved.length === 0 && (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            Nenhum template aprovado nesta conta ainda. Crie no Gerenciador do WhatsApp da Meta, na
            categoria Marketing ou Utilidade, e volte aqui quando a Meta aprovar.
          </p>
        )}

        {purposes.map((p) => {
          const current = mapped?.get(p.id);
          const editing = open === p.id;
          const t = editing ? byName.get(draft.name) : current ? byName.get(current.template_name) : undefined;
          const headerCount = t ? headerTextPlaceholders(t) : 0;
          return (
            <div key={p.id} className={cn("rounded-lg border p-3", editing && "border-primary/40 bg-muted/30")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">{p.hint}</span>
                </span>
                {current ? (
                  <Badge variant="secondary" className="shrink-0 font-mono text-[11px]">{current.template_name}</Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0">não chega fora da janela</Badge>
                )}
                <Button size="sm" variant={editing ? "secondary" : "outline"} onClick={() => (editing ? setOpen(null) : startEdit(p.id))}>
                  {editing ? "Fechar" : current ? "Trocar" : "Escolher"}
                </Button>
              </div>

              {editing && (
                <div className="mt-3 space-y-3 border-t pt-3">
                  <div className="space-y-1.5">
                    <Label>Template aprovado</Label>
                    <Select value={draft.name} onValueChange={(v) => pickTemplate(p.id, v)}>
                      <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
                      <SelectContent>
                        {approved.map((t2) => (
                          <SelectItem key={t2.name} value={t2.name}>{t2.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {t && (
                    <>
                      <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-xs">{templateBody(t)}</p>
                      {draft.vars.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Este template não tem variáveis.</p>
                      ) : (
                        <div className="space-y-2">
                          <Label>O que entra em cada variável</Label>
                          {draft.vars.map((v, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2">
                              <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">
                                {`{{${i < headerCount ? i + 1 : i - headerCount + 1}}}`}
                                {i < headerCount && <span className="ml-1 not-italic">h</span>}
                              </span>
                              <Select
                                value={v.source === "context" ? `context:${v.key}` : v.source}
                                onValueChange={(val) => {
                                  if (val.startsWith("context:")) setVar(i, { source: "context", key: val.slice(8) });
                                  else if (val === "text") setVar(i, { source: "text", value: "" });
                                  else setVar(i, { source: val as "contact_name" | "contact_first_name" | "contact_phone" | "contact_email" });
                                }}
                              >
                                <SelectTrigger className="h-9 min-w-44 flex-1"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {p.context.map((c) => (
                                    <SelectItem key={c.key} value={`context:${c.key}`}>{c.label}</SelectItem>
                                  ))}
                                  {Object.entries(VARIABLE_SOURCE_LABELS).map(([src, label]) => (
                                    <SelectItem key={src} value={src}>{label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {v.source === "text" && (
                                <Input
                                  className="h-9 flex-1"
                                  placeholder="Texto fixo"
                                  value={v.value}
                                  onChange={(e) => setVar(i, { source: "text", value: e.target.value })}
                                />
                              )}
                            </div>
                          ))}
                          <p className="text-xs text-muted-foreground">
                            Sugestões de dado desta automação: {p.context.map((c) => c.label).join(", ") || "só os dados do contato"}.
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void handleSave(p.id)} disabled={!draft.name || save.isPending}>
                      <Check />
                      Salvar
                    </Button>
                    {current && (
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void handleRemove(p.id)}>
                        <Trash2 />
                        Remover
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Search, Send } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useContactsQuery, useWhatsappTemplatesQuery } from "@/hooks/queries";
import type { CreateCampaignInput } from "@/hooks/queries";
import { PIPELINE_STAGES, getStageLabel, getStageTone, type Contact, type VariableMap, type VariableSource } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  bodyPlaceholders,
  defaultVariables,
  headerTextPlaceholders,
  previewBody,
  previewHeader,
  templateBody,
  templateButtons,
  templateFooter,
  templateHeader,
  templateHeaderMediaType,
  type WhatsappTemplate,
} from "@/lib/templates";
import VariableRow from "@/components/campaigns/VariableRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export default function NewCampaignDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateCampaignInput) => void;
  submitting: boolean;
}) {
  const { company } = useAuth();
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const { data: templates = [], isPending: templatesLoading, error: templatesError } =
    useWhatsappTemplatesQuery(company?.id);

  const [name, setName] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [headerVars, setHeaderVars] = useState<VariableSource[]>([]);
  const [bodyVars, setBodyVars] = useState<VariableSource[]>([]);
  const [mediaUrl, setMediaUrl] = useState("");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const template = useMemo<WhatsappTemplate | undefined>(
    () => templates.find((t) => t.name === templateName),
    [templates, templateName],
  );
  const headerMediaType = template ? templateHeaderMediaType(template) : null;

  // Contatos sem telefone não podem receber template.
  const eligible = useMemo(() => contacts.filter((c) => !!c.phone?.trim()), [contacts]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return eligible.filter((c) => {
      if (stageFilter !== "all" && c.stage !== stageFilter) return false;
      if (!term) return true;
      return c.name.toLowerCase().includes(term) || (c.phone ?? "").includes(term);
    });
  }, [eligible, search, stageFilter]);

  useEffect(() => {
    if (!template) return;
    setHeaderVars(defaultVariables(headerTextPlaceholders(template), false));
    setBodyVars(defaultVariables(bodyPlaceholders(template), true));
    setMediaUrl("");
  }, [template]);

  useEffect(() => {
    if (open) return;
    setName("");
    setTemplateName("");
    setSelectedIds(new Set());
    setSearch("");
    setStageFilter("all");
  }, [open]);

  const variableMap: VariableMap = {
    header: headerVars,
    body: bodyVars,
    header_media_url: headerMediaType ? mediaUrl.trim() || null : null,
    header_media_type: headerMediaType,
  };

  const previewContact: Pick<Contact, "name" | "phone" | "email"> | null =
    eligible.find((c) => selectedIds.has(c.id)) ?? eligible[0] ?? null;

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));

  const toggleAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((c) => next.delete(c.id));
      else filtered.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const missingMedia = !!headerMediaType && !mediaUrl.trim();
  const canSubmit =
    !!name.trim() && !!template && selectedIds.size > 0 && !missingMedia && !submitting;

  const handleSubmit = () => {
    if (!template || !canSubmit) return;
    onSubmit({
      name: name.trim(),
      template_name: template.name,
      template_language: template.language,
      template_body: templateBody(template),
      variable_map: variableMap,
      contact_ids: [...selectedIds],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova campanha</DialogTitle>
          <DialogDescription>
            Fora da janela de 24h o WhatsApp só entrega mensagens usando um template já aprovado pela
            Meta. Escolha o template, preencha as variáveis e selecione quem vai receber.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label>Nome da campanha</Label>
            <Input
              placeholder="Ex: Promoção de julho"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Uso interno, o cliente não vê.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Template aprovado</Label>
            {templatesLoading ? (
              <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando templates da sua WABA...
              </div>
            ) : templatesError ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <p className="font-medium">Não foi possível carregar os templates.</p>
                  <p className="text-muted-foreground">
                    {templatesError instanceof Error ? templatesError.message : "Erro desconhecido"}
                  </p>
                </div>
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                Nenhum template aprovado nessa conta. Crie e envie para aprovação no Gerenciador do
                WhatsApp — a Meta costuma responder em alguns minutos.
              </div>
            ) : (
              <Select value={templateName} onValueChange={setTemplateName}>
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

          {template && (
            <>
              {headerMediaType && (
                <div className="space-y-1.5">
                  <Label>
                    URL da mídia do cabeçalho ({headerMediaType === "image" ? "imagem" : headerMediaType})
                  </Label>
                  <Input
                    placeholder="https://..."
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Precisa ser um link público — a Meta baixa o arquivo na hora do envio.
                  </p>
                </div>
              )}

              {(headerVars.length > 0 || bodyVars.length > 0) && (
                <div className="space-y-3 rounded-lg border p-3">
                  <p className="text-sm font-medium">Variáveis do template</p>
                  {headerVars.map((variable, i) => (
                    <VariableRow
                      key={`header-${i}`}
                      index={i}
                      value={variable}
                      onChange={(next) =>
                        setHeaderVars((prev) => prev.map((v, j) => (j === i ? next : v)))
                      }
                    />
                  ))}
                  {headerVars.length > 0 && bodyVars.length > 0 && <Separator />}
                  {bodyVars.map((variable, i) => (
                    <VariableRow
                      key={`body-${i}`}
                      index={i}
                      value={variable}
                      onChange={(next) =>
                        setBodyVars((prev) => prev.map((v, j) => (j === i ? next : v)))
                      }
                    />
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Prévia</Label>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="max-w-sm space-y-1 rounded-lg bg-card p-3 text-sm shadow-sm">
                    {templateHeader(template)?.format?.toUpperCase() === "TEXT" && (
                      <p className="font-semibold">{previewHeader(template, variableMap, previewContact)}</p>
                    )}
                    <p className="whitespace-pre-wrap">{previewBody(template, variableMap, previewContact)}</p>
                    {templateFooter(template) && (
                      <p className="text-xs text-muted-foreground">{templateFooter(template)}</p>
                    )}
                    {templateButtons(template).length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {templateButtons(template).map((label) => (
                          <Badge key={label} variant="outline" className="text-primary">
                            {label}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {previewContact && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Exemplo com o contato {previewContact.name}.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Destinatários</Label>
              <span className="text-xs text-muted-foreground">
                {selectedIds.size} selecionado{selectedIds.size === 1 ? "" : "s"}
              </span>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar por nome ou telefone"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger className="sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as etapas</SelectItem>
                  {PIPELINE_STAGES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className="flex cursor-pointer items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm transition-colors hover:bg-accent/50">
              <Checkbox checked={allFilteredSelected} onCheckedChange={toggleAllFiltered} />
              Selecionar todos os {filtered.length} contatos filtrados
            </label>

            <ScrollArea className="h-56 rounded-lg border">
              {filtered.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  {eligible.length === 0
                    ? "Nenhum contato com telefone cadastrado."
                    : "Nenhum contato encontrado com esses filtros."}
                </p>
              ) : (
                <div className="divide-y">
                  {filtered.map((contact) => (
                    <label
                      key={contact.id}
                      className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-accent/40"
                    >
                      <Checkbox
                        checked={selectedIds.has(contact.id)}
                        onCheckedChange={() => toggleOne(contact.id)}
                      />
                      <span className="flex-1 truncate font-medium">{contact.name}</span>
                      <span className="tabular text-muted-foreground">{contact.phone}</span>
                      <Badge variant="outline" className={cn("shrink-0", getStageTone(contact.stage).badge)}>
                        {getStageLabel(contact.stage)}
                      </Badge>
                    </label>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {missingMedia && (
            <p className="text-xs text-destructive">
              Este template tem cabeçalho de mídia — informe a URL antes de disparar.
            </p>
          )}

          <Button className="w-full" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="animate-spin" /> : <Send />}
            {submitting
              ? "Disparando..."
              : `Disparar para ${selectedIds.size} contato${selectedIds.size === 1 ? "" : "s"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

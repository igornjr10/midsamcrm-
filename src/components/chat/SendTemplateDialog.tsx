import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWhatsappTemplatesQuery } from "@/hooks/queries";
import {
  bodyPlaceholders,
  defaultVariables,
  headerTextPlaceholders,
  previewBody,
  previewHeader,
  templateBody,
  templateFooter,
  templateHeader,
  templateHeaderMediaType,
  type WhatsappTemplate,
} from "@/lib/templates";
import type { Contact, VariableMap, VariableSource } from "@/lib/types";
import VariableRow from "@/components/campaigns/VariableRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * Envio de template aprovado para um contato só — é o único jeito de retomar a
 * conversa depois que a janela de 24h desde a última mensagem do cliente fecha.
 */
export default function SendTemplateDialog({
  contact,
  open,
  onOpenChange,
}: {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { company } = useAuth();
  const { data: templates = [], isPending, error } = useWhatsappTemplatesQuery(company?.id);

  const [templateName, setTemplateName] = useState("");
  const [headerVars, setHeaderVars] = useState<VariableSource[]>([]);
  const [bodyVars, setBodyVars] = useState<VariableSource[]>([]);
  const [mediaUrl, setMediaUrl] = useState("");
  const [sending, setSending] = useState(false);

  const template = useMemo<WhatsappTemplate | undefined>(
    () => templates.find((t) => t.name === templateName),
    [templates, templateName],
  );
  const headerMediaType = template ? templateHeaderMediaType(template) : null;

  useEffect(() => {
    if (!template) return;
    setHeaderVars(defaultVariables(headerTextPlaceholders(template), false));
    setBodyVars(defaultVariables(bodyPlaceholders(template), true));
    setMediaUrl("");
  }, [template]);

  useEffect(() => {
    if (!open) setTemplateName("");
  }, [open]);

  const variableMap: VariableMap = {
    header: headerVars,
    body: bodyVars,
    header_media_url: headerMediaType ? mediaUrl.trim() || null : null,
    header_media_type: headerMediaType,
  };

  const missingMedia = !!headerMediaType && !mediaUrl.trim();

  const handleSend = async () => {
    if (!contact?.phone || !template) return;
    setSending(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        "whatsapp-send?action=send-template",
        {
          body: {
            phone: contact.phone,
            contact_id: contact.id,
            template_name: template.name,
            template_language: template.language,
            template_body: templateBody(template),
            variable_map: variableMap,
          },
        },
      );
      if (invokeError || (data && data.success === false)) {
        throw new Error((data?.error as string) || invokeError?.message || "Falha ao enviar");
      }
      toast.success("Template enviado!");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar template");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar template</DialogTitle>
          <DialogDescription>
            Use um template aprovado pela Meta para falar com {contact?.name} mesmo fora da janela de
            24 horas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Template aprovado</Label>
            {isPending ? (
              <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando templates...
              </div>
            ) : error ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <span className="text-muted-foreground">
                  {error instanceof Error ? error.message : "Erro ao carregar templates"}
                </span>
              </div>
            ) : templates.length === 0 ? (
              <p className="rounded-lg border p-3 text-sm text-muted-foreground">
                Nenhum template aprovado nesta conta.
              </p>
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
                  <Label>URL da mídia do cabeçalho</Label>
                  <Input
                    placeholder="https://..."
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                  />
                </div>
              )}

              {(headerVars.length > 0 || bodyVars.length > 0) && (
                <div className="space-y-3 rounded-lg border p-3">
                  <p className="text-sm font-medium">Variáveis</p>
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
                  {bodyVars.map((variable, i) => (
                    <VariableRow
                      key={`body-${i}`}
                      index={i}
                      value={variable}
                      onChange={(next) => setBodyVars((prev) => prev.map((v, j) => (j === i ? next : v)))}
                    />
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Prévia</Label>
                <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
                  {templateHeader(template)?.format?.toUpperCase() === "TEXT" && (
                    <p className="font-semibold">{previewHeader(template, variableMap, contact)}</p>
                  )}
                  <p className="whitespace-pre-wrap">{previewBody(template, variableMap, contact)}</p>
                  {templateFooter(template) && (
                    <p className="text-xs text-muted-foreground">{templateFooter(template)}</p>
                  )}
                </div>
              </div>
            </>
          )}

          <Button
            className="w-full gap-2"
            onClick={() => void handleSend()}
            disabled={!template || sending || missingMedia || !contact?.phone}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar template
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { Bot, CalendarClock, History, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useAiConfigQuery, useSaveAiConfigMutation } from "@/hooks/queries";
import FollowupSettings from "@/components/sdr/FollowupSettings";
import FollowupHistory from "@/components/sdr/FollowupHistory";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const DEFAULT_PROMPT =
  "Você é um atendente comercial simpático e objetivo da empresa. Responda em português do Brasil, " +
  "em mensagens curtas de WhatsApp. Qualifique o interesse do cliente: pergunte o nome, o que ele " +
  "procura e a urgência. Nunca invente preços, prazos ou condições — se não souber, diga que um " +
  "atendente humano vai confirmar.";

const MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o mini (rápido e barato)" },
  { value: "gpt-4o", label: "GPT-4o (mais inteligente)" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini" },
];

export default function SdrIa() {
  const { company } = useAuth();
  const { data: config, isPending } = useAiConfigQuery(company?.id);
  const saveConfig = useSaveAiConfigMutation();

  const [enabled, setEnabled] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [model, setModel] = useState("gpt-4o-mini");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setPrompt(config.system_prompt ?? DEFAULT_PROMPT);
    setModel(config.model);
    setApiKey(config.openai_api_key ?? "");
  }, [config]);

  const handleSave = async () => {
    if (!company) return;
    if (enabled && !apiKey.trim()) {
      toast.error("Informe a chave da OpenAI para ligar o SDR IA.");
      return;
    }
    try {
      await saveConfig.mutateAsync({
        company_id: company.id,
        enabled,
        system_prompt: prompt.trim() || null,
        model,
        openai_api_key: apiKey.trim() || null,
      });
      toast.success(enabled ? "SDR IA ligado! Novas mensagens de leads serão respondidas automaticamente." : "Configuração salva.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        icon={Bot}
        title="SDR IA"
        description="Atendimento e follow-up automáticos no WhatsApp"
        badges={
          <>
            {config?.enabled ? (
              <Badge variant="success">Ativo</Badge>
            ) : (
              <Badge variant="outline">Desligado</Badge>
            )}
            {config?.followup_enabled && <Badge variant="secondary">Follow-up ligado</Badge>}
          </>
        }
      />

      <Tabs defaultValue="agente">
        <TabsList>
          <TabsTrigger value="agente">
            <Sparkles />
            Agente
          </TabsTrigger>
          <TabsTrigger value="followup">
            <CalendarClock />
            Follow-up
          </TabsTrigger>
          <TabsTrigger value="historico">
            <History />
            Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="agente" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Atendimento automático de leads</CardTitle>
              <CardDescription>
                Quando ligado, toda mensagem de texto recebida no WhatsApp é respondida automaticamente
                pela IA, seguindo o prompt abaixo. Você pode pausar a IA em qualquer conversa individual
                pelo Chat (botão "Pausar IA") para assumir o atendimento.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isPending ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-3.5 transition-colors",
                      enabled ? "border-primary/40 bg-primary/5" : "hover:bg-accent/50",
                    )}
                  >
                    <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
                    <div>
                      <p className="text-sm font-medium">Ligar SDR IA</p>
                      <p className="text-xs text-muted-foreground">
                        Responder leads automaticamente no WhatsApp
                      </p>
                    </div>
                  </label>

                  <div className="space-y-1.5">
                    <Label>Prompt do agente (personalidade e regras)</Label>
                    <Textarea rows={7} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
                    <p className="text-xs text-muted-foreground">
                      Descreva o que a empresa vende, o tom de voz e o que a IA deve (e não deve) fazer.
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Modelo</Label>
                      <Select value={model} onValueChange={setModel}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MODELS.map((m) => (
                            <SelectItem key={m.value} value={m.value}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Chave da OpenAI</Label>
                      <Input
                        type="password"
                        placeholder="sk-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                    </div>
                  </div>

                  <Button onClick={handleSave} disabled={saveConfig.isPending}>
                    {saveConfig.isPending ? "Salvando..." : "Salvar"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="followup" className="mt-4">
          <FollowupSettings />
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          <FollowupHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}

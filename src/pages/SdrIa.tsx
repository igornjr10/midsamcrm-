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

// 0..24: o começo da janela vai até 23h e o fim começa em 1h (ver os slice()
// mais abaixo), então a lista precisa das duas pontas.
const HOURS = Array.from({ length: 25 }, (_, i) => i);

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
  const [pauseOnHuman, setPauseOnHuman] = useState(true);
  const [onlyOpenStages, setOnlyOpenStages] = useState(true);
  const [windowEnabled, setWindowEnabled] = useState(false);
  const [windowStart, setWindowStart] = useState(8);
  const [windowEnd, setWindowEnd] = useState(20);
  const [skipWeekends, setSkipWeekends] = useState(false);
  const [offhoursMessage, setOffhoursMessage] = useState("");

  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setPrompt(config.system_prompt ?? DEFAULT_PROMPT);
    setModel(config.model);
    setApiKey(config.openai_api_key ?? "");
    setPauseOnHuman(config.pause_ai_on_human_reply ?? true);
    setOnlyOpenStages(config.ai_only_open_stages ?? true);
    setWindowEnabled(config.reply_window_enabled ?? false);
    setWindowStart(config.reply_window_start ?? 8);
    setWindowEnd(config.reply_window_end ?? 20);
    setSkipWeekends(config.reply_skip_weekends ?? false);
    setOffhoursMessage(config.reply_offhours_message ?? "");
  }, [config]);

  const handleSave = async () => {
    if (!company) return;
    if (enabled && !apiKey.trim()) {
      toast.error("Informe a chave da OpenAI para ligar o SDR IA.");
      return;
    }
    if (windowEnabled && windowEnd <= windowStart) {
      toast.error("O fim do horário de atendimento tem que ser depois do início.");
      return;
    }
    try {
      await saveConfig.mutateAsync({
        company_id: company.id,
        enabled,
        system_prompt: prompt.trim() || null,
        model,
        openai_api_key: apiKey.trim() || null,
        pause_ai_on_human_reply: pauseOnHuman,
        ai_only_open_stages: onlyOpenStages,
        reply_window_enabled: windowEnabled,
        reply_window_start: windowStart,
        reply_window_end: windowEnd,
        reply_skip_weekends: skipWeekends,
        reply_offhours_message: offhoursMessage.trim() || null,
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

                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-3.5 transition-colors",
                      pauseOnHuman ? "border-primary/40 bg-primary/5" : "hover:bg-accent/50",
                    )}
                  >
                    <Checkbox
                      checked={pauseOnHuman}
                      onCheckedChange={(v) => setPauseOnHuman(v === true)}
                    />
                    <div>
                      <p className="text-sm font-medium">Pausar a IA quando o vendedor entrar</p>
                      <p className="text-xs text-muted-foreground">
                        Assim que alguém do time responder — pelo Chat ou pelo celular — a IA para
                        naquela conversa. Ela só volta quando você clicar em "Reativar IA".
                      </p>
                    </div>
                  </label>

                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-3.5 transition-colors",
                      onlyOpenStages ? "border-primary/40 bg-primary/5" : "hover:bg-accent/50",
                    )}
                  >
                    <Checkbox
                      checked={onlyOpenStages}
                      onCheckedChange={(v) => setOnlyOpenStages(v === true)}
                    />
                    <div>
                      <p className="text-sm font-medium">Não falar com negócio já fechado</p>
                      <p className="text-xs text-muted-foreground">
                        A IA ignora contatos em etapa de Ganho ou Perdido, inclusive quando foi o
                        próprio funil que moveu o contato depois do pagamento. Reabriu o negócio, a
                        IA volta sozinha.
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

                  {/* Horário de atendimento.
                      A janela do follow-up (aba ao lado) é outra coisa: lá o
                      cron escolhe a hora de falar com quem sumiu. Aqui é a
                      resposta a quem acabou de escrever — que até então saía a
                      qualquer hora da madrugada. */}
                  <div className="space-y-3 rounded-lg border p-4">
                    <label className="flex cursor-pointer items-start gap-3">
                      <Checkbox
                        checked={windowEnabled}
                        onCheckedChange={(v) => setWindowEnabled(v === true)}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-sm font-medium">Responder só em horário de atendimento</p>
                        <p className="text-xs text-muted-foreground">
                          Fora dele a IA fica calada e a mensagem do lead espera não lida, para a
                          equipe ver no dia seguinte
                        </p>
                      </div>
                    </label>

                    {windowEnabled && (
                      <>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Atender a partir das</Label>
                            <Select
                              value={String(windowStart)}
                              onValueChange={(v) => setWindowStart(Number(v))}
                            >
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
                            <Select
                              value={String(windowEnd)}
                              onValueChange={(v) => setWindowEnd(Number(v))}
                            >
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

                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <Checkbox
                            checked={skipWeekends}
                            onCheckedChange={(v) => setSkipWeekends(v === true)}
                          />
                          Não atender aos sábados e domingos
                        </label>

                        <div className="space-y-1.5">
                          <Label>Aviso fora do horário (opcional)</Label>
                          <Textarea
                            rows={2}
                            placeholder="Oi! Nosso atendimento é das 8h às 20h. Sua mensagem já está aqui e respondemos logo cedo."
                            value={offhoursMessage}
                            onChange={(e) => setOffhoursMessage(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">
                            Mandado no máximo uma vez a cada 12h por contato — quem escreve cinco
                            vezes de madrugada não recebe a mesma frase cinco vezes. Em branco, a IA
                            simplesmente não responde.
                          </p>
                        </div>

                        <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                          Usa o fuso configurado na aba Follow-up (
                          {(config?.followup_timezone ?? "America/Sao_Paulo").replace("America/", "").replace("_", " ")}
                          ).
                        </p>
                      </>
                    )}
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

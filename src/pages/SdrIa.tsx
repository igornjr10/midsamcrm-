import { useEffect, useState } from "react";
import {
  Bot, CalendarClock, Hand, HeartHandshake, History, MessageSquareText, Timer, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useAiConfigQuery, useSaveAiConfigMutation } from "@/hooks/queries";
import FollowupSettings from "@/components/sdr/FollowupSettings";
import FollowupHistory from "@/components/sdr/FollowupHistory";
import RelationshipSettings from "@/components/sdr/RelationshipSettings";
import SdrActivationTab from "@/components/sdr/SdrActivationTab";
import SdrTimingTab from "@/components/sdr/SdrTimingTab";
import SdrCommunicationTab from "@/components/sdr/SdrCommunicationTab";
import SdrHandoffTab from "@/components/sdr/SdrHandoffTab";
import { draftFromConfig, parsePhrases, type SdrDraft } from "@/components/sdr/sdrDraft";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SkeletonForm } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// As quatro abas do agente editam o mesmo rascunho e salvam juntas; Follow-up,
// Relacionamento e Histórico têm o próprio salvar.
const AGENT_TABS = ["ativacao", "tempo", "comunicacao", "encaminhamento"];

export default function SdrIa() {
  const { company } = useAuth();
  const { data: config, isPending } = useAiConfigQuery(company?.id);
  const saveConfig = useSaveAiConfigMutation();

  const [tab, setTab] = useState("ativacao");
  const [draft, setDraft] = useState<SdrDraft>(() => draftFromConfig(null));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!config) return;
    setDraft(draftFromConfig(config));
    setDirty(false);
  }, [config]);

  const update = (patch: Partial<SdrDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!company) return;
    if (draft.enabled && !draft.apiKey.trim() && !config?.has_openai_api_key) {
      toast.error("Informe a chave da OpenAI (aba Comunicação) para ligar o SDR IA.");
      setTab("comunicacao");
      return;
    }
    if (draft.windowEnabled && draft.windowEnd <= draft.windowStart) {
      toast.error("O fim do horário de atendimento tem que ser depois do início.");
      setTab("tempo");
      return;
    }
    try {
      await saveConfig.mutateAsync({
        company_id: company.id,
        enabled: draft.enabled,
        system_prompt: draft.prompt.trim() || null,
        model: draft.model,
        // Vazio mantém a chave gravada: ela não é lida de volta pelo navegador.
        openai_api_key: draft.apiKey.trim() || null,
        pause_ai_on_human_reply: draft.pauseOnHuman,
        ai_only_open_stages: draft.onlyOpenStages,
        reply_window_enabled: draft.windowEnabled,
        reply_window_start: draft.windowStart,
        reply_window_end: draft.windowEnd,
        reply_skip_weekends: draft.skipWeekends,
        reply_offhours_message: draft.offhoursMessage.trim() || null,
        reply_first_delay_seconds: draft.firstDelay,
        reply_delay_seconds: draft.nextDelay,
        reply_debounce_seconds: draft.debounce,
        only_new_leads: draft.onlyNewLeads,
        trigger_phrases: parsePhrases(draft.triggerPhrases),
        allowed_sources: draft.allowedSources,
        excluded_tags: draft.excludedTags,
        handoff_user_id: draft.handoffUserId,
        max_unanswered: draft.maxUnanswered,
        prompt_fields: draft.promptFields,
      });
      setDirty(false);
      toast.success(
        draft.enabled && !config?.enabled
          ? "SDR IA ligado! Leads que seguirem as regras de ativação serão atendidos."
          : "Configuração salva.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const timezone = config?.followup_timezone ?? "America/Sao_Paulo";

  return (
    <div className="max-w-3xl">
      <PageHeader
        icon={Bot}
        title="SDR IA"
        description="Atendimento e follow-up automáticos no WhatsApp"
        badges={
          <>
            {config?.enabled ? <Badge variant="success">Ativo</Badge> : <Badge variant="outline">Desligado</Badge>}
            {config?.followup_enabled && <Badge variant="secondary">Follow-up ligado</Badge>}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="ativacao"><Zap />Ativação</TabsTrigger>
          <TabsTrigger value="tempo"><Timer />Tempo de resposta</TabsTrigger>
          <TabsTrigger value="comunicacao"><MessageSquareText />Comunicação</TabsTrigger>
          <TabsTrigger value="encaminhamento"><Hand />Encaminhamento</TabsTrigger>
          <TabsTrigger value="followup"><CalendarClock />Follow-up</TabsTrigger>
          <TabsTrigger value="relacionamento"><HeartHandshake />Relacionamento</TabsTrigger>
          <TabsTrigger value="historico"><History />Histórico</TabsTrigger>
        </TabsList>

        {isPending ? (
          <div className="mt-4"><SkeletonForm fields={4} /></div>
        ) : (
          <>
            <TabsContent value="ativacao" className="mt-4">
              <SdrActivationTab draft={draft} update={update} activatedAt={config?.activated_at ?? null} />
            </TabsContent>
            <TabsContent value="tempo" className="mt-4">
              <SdrTimingTab draft={draft} update={update} timezone={timezone} />
            </TabsContent>
            <TabsContent value="comunicacao" className="mt-4">
              <SdrCommunicationTab draft={draft} update={update} hasSavedKey={!!config?.has_openai_api_key} />
            </TabsContent>
            <TabsContent value="encaminhamento" className="mt-4">
              <SdrHandoffTab draft={draft} update={update} />
            </TabsContent>
          </>
        )}

        <TabsContent value="followup" className="mt-4">
          <FollowupSettings />
        </TabsContent>
        <TabsContent value="relacionamento" className="mt-4">
          <RelationshipSettings />
        </TabsContent>
        <TabsContent value="historico" className="mt-4">
          <FollowupHistory />
        </TabsContent>
      </Tabs>

      {/* Salvar fixo: as quatro abas do agente salvam juntas, então o botão não
          pode ficar escondido no fim de uma delas. */}
      {AGENT_TABS.includes(tab) && !isPending && (
        <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t bg-background/90 backdrop-blur-md sm:-mx-6 lg:-mx-8">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <p className="text-xs text-muted-foreground">
              {dirty ? "Alterações não salvas nas abas do agente." : "Tudo salvo."}
            </p>
            <Button onClick={() => void handleSave()} disabled={saveConfig.isPending || !dirty}>
              {saveConfig.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

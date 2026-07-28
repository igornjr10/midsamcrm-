import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Megaphone, Play, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  campaignsQueryKey,
  useCampaignsQuery,
  useCampaignTargetsQuery,
  useCancelCampaignMutation,
  useCreateCampaignMutation,
  useDispatchCampaignMutation,
  type CreateCampaignInput,
} from "@/hooks/queries";
import type { Campaign, CampaignStatus } from "@/lib/types";
import NewCampaignDialog from "@/components/campaigns/NewCampaignDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, LoadingState } from "@/components/ui/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Rascunho",
  running: "Enviando",
  paused: "Pausada",
  done: "Concluída",
  canceled: "Cancelada",
};

const TARGET_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falhou",
};

const STATUS_VARIANTS: Record<CampaignStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  draft: "outline",
  running: "default",
  paused: "warning",
  done: "success",
  canceled: "destructive",
};

function StatusBadge({ status }: { status: CampaignStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}

function CampaignDetail({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const { data: targets = [], isPending } = useCampaignTargetsQuery(campaign?.id);

  return (
    <Dialog open={!!campaign} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{campaign?.name}</DialogTitle>
          <DialogDescription>
            Template <span className="font-mono">{campaign?.template_name}</span> ·{" "}
            {campaign?.total_count} destinatário{campaign?.total_count === 1 ? "" : "s"}
          </DialogDescription>
        </DialogHeader>

        {campaign?.template_body && (
          <p className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-sm">
            {campaign.template_body}
          </p>
        )}

        <ScrollArea className="h-72 rounded-lg border">
          {isPending ? (
            <div className="flex justify-center p-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="divide-y">
              {targets.map((target) => (
                <div key={target.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex-1 truncate font-mono text-xs">{target.phone}</span>
                  {target.error && (
                    <span className="max-w-[16rem] truncate text-xs text-destructive" title={target.error}>
                      {target.error}
                    </span>
                  )}
                  <Badge
                    variant={
                      target.status === "failed"
                        ? "destructive"
                        : target.status === "read" || target.status === "delivered"
                          ? "success"
                          : "outline"
                    }
                  >
                    {TARGET_STATUS_LABELS[target.status] ?? target.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export default function Campaigns() {
  const { company } = useAuth();
  const queryClient = useQueryClient();
  const { data: campaigns = [], isPending } = useCampaignsQuery(company?.id);
  const createCampaign = useCreateCampaignMutation();
  const dispatchCampaign = useDispatchCampaignMutation();
  const cancelCampaign = useCancelCampaignMutation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [detail, setDetail] = useState<Campaign | null>(null);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  const refreshCampaigns = () =>
    queryClient.invalidateQueries({ queryKey: campaignsQueryKey(company?.id) });

  // O backend envia em lotes curtos (limite de tempo da edge function), então
  // repetimos até não sobrar ninguém pendente.
  const runDispatchLoop = async (campaignId: string) => {
    setDispatchingId(campaignId);
    try {
      let totalSent = 0;
      let totalFailed = 0;
      for (let round = 0; round < 500; round++) {
        const result = await dispatchCampaign.mutateAsync({ campaignId, companyId: company?.id });
        totalSent += result.sent;
        totalFailed += result.failed;
        void refreshCampaigns();
        if (result.done) break;
      }
      if (totalFailed > 0) {
        toast.warning(`Disparo concluído: ${totalSent} enviadas, ${totalFailed} com falha.`);
      } else {
        toast.success(`Disparo concluído: ${totalSent} mensagens enviadas.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro durante o disparo");
    } finally {
      setDispatchingId(null);
      void refreshCampaigns();
    }
  };

  const handleCreate = async (input: CreateCampaignInput) => {
    try {
      const { campaign, skipped } = await createCampaign.mutateAsync({
        ...input,
        company_id: company?.id,
      });
      setDialogOpen(false);
      void refreshCampaigns();
      if (skipped > 0) {
        toast.info(`${skipped} contato(s) ignorado(s) por telefone inválido ou repetido.`);
      }
      await runDispatchLoop(campaign.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar campanha");
    }
  };

  const handleCancel = async (campaign: Campaign) => {
    if (!company) return;
    try {
      await cancelCampaign.mutateAsync({ campaignId: campaign.id, companyId: company.id });
      toast.success("Campanha cancelada. Os pendentes não serão enviados.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cancelar");
    }
  };

  return (
    <div>
      <PageHeader
        icon={Megaphone}
        title="Disparos"
        description="Campanhas em massa por template aprovado do WhatsApp"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus />
            Nova campanha
          </Button>
        }
      />

      <Card className="mb-6 border-primary/20 bg-primary/5 shadow-none">
        <CardHeader>
          <CardTitle>Como funciona</CardTitle>
          <CardDescription>
            O WhatsApp só permite iniciar conversa (fora das 24h após a última mensagem do cliente)
            com um template aprovado pela Meta. Os templates aprovados na sua WABA aparecem
            automaticamente ao criar a campanha. Os envios são espaçados para preservar a qualidade do
            número, e cada disparo também entra no histórico do Chat do contato.
          </CardDescription>
        </CardHeader>
      </Card>

      {isPending ? (
        <LoadingState label="Carregando campanhas..." />
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Nenhuma campanha ainda"
          description="Crie a primeira campanha para disparar um template aprovado para a sua base."
          action={
            <Button onClick={() => setDialogOpen(true)}>
              <Plus />
              Nova campanha
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign) => {
            const processed = campaign.sent_count + campaign.failed_count;
            const percent = campaign.total_count
              ? Math.round((processed / campaign.total_count) * 100)
              : 0;
            const isDispatching = dispatchingId === campaign.id;

            return (
              <div
                key={campaign.id}
                className="rounded-xl border bg-card p-4 shadow-card transition-shadow hover:shadow-card-hover"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button className="min-w-0 text-left" onClick={() => setDetail(campaign)}>
                    <p className="truncate font-semibold hover:underline">{campaign.name}</p>
                    <p className="tabular mt-0.5 truncate text-xs text-muted-foreground">
                      <span className="font-mono">{campaign.template_name}</span> ·{" "}
                      {new Date(campaign.created_at).toLocaleString("pt-BR")}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={campaign.status} />
                    {campaign.status === "running" && !isDispatching && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => void runDispatchLoop(campaign.id)}>
                          <Play />
                          Continuar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void handleCancel(campaign)}
                        >
                          <X />
                          Cancelar
                        </Button>
                      </>
                    )}
                    {isDispatching && (
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Enviando...
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        campaign.failed_count > 0 && campaign.status === "done"
                          ? "bg-warning"
                          : campaign.status === "canceled"
                            ? "bg-muted-foreground"
                            : "bg-primary",
                      )}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="tabular w-10 shrink-0 text-right text-xs font-medium text-muted-foreground">
                    {percent}%
                  </span>
                </div>
                <div className="tabular mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    {campaign.sent_count} enviadas
                  </span>
                  {campaign.failed_count > 0 && (
                    <span className="flex items-center gap-1.5 text-destructive">
                      <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                      {campaign.failed_count} falhas
                    </span>
                  )}
                  <span>{campaign.total_count} no total</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewCampaignDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={(input) => void handleCreate(input)}
        submitting={createCampaign.isPending}
      />
      <CampaignDetail campaign={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

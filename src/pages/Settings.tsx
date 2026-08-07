import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy, CheckCircle, Loader2, History, QrCode, Settings as SettingsIcon, Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, SUPABASE_URL } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  useWhatsappConfigQuery, useSaveWhatsappConfigMutation, whatsappConfigQueryKey,
} from "@/hooks/queries";
import type { WhatsappProvider } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";

const DATAFY_API_BASE = "https://cloud.datafyapi.com.br/v1";

function generateVerifyToken(): string {
  return "minicrm_" + Math.random().toString(36).slice(2, 12);
}

type InstanceState = "open" | "connecting" | "close" | "none" | "unknown";

/** 20 renovações de 30s ≈ 10 minutos de janela para escanear. */
const MAX_QR_ROUNDS = 20;

const STATE_LABEL: Record<InstanceState, string> = {
  open: "Conectado",
  connecting: "Aguardando leitura do QR",
  close: "Desconectado",
  none: "Nenhum número conectado",
  unknown: "Não foi possível consultar",
};

export default function Settings() {
  const { user, company } = useAuth();
  const { data: config, isPending } = useWhatsappConfigQuery(company?.id);
  const saveConfig = useSaveWhatsappConfigMutation();
  const queryClient = useQueryClient();

  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [verifyToken, setVerifyToken] = useState(generateVerifyToken());
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<Record<string, string> | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Provedor em edição. Antes de existir config, o padrão é Evolution: conectar
  // por QR não exige nada do cliente, e a Cloud API depende de credencial que
  // só quem já tem conta Meta consegue.
  const [provider, setProvider] = useState<WhatsappProvider>("evolution");
  const [qr, setQr] = useState<string | null>(null);
  /** Quantas vezes o código já foi renovado nesta tentativa. */
  const [qrRounds, setQrRounds] = useState(0);
  const [instanceState, setInstanceState] = useState<InstanceState>("none");
  const [connecting, setConnecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] =
    useState<{ messages: number; contacts: number; total: number; done: number } | null>(null);
  const pollRef = useRef<number | null>(null);

  const webhookUrl = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  useEffect(() => {
    if (!config) return;
    setProvider(config.provider ?? "meta");
    setPhoneNumberId(config.phone_number_id ?? "");
    setWabaId(config.waba_id ?? "");
    setAccessToken(config.access_token ?? "");
    setVerifyToken(config.webhook_verify_token);
    setLabel(config.label ?? "");
  }, [config]);

  const callInstance = useCallback(
    async (action: "connect" | "status" | "disconnect") => {
      const { data, error } = await supabase.functions.invoke(
        `whatsapp-instance?action=${action}`,
        { body: { company_id: company?.id, provider } },
      );
      if (error || data?.error) throw new Error(data?.error || error?.message);
      return data as { connected?: boolean; state?: InstanceState; qr?: string | null };
    },
    [company?.id, provider],
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Enquanto o QR está na tela: pergunta o estado a cada 3s e renova o código a
  // cada 30s.
  //
  // Os dois são necessários. O Evolution não avisa o front quando o celular lê o
  // código — só o próprio servidor sabe. E o QR do WhatsApp rotaciona sozinho em
  // poucos segundos: sem renovar, o cliente que demora para achar "Aparelhos
  // conectados" escaneia um código morto e não acontece nada — sem erro, sem
  // aviso, a tela só fica esperando para sempre.
  useEffect(() => {
    if (!qr || !company?.id) return;

    let ticks = 0;
    pollRef.current = window.setInterval(() => {
      ticks += 1;

      void callInstance("status")
        .then((res) => {
          setInstanceState(res.state ?? "unknown");
          if (res.connected) {
            stopPolling();
            setQr(null);
            setQrRounds(0);
            toast.success("Número conectado!");
            void queryClient.invalidateQueries({ queryKey: whatsappConfigQueryKey(company.id) });
          }
        })
        .catch(() => {
          /* servidor fora do ar: a próxima volta tenta de novo */
        });

      // A cada 10 voltas (30s) pede um código novo. Trocar o `qr` reinicia este
      // efeito, então o ciclo recomeça limpo a partir do código novo.
      if (ticks % 10 === 0) {
        void callInstance("connect")
          .then((res) => {
            if (res.qr) {
              setQr(res.qr);
              setQrRounds((n) => n + 1);
            }
          })
          .catch(() => {
            /* mantém o código atual e tenta de novo no próximo ciclo */
          });
      }
    }, 3000);

    return stopPolling;
  }, [qr, company?.id, callInstance, stopPolling, queryClient]);

  // Teto de renovações: o Evolution tem limite de QRs por instância, e uma aba
  // esquecida aberta queimaria a cota até a instância parar de gerar código.
  useEffect(() => {
    if (qrRounds < MAX_QR_ROUNDS) return;
    stopPolling();
    setQr(null);
    setQrRounds(0);
    toast.info("O QR expirou. Toque em Conectar número para gerar outro.");
  }, [qrRounds, stopPolling]);

  const handleConnect = async () => {
    setConnecting(true);
    setQrRounds(0);
    try {
      const res = await callInstance("connect");
      setInstanceState(res.state ?? "unknown");
      if (res.connected) {
        setQr(null);
        toast.success("Número já está conectado.");
        void queryClient.invalidateQueries({ queryKey: whatsappConfigQueryKey(company!.id) });
      } else if (res.qr) {
        setQr(res.qr);
      } else {
        toast.error("O servidor não devolveu o QR code. Tente de novo.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao conectar");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setConnecting(true);
    try {
      await callInstance("disconnect");
      stopPolling();
      setQr(null);
      setInstanceState("close");
      toast.success("Número desconectado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao desconectar");
    } finally {
      setConnecting(false);
    }
  };

  // Importa em lotes: cada chamada devolve o offset seguinte e o front continua
  // até acabar. Uma chamada só estouraria o tempo da function.
  const importHistory = async () => {
    setImporting(true);
    setImported(null);
    try {
      let offset = 0;
      let messages = 0;
      let contacts = 0;

      for (let round = 0; round < 200; round += 1) {
        const { data, error } = await supabase.functions.invoke("whatsapp-history", {
          body: { company_id: company?.id, offset },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message);

        messages += Number(data.imported_messages ?? 0);
        contacts += Number(data.created_contacts ?? 0);
        offset = Number(data.next_offset ?? offset);
        setImported({ messages, contacts, total: Number(data.total_chats ?? 0), done: offset });

        if (data.done) break;
      }

      toast.success(`Histórico importado: ${messages} mensagens, ${contacts} contatos novos.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar histórico");
    } finally {
      setImporting(false);
    }
  };

  const checkInstanceStatus = async () => {
    setStatusLoading(true);
    try {
      const res = await callInstance("status");
      setInstanceState(res.state ?? "unknown");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao consultar status");
    } finally {
      setStatusLoading(false);
    }
  };

  const copyToClipboard = (value: string) => {
    void navigator.clipboard.writeText(value);
    toast.success("Copiado!");
  };

  const handleSave = async () => {
    if (!user || !company) return;
    if (!phoneNumberId.trim() || !wabaId.trim() || !accessToken.trim()) {
      toast.error("Preencha Phone Number ID, WABA ID e Access Token.");
      return;
    }
    try {
      await saveConfig.mutateAsync({
        user_id: user.id,
        company_id: company.id,
        provider: "meta",
        phone_number_id: phoneNumberId.trim(),
        waba_id: wabaId.trim(),
        access_token: accessToken.trim(),
        webhook_verify_token: verifyToken,
        label: label.trim() || null,
        api_base_url: DATAFY_API_BASE,
        active: true,
      });
      toast.success("Configuração salva! Agora aponte o webhook do Datafy para a URL acima.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar configuração");
    }
  };

  const checkStatus = async () => {
    setStatusLoading(true);
    setStatus(null);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send?action=get-status", {
        body: { company_id: company?.id },
      });
      if (error) throw new Error(error.message);
      setStatus(data as Record<string, string>);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao verificar status");
    } finally {
      setStatusLoading(false);
    }
  };

  const syncHistory = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send?action=sync-history", {
        body: { company_id: company?.id },
      });
      if (error || (data && data.success === false)) {
        throw new Error((data?.results?.[0]?.error as string) || error?.message || "Falha ao sincronizar");
      }
      toast.success("Sincronização iniciada! O histórico vai aparecer no Chat aos poucos (pode levar alguns minutos).");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao sincronizar histórico");
    } finally {
      setSyncing(false);
    }
  };

  // O Evolution devolve com o prefixo data: em algumas versões e sem ele em
  // outras; normalizar aqui evita a imagem quebrada.
  const qrSrc = qr && (qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`);

  const connected = instanceState === "open";

  return (
    <div className="max-w-2xl">
      <PageHeader
        icon={SettingsIcon}
        title="Configurações"
        description="Conexão do WhatsApp e integrações da empresa"
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Como o WhatsApp conecta</CardTitle>
          <CardDescription>
            Ler o QR code conecta qualquer número em segundos. A Cloud API exige conta aprovada na Meta,
            mas é a única que envia template fora da janela de 24h.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              ["evolution", "QR code · Evolution", "Servidor próprio"],
              ["uazapi", "QR code · UAZAPI", "Serviço hospedado"],
              ["meta", "Cloud API · Datafy", "Credenciais da Meta"],
            ] as const).map(([value, title, hint]) => (
              <button
                key={value}
                type="button"
                onClick={() => setProvider(value)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  provider === value
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:bg-accent/50"
                }`}
              >
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>
          {config && config.provider !== provider && (
            <p className="mt-3 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              Esta empresa está usando{" "}
              <span className="font-medium text-foreground">
                {config.provider === "meta" ? "Cloud API" : `QR code · ${config.provider === "uazapi" ? "UAZAPI" : "Evolution"}`}
              </span>
              . A troca só vale depois de conectar/salvar abaixo, e o histórico de conversas continua o mesmo.
            </p>
          )}
        </CardContent>
      </Card>

      {provider !== "meta" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Conexão por QR code
              {connected && (
                <Badge variant="success">
                  <CheckCircle />
                  Conectado
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho. O código se renova
              sozinho enquanto esta tela estiver aberta — não precisa ter pressa.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {qrSrc && (
              <div className="flex flex-col items-center gap-3 rounded-lg border bg-card p-4">
                <img src={qrSrc} alt="QR code para conectar o WhatsApp" className="h-56 w-56" />
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Aguardando leitura — o código se renova sozinho
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Status:</span>
              <span className="font-medium">{STATE_LABEL[instanceState]}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void handleConnect()} disabled={connecting}>
                {connecting ? <Loader2 className="animate-spin" /> : <QrCode />}
                {connected ? "Gerar novo QR" : qr ? "Gerar outro QR" : "Conectar número"}
              </Button>
              <Button variant="outline" onClick={() => void checkInstanceStatus()} disabled={statusLoading}>
                {statusLoading && <Loader2 className="animate-spin" />}
                Verificar status
              </Button>
              {config?.provider === provider && (
                <Button variant="outline" onClick={() => void handleDisconnect()} disabled={connecting}>
                  <Unplug />
                  Desconectar
                </Button>
              )}
            </div>

            {provider === "uazapi" && config?.provider === "uazapi" && (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">Histórico do WhatsApp</p>
                <p className="text-xs text-muted-foreground">
                  Traz as conversas que já existiam no aparelho: cada número vira contato e as
                  mensagens entram no Chat com a data original. Grupos ficam de fora, e mídia antiga
                  entra como rótulo — o arquivo só vem no que chegar daqui para frente.
                </p>
                <Button variant="outline" onClick={() => void importHistory()} disabled={importing}>
                  {importing ? <Loader2 className="animate-spin" /> : <History />}
                  {importing ? "Importando..." : "Importar histórico"}
                </Button>
                {imported && (
                  <p className="text-xs text-muted-foreground">
                    {imported.done} de {imported.total} conversas · {imported.messages} mensagens ·{" "}
                    {imported.contacts} contatos novos
                  </p>
                )}
              </div>
            )}

            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              O webhook é apontado sozinho na criação — não precisa configurar nada no painel do Evolution.
              Campanhas nesse modo saem como texto livre: template aprovado só existe na Cloud API.
            </p>
          </CardContent>
        </Card>
      ) : (
      <>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>URL do Webhook</CardTitle>
          <CardDescription>
            Cole esta URL (e o Verify Token abaixo) na configuração de webhook do seu número no painel do
            Datafy. Todas as mensagens recebidas passarão a aparecer no Chat.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button
              size="icon"
              variant="outline"
              aria-label="Copiar URL do webhook"
              onClick={() => copyToClipboard(webhookUrl)}
            >
              <Copy />
            </Button>
          </div>
          <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            Marque os campos <span className="font-mono text-foreground">messages</span> e{" "}
            <span className="font-mono text-foreground">message_echoes</span> na assinatura do webhook.
            Sem o <span className="font-mono text-foreground">message_echoes</span>, o que a sua equipe
            responde pelo celular não aparece aqui no Chat — só o lado do cliente.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Conexão WhatsApp (Datafy)
            {config?.active && (
              <Badge variant="success">
                <CheckCircle />
                Configurado
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Pegue estas credenciais no painel do Datafy após conectar seu número.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isPending ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Nome de exibição (opcional)</Label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Loja Centro" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Phone Number ID</Label>
                  <Input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>WABA ID</Label>
                  <Input value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Access Token</Label>
                <Input
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="sk_live_..."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Verify Token (webhook)</Label>
                <div className="flex gap-2">
                  <Input readOnly value={verifyToken} className="font-mono text-xs" />
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Copiar verify token"
                    onClick={() => copyToClipboard(verifyToken)}
                  >
                    <Copy />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cole este valor no campo "verify token" do webhook no painel do Datafy.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSave} disabled={saveConfig.isPending}>
                  {saveConfig.isPending ? "Salvando..." : "Salvar configuração"}
                </Button>
                {config && (
                  <Button variant="outline" onClick={() => void checkStatus()} disabled={statusLoading}>
                    {statusLoading && <Loader2 className="animate-spin" />}
                    Verificar status
                  </Button>
                )}
                {config && (
                  <Button variant="outline" onClick={() => void syncHistory()} disabled={syncing}>
                    {syncing ? <Loader2 className="animate-spin" /> : <History />}
                    Sincronizar histórico
                  </Button>
                )}
              </div>

              {config && (
                <p className="text-xs text-muted-foreground">
                  Use "Sincronizar histórico" depois de conectar o número para importar as conversas e
                  contatos que já existiam no WhatsApp. É uma ação única por conexão e pode levar alguns
                  minutos para tudo aparecer no Chat.
                </p>
              )}

              {status && (
                <dl className="grid gap-x-4 gap-y-2 rounded-lg border bg-muted/40 p-4 text-sm sm:grid-cols-2">
                  {[
                    ["Número", status.display_phone_number],
                    ["Nome verificado", status.verified_name],
                    ["Qualidade", status.quality_rating],
                    ["Status", status.status],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                      <dd className="mt-0.5 font-medium">{value ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </CardContent>
      </Card>
      </>
      )}
    </div>
  );
}

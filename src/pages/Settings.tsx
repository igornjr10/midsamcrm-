import { useEffect, useState } from "react";
import { Copy, CheckCircle, Loader2, History, Settings as SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase, SUPABASE_URL } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWhatsappConfigQuery, useSaveWhatsappConfigMutation } from "@/hooks/queries";
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

export default function Settings() {
  const { user, company } = useAuth();
  const { data: config, isPending } = useWhatsappConfigQuery(company?.id);
  const saveConfig = useSaveWhatsappConfigMutation();

  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [verifyToken, setVerifyToken] = useState(generateVerifyToken());
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<Record<string, string> | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const webhookUrl = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  useEffect(() => {
    if (!config) return;
    setPhoneNumberId(config.phone_number_id);
    setWabaId(config.waba_id);
    setAccessToken(config.access_token);
    setVerifyToken(config.webhook_verify_token);
    setLabel(config.label ?? "");
  }, [config]);

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

  return (
    <div className="max-w-2xl">
      <PageHeader
        icon={SettingsIcon}
        title="Configurações"
        description="Conexão do WhatsApp e integrações da empresa"
      />

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
    </div>
  );
}

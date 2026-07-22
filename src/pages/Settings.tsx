import { useEffect, useState } from "react";
import { Copy, CheckCircle, Loader2, History } from "lucide-react";
import { toast } from "sonner";
import { supabase, SUPABASE_URL } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWhatsappConfigQuery, useSaveWhatsappConfigMutation } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
        body: {},
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
        body: {},
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
    <div className="max-w-2xl space-y-6">
      <h2 className="text-2xl font-bold">Configurações</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">URL do Webhook</CardTitle>
          <CardDescription>
            Cole esta URL (e o Verify Token abaixo) na configuração de webhook do seu número no painel do
            Datafy. Todas as mensagens recebidas passarão a aparecer no Chat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button size="icon" variant="outline" onClick={() => copyToClipboard(webhookUrl)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Conexão WhatsApp (Datafy)
            {config?.active && (
              <Badge variant="outline" className="gap-1 border-green-500/40 text-green-600">
                <CheckCircle className="h-3 w-3" />
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
                  <Button size="icon" variant="outline" onClick={() => copyToClipboard(verifyToken)}>
                    <Copy className="h-4 w-4" />
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
                    {statusLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Verificar status
                  </Button>
                )}
                {config && (
                  <Button variant="outline" className="gap-1.5" onClick={() => void syncHistory()} disabled={syncing}>
                    {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
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
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <p>Número: {status.display_phone_number ?? "—"}</p>
                  <p>Nome verificado: {status.verified_name ?? "—"}</p>
                  <p>Qualidade: {status.quality_rating ?? "—"}</p>
                  <p>Status: {status.status ?? "—"}</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

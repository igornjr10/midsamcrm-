// Conexão do número por QR code, para os provedores de instância
// (Evolution API e UAZAPI). Substitui a evolution-instance, que só sabia falar
// com um deles.
//
// As credenciais de servidor (key global do Evolution, admintoken da UAZAPI)
// ficam em secret da function: elas criam e apagam instância de qualquer
// empresa e nunca devem chegar ao browser. O que a empresa guarda em
// whatsapp_configs é só o token da própria instância.
//
// Ações (?action=):
//   connect     -> cria a instância se preciso e devolve o QR (base64)
//   status      -> estado da conexão (open/connecting/close)
//   disconnect  -> desconecta o número
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveCompanyId } from "../_shared/company.ts";
import * as evo from "../_shared/evolution.ts";
import * as uaz from "../_shared/uazapi.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type ConfigRow = {
  id: string;
  provider: string;
  api_base_url: string | null;
  instance_name: string | null;
  instance_id: string | null;
  instance_token: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "status";
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    const { companyId, error: companyError } = await resolveCompanyId(
      admin,
      user.id,
      body.company_id as string | undefined,
    );
    if (!companyId) return json({ error: companyError }, 403);

    const { data: configRaw } = await admin
      .from("whatsapp_configs")
      .select("id, provider, api_base_url, instance_name, instance_id, instance_token")
      .eq("company_id", companyId)
      .maybeSingle();
    const config = configRaw as ConfigRow | null;

    // Provedor pedido pelo front (ao conectar pela primeira vez) ou o que a
    // empresa já usa.
    const provider = (body.provider as string | undefined)?.trim() || config?.provider || "evolution";
    if (provider !== "evolution" && provider !== "uazapi") {
      return json({ error: `Provedor sem conexão por QR: ${provider}` }, 400);
    }

    const serverBase = Deno.env.get(
      provider === "uazapi" ? "UAZAPI_BASE_URL" : "EVOLUTION_BASE_URL",
    )?.trim();
    const serverKey = Deno.env.get(
      provider === "uazapi" ? "UAZAPI_ADMIN_TOKEN" : "EVOLUTION_API_KEY",
    )?.trim();
    if (!serverBase || !serverKey) {
      return json({ error: `Servidor ${provider} não configurado nos secrets da function.` }, 500);
    }

    // Instância utilizável = existe, é do provedor pedido e tem token.
    const ready =
      !!config && config.provider === provider && !!config.instance_token && !!config.instance_name;

    const base = config?.api_base_url || serverBase;
    const evoTarget = (): evo.EvolutionTarget => ({
      base, apikey: config!.instance_token!, instance: config!.instance_name!,
    });
    const uazTarget = (): uaz.UazapiTarget => ({ base, token: config!.instance_token! });

    const readState = async () =>
      provider === "uazapi" ? await uaz.instanceState(uazTarget()) : await evo.instanceState(evoTarget());

    if (action === "status") {
      if (!ready) return json({ connected: false, state: "none" });
      const { state, error } = await readState();
      if (error) return json({ connected: false, state: "unknown", error }, 200);
      return json({ connected: state === "open", state, instance: config!.instance_name });
    }

    if (action === "disconnect") {
      if (!ready) return json({ error: "Nenhuma instância conectada." }, 400);
      const { ok, error } = provider === "uazapi"
        ? await uaz.logoutInstance(uazTarget())
        : await evo.logoutInstance(evoTarget());
      if (!ok) return json({ error: error ?? "Falha ao desconectar" }, 502);
      return json({ ok: true });
    }

    if (action === "connect") {
      const webhookBase = `${supabaseUrl}/functions/v1/whatsapp-webhook`;

      // Instância já existe: só um QR novo (o anterior expira em segundos).
      if (ready) {
        const { state } = await readState();
        if (state === "open") {
          return json({ connected: true, state, instance: config!.instance_name });
        }
        const res = provider === "uazapi"
          ? await uaz.connectInstance(uazTarget())
          : await evo.connectInstance(evoTarget());
        if (res.error) return json({ error: res.error }, 502);
        return json({ connected: false, state, qr: res.qrBase64, pairing_code: res.pairingCode });
      }

      // Nome derivado do company_id: único por construção e sem espaço. Os nomes
      // escolhidos à mão no painel se repetem e não serviriam de chave.
      const instanceName = `crm-${companyId}`;

      let instanceId: string | null = null;
      let instanceToken: string | null = null;
      let qr: string | null = null;
      let pairing: string | null = null;

      if (provider === "uazapi") {
        const { instance, error } = await uaz.createInstance(serverBase, serverKey, instanceName);
        if (!instance?.token || error) return json({ error: error ?? "Falha ao criar instância" }, 502);
        instanceId = instance.instanceId;
        instanceToken = instance.token;

        // O token vai na query: é ele que identifica a empresa quando o evento
        // chega, sem depender de achar um campo dentro do payload.
        const hook = await uaz.setInstanceWebhook(
          { base: serverBase, token: instance.token },
          `${webhookBase}?uazapi=${encodeURIComponent(instance.token)}`,
        );
        if (!hook.ok) return json({ error: hook.error ?? "Falha ao apontar o webhook" }, 502);

        const conn = await uaz.connectInstance({ base: serverBase, token: instance.token });
        if (conn.error) return json({ error: conn.error }, 502);
        qr = conn.qrBase64;
        pairing = conn.pairingCode;
      } else {
        // No Evolution o webhook vai junto na criação e o QR volta na resposta.
        const { instance, error } = await evo.createInstance(
          serverBase, serverKey, instanceName, webhookBase,
        );
        if (!instance?.token || error) return json({ error: error ?? "Falha ao criar instância" }, 502);
        instanceId = instance.instanceId;
        instanceToken = instance.token;
        qr = instance.qrBase64;
        pairing = instance.pairingCode;
      }

      // Guarda antes de mostrar o QR: se o usuário fechar a tela depois de
      // escanear, a conexão já está vinculada à empresa e o webhook acha a rota.
      const { error: saveError } = await admin
        .from("whatsapp_configs")
        .upsert({
          ...(config?.id ? { id: config.id } : {}),
          user_id: user.id,
          company_id: companyId,
          provider,
          api_base_url: serverBase,
          instance_name: instanceName,
          instance_id: instanceId,
          instance_token: instanceToken,
          active: true,
        }, { onConflict: "company_id" });
      if (saveError) return json({ error: saveError.message }, 400);

      return json({
        connected: false,
        state: "connecting",
        qr,
        pairing_code: pairing,
        instance: instanceName,
      });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (error) {
    console.error("whatsapp-instance error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Erro interno" }, 500);
  }
});

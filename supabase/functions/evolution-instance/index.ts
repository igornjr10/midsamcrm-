// Conexão do número via Evolution API: cria a instância, devolve o QR code e
// informa o estado da conexão.
//
// A key global do servidor Evolution fica em secret da function, não no banco:
// ela cria e apaga instância de todas as empresas, e nunca deve chegar ao
// browser. O que a empresa guarda em whatsapp_configs é só o token da própria
// instância, que o webhook usa para se rotear.
//
// Ações (?action=):
//   connect     -> cria a instância se preciso e devolve o QR (base64)
//   status      -> estado da conexão (open/connecting/close)
//   disconnect  -> desconecta o número, mantendo a instância
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveCompanyId } from "../_shared/company.ts";
import * as evo from "../_shared/evolution.ts";

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

    const evolutionBase = Deno.env.get("EVOLUTION_BASE_URL")?.trim();
    const globalApiKey = Deno.env.get("EVOLUTION_API_KEY")?.trim();
    if (!evolutionBase || !globalApiKey) {
      return json({ error: "Servidor Evolution não configurado (EVOLUTION_BASE_URL / EVOLUTION_API_KEY)." }, 500);
    }

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

    const hasInstance =
      config?.provider === "evolution" && !!config.instance_name && !!config.instance_token;

    const target = (): evo.EvolutionTarget => ({
      base: config!.api_base_url || evolutionBase,
      apikey: config!.instance_token!,
      instance: config!.instance_name!,
    });

    if (action === "status") {
      if (!hasInstance) return json({ connected: false, state: "none" });
      const { state, error } = await evo.instanceState(target());
      if (error) return json({ connected: false, state: "unknown", error }, 200);
      return json({ connected: state === "open", state, instance: config!.instance_name });
    }

    if (action === "disconnect") {
      if (!hasInstance) return json({ error: "Nenhuma instância conectada." }, 400);
      const { ok, error } = await evo.logoutInstance(target());
      if (!ok) return json({ error: error ?? "Falha ao desconectar" }, 502);
      return json({ ok: true });
    }

    if (action === "connect") {
      const webhookUrl = `${supabaseUrl}/functions/v1/whatsapp-webhook`;

      // Instância já existe: só um QR novo (o anterior expira em cerca de 1 min).
      if (hasInstance) {
        const { state } = await evo.instanceState(target());
        if (state === "open") {
          return json({ connected: true, state, instance: config!.instance_name });
        }
        const { qrBase64, pairingCode, error } = await evo.connectInstance(target());
        if (error) return json({ error }, 502);
        return json({ connected: false, state, qr: qrBase64, pairing_code: pairingCode });
      }

      // Nome derivado do company_id: único por construção e sem espaço. Os nomes
      // do painel se repetem ("vitor hugo" duas vezes) e não serviriam.
      const instanceName = `crm-${companyId}`;

      const { instance, error } = await evo.createInstance(
        evolutionBase,
        globalApiKey,
        instanceName,
        webhookUrl,
      );
      if (!instance || error) return json({ error: error ?? "Falha ao criar instância" }, 502);
      if (!instance.token) {
        return json({ error: "O servidor Evolution não devolveu o token da instância." }, 502);
      }

      // Guarda antes de mostrar o QR: se o usuário fechar a tela depois de
      // escanear, a conexão já está vinculada à empresa e o webhook acha a rota.
      const { error: saveError } = await admin
        .from("whatsapp_configs")
        .upsert({
          ...(config?.id ? { id: config.id } : {}),
          user_id: user.id,
          company_id: companyId,
          provider: "evolution",
          api_base_url: evolutionBase,
          instance_name: instance.instanceName,
          instance_id: instance.instanceId,
          instance_token: instance.token,
          active: true,
        }, { onConflict: "company_id" });
      if (saveError) return json({ error: saveError.message }, 400);

      return json({
        connected: false,
        state: "connecting",
        qr: instance.qrBase64,
        pairing_code: instance.pairingCode,
        instance: instance.instanceName,
      });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (error) {
    console.error("evolution-instance error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Erro interno" }, 500);
  }
});

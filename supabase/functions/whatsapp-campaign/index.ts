// Disparo em massa de templates aprovados pela Meta.
//
// Ações (?action=):
//   create   -> { name, template_name, template_language, template_body, variable_map, contact_ids[] }
//   dispatch -> { campaign_id, batch_size? }  processa um lote de pendentes
//   cancel   -> { campaign_id }
//
// O envio é feito em lotes curtos porque a edge function tem limite de tempo:
// o front chama "dispatch" em loop até remaining chegar a zero, o que também
// dá a barra de progresso de graça.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { parseWhatsAppApiError } from "../_shared/whatsapp-error.ts";
import { normalizePhone } from "../_shared/phone.ts";
import { resolveCompanyId } from "../_shared/company.ts";
import {
  buildTemplatePayload,
  renderTemplateText,
  type VariableMap,
} from "../_shared/whatsapp-template.ts";
import * as evo from "../_shared/evolution.ts";

/** Mesma convenção do follow-up de texto (sdr-followup/renderMessage). */
function renderPlaceholders(template: string, contactName: string | null): string {
  const name = (contactName ?? "").trim();
  const firstName = name.split(/\s+/)[0] ?? "";
  return template
    .replace(/\{\{\s*nome\s*\}\}/gi, name)
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, firstName)
    .trim();
}

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

function resolveApiBase(raw: string | null | undefined): string {
  return (raw?.trim() || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Espaçamento entre envios: evita estourar o rate limit do número.
const SEND_INTERVAL_MS = 150;
const DEFAULT_BATCH_SIZE = 25;
// Margem de segurança para devolver a resposta antes do timeout da function.
const BATCH_BUDGET_MS = 60_000;

type Contact = { id: string; name: string | null; phone: string | null; email: string | null };

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

    const supabase = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "dispatch";
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    // Empresa ativa no front (super admin pode estar operando a conta de um
    // cliente); sem company_id, cai na empresa do próprio usuário.
    const { companyId, error: companyError } = await resolveCompanyId(
      supabase,
      user.id,
      body.company_id as string | undefined,
    );
    if (!companyId) return json({ error: companyError }, 403);

    // ── create ───────────────────────────────────────────────────────────────
    if (action === "create") {
      const name = (body.name as string | undefined)?.trim();
      const templateName = (body.template_name as string | undefined)?.trim();
      const contactIds = (body.contact_ids as string[] | undefined) ?? [];

      if (!name) return json({ error: "Dê um nome para a campanha." }, 400);
      if (contactIds.length === 0) return json({ error: "Selecione ao menos um contato." }, 400);

      // No Evolution não existe template aprovado: a campanha é o próprio texto,
      // que fica em template_body e passa pelo mesmo render de variáveis.
      const { data: providerRow } = await supabase
        .from("whatsapp_configs")
        .select("provider")
        .eq("company_id", companyId)
        .maybeSingle();
      const isEvolution = (providerRow as { provider?: string } | null)?.provider === "evolution";

      if (isEvolution) {
        if (!(body.template_body as string | undefined)?.trim()) {
          return json({ error: "Escreva a mensagem da campanha." }, 400);
        }
      } else if (!templateName) {
        return json({ error: "Escolha um template aprovado." }, 400);
      }

      const { data: contactsRaw, error: contactsError } = await supabase
        .from("contacts")
        .select("id, name, phone, email")
        .eq("company_id", companyId)
        .in("id", contactIds.slice(0, 5000));
      if (contactsError) return json({ error: contactsError.message }, 400);

      // Um destinatário por número: contatos duplicados receberiam a mesma
      // mensagem duas vezes e ainda derrubariam a qualidade do número.
      const byPhone = new Map<string, Contact>();
      for (const contact of (contactsRaw ?? []) as Contact[]) {
        if (!contact.phone?.trim()) continue;
        const phone = normalizePhone(contact.phone);
        if (phone.length < 10 || byPhone.has(phone)) continue;
        byPhone.set(phone, contact);
      }
      if (byPhone.size === 0) {
        return json({ error: "Nenhum dos contatos selecionados tem telefone válido." }, 400);
      }

      const { data: campaign, error: campaignError } = await supabase
        .from("campaigns")
        .insert({
          company_id: companyId,
          user_id: user.id,
          name,
          // template_name é not null no schema; sem template real, marca a origem.
          template_name: templateName || "texto-livre",
          template_language: (body.template_language as string | undefined)?.trim() || "pt_BR",
          template_body: (body.template_body as string | undefined) ?? null,
          variable_map: (body.variable_map as VariableMap | undefined) ?? {},
          status: "running",
          total_count: byPhone.size,
          started_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (campaignError) return json({ error: campaignError.message }, 400);

      const { error: targetsError } = await supabase.from("campaign_targets").insert(
        [...byPhone.entries()].map(([phone, contact]) => ({
          campaign_id: campaign.id,
          company_id: companyId,
          contact_id: contact.id,
          phone,
        })),
      );
      if (targetsError) {
        await supabase.from("campaigns").delete().eq("id", campaign.id);
        return json({ error: targetsError.message }, 400);
      }

      return json({ campaign, skipped: contactIds.length - byPhone.size });
    }

    // ── cancel ───────────────────────────────────────────────────────────────
    if (action === "cancel") {
      const campaignId = body.campaign_id as string | undefined;
      if (!campaignId) return json({ error: "campaign_id é obrigatório" }, 400);
      const { error } = await supabase
        .from("campaigns")
        .update({ status: "canceled", finished_at: new Date().toISOString() })
        .eq("id", campaignId)
        .eq("company_id", companyId);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    // ── dispatch ─────────────────────────────────────────────────────────────
    if (action !== "dispatch") return json({ error: `Ação desconhecida: ${action}` }, 400);

    const campaignId = body.campaign_id as string | undefined;
    if (!campaignId) return json({ error: "campaign_id é obrigatório" }, 400);

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!campaign) return json({ error: "Campanha não encontrada." }, 404);
    if (campaign.status !== "running") {
      return json({ done: true, status: campaign.status, remaining: 0, sent: 0, failed: 0 });
    }

    const { data: config } = await supabase
      .from("whatsapp_configs")
      .select("phone_number_id, access_token, api_base_url, active, provider, instance_name, instance_token")
      .eq("company_id", companyId)
      .maybeSingle();
    if (!config?.active) {
      return json({ error: "WhatsApp não configurado ou desativado." }, 400);
    }
    const isEvolution = config.provider === "evolution";
    const evoTarget: evo.EvolutionTarget = {
      base: config.api_base_url as string,
      apikey: (config.instance_token as string) ?? "",
      instance: (config.instance_name as string) ?? "",
    };

    const batchSize = Math.min(Number(body.batch_size) || DEFAULT_BATCH_SIZE, 50);
    const { data: targets } = await supabase
      .from("campaign_targets")
      .select("id, phone, contact_id, contacts(id, name, phone, email)")
      .eq("campaign_id", campaignId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(batchSize);

    const graphBase = resolveApiBase(config.api_base_url as string);
    const graphHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.access_token}`,
    };
    const variableMap = (campaign.variable_map ?? {}) as VariableMap;

    let sent = 0;
    let failed = 0;
    const startedAt = Date.now();

    for (const target of (targets ?? []) as Array<{
      id: string;
      phone: string;
      contact_id: string | null;
      contacts: Contact | null;
    }>) {
      if (Date.now() - startedAt > BATCH_BUDGET_MS) break;

      const contact = target.contacts ?? { name: null, phone: target.phone, email: null };
      const { payload, bodyParams } = buildTemplatePayload(
        target.phone,
        campaign.template_name,
        campaign.template_language,
        variableMap,
        contact,
      );

      // O texto que o contato recebe — e que também vai para o histórico do chat.
      //
      // No Evolution a campanha é texto livre, com os mesmos placeholders do
      // follow-up ({{nome}}, {{primeiro_nome}}); na Meta são as variáveis
      // numeradas do template, que o buildTemplatePayload já resolveu.
      const renderedText = isEvolution
        ? renderPlaceholders(campaign.template_body ?? "", contact.name)
        : campaign.template_body
          ? renderTemplateText(campaign.template_body, bodyParams)
          : `[template: ${campaign.template_name}]`;

      try {
        let wamid: string | null;

        if (isEvolution) {
          const { messageId, error } = await evo.sendText(evoTarget, target.phone, renderedText);
          if (error) throw new Error(error);
          wamid = messageId;
        } else {
          const res = await fetch(`${graphBase}/${config.phone_number_id}/messages`, {
            method: "POST",
            headers: graphHeaders,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(20_000),
          });

          if (!res.ok) {
            const raw = await res.text().catch(() => "");
            throw new Error(parseWhatsAppApiError(raw));
          }

          const data = await res.json().catch(() => ({})) as { messages?: Array<{ id?: string }> };
          wamid = data.messages?.[0]?.id ?? null;
        }

        await supabase
          .from("campaign_targets")
          .update({ status: "sent", message_ref: wamid, sent_at: new Date().toISOString(), error: null })
          .eq("id", target.id);

        // Espelha no chat para o histórico do contato ficar completo.
        if (target.contact_id) {
          await supabase.from("conversations").insert({
            user_id: campaign.user_id,
            company_id: companyId,
            contact_id: target.contact_id,
            sender: "user",
            content: renderedText,
            channel: "whatsapp",
            message_ref: wamid,
            metadata: {
              deliveryStatus: "sent",
              isTemplate: !isEvolution,
              ...(isEvolution ? {} : { template: campaign.template_name }),
              campaignId,
            },
          });
        }
        sent++;
      } catch (err) {
        await supabase
          .from("campaign_targets")
          .update({
            status: "failed",
            error: (err instanceof Error ? err.message : "Erro no envio").slice(0, 500),
          })
          .eq("id", target.id);
        failed++;
      }

      await sleep(SEND_INTERVAL_MS);
    }

    await supabase.rpc("recount_campaign", { p_campaign_id: campaignId });

    const { count: remaining } = await supabase
      .from("campaign_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "pending");

    return json({ sent, failed, remaining: remaining ?? 0, done: (remaining ?? 0) === 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno";
    console.error("whatsapp-campaign error:", message);
    return json({ error: message }, 200);
  }
});

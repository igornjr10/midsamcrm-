// Envio de mensagens WhatsApp (Meta/Datafy Cloud API) para a conta logada.
//
// Ações (?action=):
//   send-text      -> { phone, text, contact_id }
//   send-media     -> { phone, mediaUrl, mediaType, mimetype?, caption?, contact_id }
//   send-template  -> { phone, template_name, template_language, variable_map?, template_body?, contact_id }
//   list-templates -> templates da WABA (só os aprovados pela Meta)
//   get-status     -> verifica saúde da conexão do número
//
// verify_jwt=false no config.toml (preflight OPTIONS não tem Authorization);
// o JWT do usuário é validado manualmente aqui.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { assertWhatsAppResponse } from "../_shared/whatsapp-error.ts";
import { normalizePhone } from "../_shared/phone.ts";
import { resolveCompanyId } from "../_shared/company.ts";
import * as evo from "../_shared/evolution.ts";
import * as uaz from "../_shared/uazapi.ts";
import {
  buildTemplatePayload,
  renderTemplateText,
  type VariableMap,
} from "../_shared/whatsapp-template.ts";

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

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "send-text";
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    // Empresa ativa no front (super admin pode estar operando a conta de um
    // cliente); sem company_id, cai na empresa do próprio usuário.
    const { companyId, error: companyError } = await resolveCompanyId(
      supabaseAdmin,
      user.id,
      body.company_id as string | undefined,
    );
    if (!companyId) return json({ error: companyError }, 403);

    const { data: config } = await supabaseAdmin
      .from("whatsapp_configs")
      .select("id, company_id, phone_number_id, waba_id, access_token, api_base_url, active, provider, instance_name, instance_token")
      .eq("company_id", companyId)
      .maybeSingle();

    if (!config) return json({ error: "WhatsApp não configurado. Conecte seu número em Configurações." }, 400);
    if (!config.active) return json({ error: "Configuração de WhatsApp desativada." }, 400);

    // Registra a mensagem enviada para o chat mostrar imediatamente. Igual nos
    // dois provedores — só o id da mensagem muda de origem.
    const recordSent = async (
      contactId: string | undefined,
      wamid: string | null,
      content: string,
      metadata: Record<string, unknown>,
    ) => {
      if (!contactId) return;
      await supabaseAdmin.from("conversations").insert({
        user_id: user.id,
        company_id: companyId,
        contact_id: contactId,
        sender: "user",
        content,
        channel: "whatsapp",
        message_ref: wamid,
        metadata: { ...metadata, deliveryStatus: "sent" },
      });
    };

    if (config.provider === "uazapi") {
      const target: uaz.UazapiTarget = {
        base: config.api_base_url as string,
        token: config.instance_token as string,
      };

      if (action === "get-status") {
        const { state, error } = await uaz.instanceState(target);
        if (error) return json({ error }, 502);
        return json({ state, connected: state === "open", instance: config.instance_name });
      }

      // Template é conceito da Meta; no Baileys tudo é texto livre.
      if (action === "list-templates") return json({ templates: [] });
      if (action === "send-template") {
        return json({ error: "Templates não existem na UAZAPI — envie como texto." }, 400);
      }
      if (action === "sync-history") {
        return json({ error: "Importação de histórico só existe na Cloud API." }, 400);
      }

      const phone = body.phone as string | undefined;
      const contactId = body.contact_id as string | undefined;
      if (!phone) return json({ error: "phone é obrigatório" }, 400);

      if (action === "send-text") {
        const text = (body.text as string | undefined)?.trim();
        if (!text) return json({ error: "text é obrigatório" }, 400);
        const { messageId, error } = await uaz.sendText(target, normalizePhone(phone), text);
        if (error) return json({ success: false, error }, 200);
        await recordSent(contactId, messageId, text, {});
        return json({ success: true, message_id: messageId });
      }

      if (action === "send-media") {
        const mediaUrl = body.mediaUrl as string | undefined;
        if (!mediaUrl) return json({ error: "mediaUrl é obrigatório" }, 400);
        const mediaType = (body.mediaType as string | undefined) ?? "document";
        const caption = (body.caption as string | undefined) ?? "";

        const { messageId, error } = await uaz.sendMedia(target, normalizePhone(phone), {
          url: mediaUrl,
          type: mediaType,
          caption,
        });
        if (error) return json({ success: false, error }, 200);
        await recordSent(contactId, messageId, caption || `[${mediaType}]`, {
          mediaUrl, mediaType, mimetype: body.mimetype ?? null,
        });
        return json({ success: true, message_id: messageId });
      }

      return json({ error: `Ação desconhecida: ${action}` }, 400);
    }

    if (config.provider === "evolution") {
      const target: evo.EvolutionTarget = {
        base: config.api_base_url as string,
        apikey: config.instance_token as string,
        instance: config.instance_name as string,
      };

      if (action === "get-status") {
        const { state, error } = await evo.instanceState(target);
        if (error) return json({ error }, 502);
        return json({ state, connected: state === "open", instance: config.instance_name });
      }

      // Template é conceito da Meta: aprovação da WABA, componentes, variáveis
      // numeradas. No Baileys tudo é texto livre, então a tela de Campanhas
      // manda send-text nessas empresas.
      if (action === "list-templates") return json({ templates: [] });
      if (action === "send-template") {
        return json({ error: "Templates não existem no Evolution — envie como texto." }, 400);
      }
      if (action === "sync-history") {
        return json({ error: "Importação de histórico só existe na Cloud API." }, 400);
      }

      const phone = body.phone as string | undefined;
      const contactId = body.contact_id as string | undefined;
      if (!phone) return json({ error: "phone é obrigatório" }, 400);

      if (action === "send-text") {
        const text = (body.text as string | undefined)?.trim();
        if (!text) return json({ error: "text é obrigatório" }, 400);
        const { messageId, error } = await evo.sendText(target, normalizePhone(phone), text);
        if (error) return json({ success: false, error }, 200);
        await recordSent(contactId, messageId, text, {});
        return json({ success: true, message_id: messageId });
      }

      if (action === "send-media") {
        const mediaUrl = body.mediaUrl as string | undefined;
        if (!mediaUrl) return json({ error: "mediaUrl é obrigatório" }, 400);
        const mediaType = (body.mediaType as string | undefined) ?? "document";
        const caption = (body.caption as string | undefined) ?? "";

        // Sem o upload em duas etapas da Meta: o Evolution baixa a URL sozinho.
        const { messageId, error } = await evo.sendMedia(target, normalizePhone(phone), {
          url: mediaUrl,
          type: mediaType,
          mimetype: body.mimetype as string | undefined,
          caption,
        });
        if (error) return json({ success: false, error }, 200);
        await recordSent(contactId, messageId, caption || `[${mediaType}]`, {
          mediaUrl, mediaType, mimetype: body.mimetype ?? null,
        });
        return json({ success: true, message_id: messageId });
      }

      return json({ error: `Ação desconhecida: ${action}` }, 400);
    }

    const graphBase = resolveApiBase(config.api_base_url as string);
    const graphHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.access_token}`,
    };

    if (action === "get-status") {
      const res = await fetch(
        `${graphBase}/${config.phone_number_id}?fields=display_phone_number,verified_name,quality_rating,status`,
        { headers: graphHeaders, signal: AbortSignal.timeout(15_000) },
      );
      const data = await res.json().catch(() => ({}));
      return json(data, res.ok ? 200 : res.status);
    }

    if (action === "list-templates") {
      if (!config.waba_id) {
        return json({ error: "WABA ID não configurado. Preencha em Configurações." }, 400);
      }
      const res = await fetch(
        `${graphBase}/${config.waba_id}/message_templates?limit=200&fields=name,status,category,language,components`,
        { headers: graphHeaders, signal: AbortSignal.timeout(20_000) },
      );
      const data = await res.json().catch(() => ({})) as {
        data?: Array<Record<string, unknown>>;
        error?: { message?: string };
      };
      if (!res.ok) {
        return json({ error: data.error?.message ?? "Falha ao listar templates." }, 200);
      }
      const approved = (data.data ?? []).filter((t) => String(t.status).toUpperCase() === "APPROVED");
      return json({ templates: approved });
    }

    if (action === "sync-history") {
      // Datafy: importa histórico de conversas + contatos do WhatsApp Business App.
      // É one-shot por integração; o resultado chega depois via webhook (value.history).
      const results: Array<Record<string, unknown>> = [];
      for (const syncType of ["history", "smb_app_state_sync"]) {
        const r = await fetch(`${graphBase}/${config.phone_number_id}/smb_app_data`, {
          method: "POST",
          headers: graphHeaders,
          body: JSON.stringify({ messaging_product: "whatsapp", sync_type: syncType }),
          signal: AbortSignal.timeout(15_000),
        });
        const rJson = await r.json().catch(() => ({}));
        results.push({ sync_type: syncType, status: r.status, ...rJson });
      }
      const allOk = results.every((r) => Number(r.status) < 400);
      return json({ success: allOk, results }, 200);
    }

    const phone = body.phone as string | undefined;
    const contactId = body.contact_id as string | undefined;
    if (!phone) return json({ error: "phone é obrigatório" }, 400);

    let sendResponse: Response;
    let sentContent = "";
    let sentMetadata: Record<string, unknown> = {};

    if (action === "send-text") {
      const text = body.text as string | undefined;
      if (!text?.trim()) return json({ error: "text é obrigatório" }, 400);
      sentContent = text.trim();

      sendResponse = await fetch(`${graphBase}/${config.phone_number_id}/messages`, {
        method: "POST",
        headers: graphHeaders,
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: normalizePhone(phone),
          type: "text",
          text: { preview_url: false, body: sentContent },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } else if (action === "send-media") {
      const mediaUrl = body.mediaUrl as string | undefined;
      const mediaType = (body.mediaType as string | undefined) ?? "document";
      const mimetype = (body.mimetype as string | undefined) ?? "";
      const caption = (body.caption as string | undefined) ?? "";
      if (!mediaUrl) return json({ error: "mediaUrl é obrigatório" }, 400);

      const waType = ["image", "video", "audio", "document"].includes(mediaType) ? mediaType : "document";

      // Upload do binário via /media e envio referenciando o id — enviar {link}
      // falha silenciosamente em alguns provedores (aprendido no care-build-hub).
      const fileResp = await fetch(mediaUrl, { signal: AbortSignal.timeout(30_000) });
      if (!fileResp.ok) return json({ error: "Não foi possível baixar o arquivo de mídia." }, 502);
      const fileBlob = await fileResp.blob();
      const uploadMimetype = mimetype || fileBlob.type || "application/octet-stream";

      const uploadForm = new FormData();
      uploadForm.append("messaging_product", "whatsapp");
      uploadForm.append("file", fileBlob, `media-${Date.now()}`);
      uploadForm.append("type", uploadMimetype);

      const uploadResp = await fetch(`${graphBase}/${config.phone_number_id}/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.access_token}` },
        body: uploadForm,
        signal: AbortSignal.timeout(60_000),
      });
      const uploadData = await uploadResp.json().catch(() => null) as { id?: string } | null;
      if (!uploadResp.ok || !uploadData?.id) {
        return json(uploadData ?? { error: "Falha no upload da mídia." }, uploadResp.ok ? 502 : uploadResp.status);
      }

      sentContent = caption || `[${waType}]`;
      sentMetadata = { mediaUrl, mediaType: waType, mimetype: uploadMimetype };

      sendResponse = await fetch(`${graphBase}/${config.phone_number_id}/messages`, {
        method: "POST",
        headers: graphHeaders,
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: normalizePhone(phone),
          type: waType,
          [waType]: {
            id: uploadData.id,
            ...(caption ? { caption } : {}),
            ...(waType === "audio" ? { voice: true } : {}),
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } else if (action === "send-template") {
      const templateName = body.template_name as string | undefined;
      if (!templateName?.trim()) return json({ error: "template_name é obrigatório" }, 400);

      const language = (body.template_language as string | undefined)?.trim() || "pt_BR";
      const variableMap = (body.variable_map as VariableMap | undefined) ?? {};
      const templateBody = (body.template_body as string | undefined) ?? "";

      const { data: contact } = contactId
        ? await supabaseAdmin
            .from("contacts")
            .select("name, phone, email")
            .eq("id", contactId)
            .eq("company_id", companyId)
            .maybeSingle()
        : { data: null };

      const { payload, bodyParams } = buildTemplatePayload(
        normalizePhone(phone),
        templateName.trim(),
        language,
        variableMap,
        (contact as { name?: string; phone?: string; email?: string } | null) ?? { phone },
      );

      sentContent = templateBody
        ? renderTemplateText(templateBody, bodyParams)
        : `[template: ${templateName.trim()}]`;
      sentMetadata = { template: templateName.trim(), templateLanguage: language, isTemplate: true };

      sendResponse = await fetch(`${graphBase}/${config.phone_number_id}/messages`, {
        method: "POST",
        headers: graphHeaders,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
    } else {
      return json({ error: `Ação desconhecida: ${action}` }, 400);
    }

    await assertWhatsAppResponse(sendResponse.clone());
    const sendData = await sendResponse.json().catch(() => ({})) as {
      messages?: Array<{ id?: string }>;
    };
    const wamid = sendData.messages?.[0]?.id ?? null;

    await recordSent(contactId, wamid, sentContent, sentMetadata);

    return json({ success: true, message_id: wamid });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno";
    console.error("whatsapp-send error:", message);
    return json({ success: false, error: message }, 200);
  }
});

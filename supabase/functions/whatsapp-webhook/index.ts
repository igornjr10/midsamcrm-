// Webhook de entrada do WhatsApp (Meta/Datafy Cloud API).
//
// GET  -> handshake de verificação (hub.mode/hub.verify_token/hub.challenge)
// POST -> mensagens recebidas + status de entrega + resposta automática do SDR IA
//
// Todas as empresas apontam o webhook do Datafy para esta mesma URL; a empresa
// dona da mensagem é resolvida pelo metadata.phone_number_id do payload.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

type WhatsappMessage = {
  id: string;
  from?: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
};

type WhatsappStatus = {
  id: string;
  status: string;
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
};

type WhatsappContact = { wa_id: string; profile?: { name?: string } };

type WhatsappConfig = {
  id: string;
  user_id: string;
  company_id: string;
  phone_number_id: string;
  access_token: string;
  api_base_url: string;
};

type AiConfig = {
  enabled: boolean;
  system_prompt: string | null;
  model: string;
  openai_api_key: string | null;
};

async function updateDeliveryStatus(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  status: WhatsappStatus,
): Promise<void> {
  const normalized =
    status.status.includes("read") ? "read" :
    status.status.includes("deliver") ? "delivered" :
    status.status.includes("fail") || status.status.includes("error") ? "failed" :
    "sent";

  const { data } = await supabase
    .from("conversations")
    .select("id, metadata")
    .eq("company_id", companyId)
    .eq("message_ref", status.id)
    .maybeSingle();
  if (!data?.id) return;

  const currentMetadata =
    data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? data.metadata as Record<string, unknown>
      : {};

  const firstError = status.errors?.[0];
  await supabase
    .from("conversations")
    .update({
      metadata: {
        ...currentMetadata,
        deliveryStatus: normalized,
        whatsappStatus: status.status,
        ...(firstError
          ? {
              deliveryError: {
                code: firstError.code,
                title: firstError.title,
                message: firstError.message,
                details: firstError.error_data?.details,
              },
            }
          : {}),
      },
    })
    .eq("id", data.id);
}

// Baixa a mídia da Meta/Datafy e sobe para o bucket chat-media.
async function downloadMedia(
  mediaId: string,
  config: WhatsappConfig,
  msgId: string,
  mimetype: string,
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
): Promise<string | null> {
  const base = resolveApiBase(config.api_base_url);
  const host = base.replace(/\/v\d+(\.\d+)?$/, "");

  const candidates: string[] = [];
  let resolvedMime = mimetype;

  const readUrl = async (endpoint: string): Promise<void> => {
    try {
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${config.access_token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return;
      const j = await res.json().catch(() => null) as { url?: string; mime_type?: string } | null;
      if (!j?.url) return;
      if (!candidates.includes(j.url)) candidates.push(j.url);
      if (j.mime_type) resolvedMime = j.mime_type;
    } catch {
      // tenta o próximo endpoint
    }
  };

  await readUrl(`${base}/${mediaId}`);
  await readUrl(`${host}/media/${mediaId}`);

  let bytes: Uint8Array | null = null;

  if (candidates.length === 0) {
    // Fallback Datafy: binário direto em /media/{id}
    try {
      const datafyUrl = `${host}/media/${mediaId}`;
      let binRes = await fetch(datafyUrl, {
        headers: { Authorization: `Bearer ${config.access_token}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!binRes.ok && (binRes.status === 401 || binRes.status === 403)) {
        binRes = await fetch(datafyUrl, { signal: AbortSignal.timeout(30_000) });
      }
      if (binRes.ok) {
        const ct = binRes.headers.get("content-type") || "";
        if (/^(audio|video|image|application\/pdf)/i.test(ct)) {
          bytes = new Uint8Array(await binRes.arrayBuffer());
          resolvedMime = ct.split(";")[0].trim() || resolvedMime;
        }
      }
    } catch (e) {
      console.error("downloadMedia: fallback binário falhou", e instanceof Error ? e.message : "unknown");
    }
    if (!bytes) return null;
  } else {
    for (const url of candidates) {
      try {
        let fileRes = await fetch(url, {
          headers: { Authorization: `Bearer ${config.access_token}` },
          signal: AbortSignal.timeout(30_000),
        });
        if (!fileRes.ok && (fileRes.status === 401 || fileRes.status === 403)) {
          fileRes = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        }
        if (!fileRes.ok) continue;
        bytes = new Uint8Array(await fileRes.arrayBuffer());
        break;
      } catch {
        // tenta a próxima candidata
      }
    }
    if (!bytes) return null;
  }

  const extMap: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "video/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3",
    "application/pdf": "pdf",
  };
  const mimeKey = resolvedMime.split(";")[0].trim();
  const ext = extMap[mimeKey] || "bin";
  const filePath = `${config.company_id}/${msgId}.${ext}`;

  const { error } = await supabase.storage
    .from("chat-media")
    .upload(filePath, bytes, { contentType: mimeKey, upsert: true });
  if (error) {
    console.error("downloadMedia: upload falhou", error.message);
    return null;
  }

  return `${supabaseUrl}/storage/v1/object/public/chat-media/${filePath}`;
}

async function findOrCreateContact(
  supabase: ReturnType<typeof createClient>,
  config: WhatsappConfig,
  phone: string,
  displayName: string | null,
): Promise<{ id: string; ai_paused: boolean } | null> {
  const { data: existing } = await supabase.rpc("find_contact_by_phone", {
    p_company_id: config.company_id,
    p_phone: phone,
  });
  const found = (existing as Array<{ id: string; ai_paused: boolean }> | null)?.[0];
  if (found?.id) return { id: found.id, ai_paused: found.ai_paused ?? false };

  const { data: created, error } = await supabase
    .from("contacts")
    .insert({
      user_id: config.user_id,
      company_id: config.company_id,
      name: displayName?.trim() || phone,
      phone,
      stage: "new",
    })
    .select("id, ai_paused")
    .maybeSingle();
  if (error) {
    console.error("findOrCreateContact: insert falhou", error.message);
    return null;
  }
  return created ? { id: created.id as string, ai_paused: false } : null;
}

async function sendWhatsappText(config: WhatsappConfig, phone: string, text: string): Promise<string | null> {
  const base = resolveApiBase(config.api_base_url);
  const res = await fetch(`${base}/${config.phone_number_id}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.access_token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "text",
      text: { preview_url: false, body: text },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.error("sendWhatsappText falhou", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = await res.json().catch(() => ({})) as { messages?: Array<{ id?: string }> };
  return data.messages?.[0]?.id ?? null;
}

// SDR IA: gera e envia a resposta automática quando habilitada para a empresa.
async function maybeAiReply(
  supabase: ReturnType<typeof createClient>,
  config: WhatsappConfig,
  contact: { id: string; ai_paused: boolean },
  fromPhone: string,
): Promise<void> {
  if (contact.ai_paused) return;

  const { data: aiConfigRaw } = await supabase
    .from("ai_configs")
    .select("enabled, system_prompt, model, openai_api_key")
    .eq("company_id", config.company_id)
    .maybeSingle();
  const aiConfig = aiConfigRaw as AiConfig | null;
  if (!aiConfig?.enabled) return;

  const apiKey = aiConfig.openai_api_key?.trim() || Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("maybeAiReply: sem OPENAI_API_KEY configurada");
    return;
  }

  const { data: history } = await supabase
    .from("conversations")
    .select("sender, content")
    .eq("contact_id", contact.id)
    .order("created_at", { ascending: false })
    .limit(12);

  const messages = [
    {
      role: "system",
      content:
        aiConfig.system_prompt?.trim() ||
        "Você é um atendente comercial simpático e objetivo. Responda em português do Brasil, em mensagens curtas de WhatsApp, qualificando o interesse do cliente e coletando nome e necessidade. Nunca invente preços ou prazos.",
    },
    ...((history ?? []) as Array<{ sender: string; content: string }>)
      .slice()
      .reverse()
      .map((m) => ({
        role: m.sender === "contact" ? "user" : "assistant",
        content: m.content,
      })),
  ];

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model || "gpt-4o-mini",
        messages,
        max_tokens: 300,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error("maybeAiReply: LLM error", res.status, await res.text().catch(() => ""));
      return;
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) return;

    const wamid = await sendWhatsappText(config, fromPhone, reply);
    if (!wamid) return;

    await supabase.from("conversations").insert({
      user_id: config.user_id,
      company_id: config.company_id,
      contact_id: contact.id,
      sender: "ai",
      content: reply,
      channel: "whatsapp",
      message_ref: wamid,
      metadata: { deliveryStatus: "sent" },
    });
  } catch (e) {
    console.error("maybeAiReply: exception", e instanceof Error ? e.message : "unknown");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── GET: verificação do webhook ─────────────────────────────────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const { data: configs } = await supabase
      .from("whatsapp_configs")
      .select("webhook_verify_token")
      .eq("active", true);

    const valid =
      mode === "subscribe" &&
      !!token &&
      (configs ?? []).some((c) => (c as { webhook_verify_token: string }).webhook_verify_token === token);

    if (valid) return new Response(challenge ?? "", { status: 200 });
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const payload = await req.json();
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    if (!value) return json({ ok: true, ignored: "no value" });

    const phoneNumberId: string | undefined = value.metadata?.phone_number_id;
    if (!phoneNumberId) return json({ ok: true, ignored: "no phone_number_id" });

    const { data: configRaw } = await supabase
      .from("whatsapp_configs")
      .select("id, user_id, company_id, phone_number_id, access_token, api_base_url")
      .eq("phone_number_id", phoneNumberId)
      .eq("active", true)
      .maybeSingle();

    const config = configRaw as WhatsappConfig | null;
    if (!config) return json({ error: "Unknown phone number" }, 404);

    for (const status of (value.statuses ?? []) as WhatsappStatus[]) {
      await updateDeliveryStatus(supabase, config.company_id, status);
    }

    const contacts = (value.contacts ?? []) as WhatsappContact[];
    const nameByWaId = new Map(contacts.map((c) => [c.wa_id, c.profile?.name ?? null]));

    for (const msg of (value.messages ?? []) as WhatsappMessage[]) {
      if (!msg.from) continue;

      const { data: dup } = await supabase
        .from("conversations")
        .select("id")
        .eq("company_id", config.company_id)
        .eq("message_ref", msg.id)
        .maybeSingle();
      if (dup?.id) continue;

      let content = "";
      let mediaUrl: string | null = null;
      let mediaType: string | null = null;
      let mimetype: string | null = null;

      if (msg.type === "text") {
        content = msg.text?.body ?? "";
      } else if (msg.type === "image" && msg.image?.id) {
        mediaType = "image";
        mimetype = msg.image.mime_type ?? "image/jpeg";
        content = msg.image.caption ?? "[Imagem]";
        mediaUrl = await downloadMedia(msg.image.id, config, msg.id, mimetype, supabase, supabaseUrl);
      } else if (msg.type === "document" && msg.document?.id) {
        mediaType = "document";
        mimetype = msg.document.mime_type ?? "application/pdf";
        content = msg.document.caption ?? msg.document.filename ?? "[Documento]";
        mediaUrl = await downloadMedia(msg.document.id, config, msg.id, mimetype, supabase, supabaseUrl);
      } else {
        content = `[${msg.type}]`;
      }

      if (!content && !mediaUrl) continue;

      const contact = await findOrCreateContact(supabase, config, msg.from, nameByWaId.get(msg.from) ?? null);
      if (!contact) continue;

      await supabase.from("conversations").insert({
        user_id: config.user_id,
        company_id: config.company_id,
        contact_id: contact.id,
        sender: "contact",
        content,
        channel: "whatsapp",
        message_ref: msg.id,
        metadata: {
          ...(mediaUrl ? { mediaUrl, mediaType, mimetype } : {}),
          wa_timestamp: msg.timestamp ?? null,
        },
      });

      // SDR IA responde só a mensagens de texto (mídia fica para o humano).
      if (msg.type === "text" && content) {
        await maybeAiReply(supabase, config, contact, msg.from);
      }
    }

    return json({ ok: true });
  } catch (error) {
    console.error("whatsapp-webhook error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Internal error" }, 500);
  }
});

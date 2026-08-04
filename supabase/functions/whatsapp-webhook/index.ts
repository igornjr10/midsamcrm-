// Webhook de entrada do WhatsApp (Meta/Datafy Cloud API).
//
// GET  -> handshake de verificação (hub.mode/hub.verify_token/hub.challenge)
// POST -> mensagens recebidas + status de entrega + resposta automática do SDR IA
//
// Todas as empresas apontam o webhook do Datafy para esta mesma URL; a empresa
// dona da mensagem é resolvida pelo metadata.phone_number_id do payload.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// Cliente com service role. Sem os genéricos explícitos o ReturnType resolve
// para os defaults (never) e não aceita o cliente real.
type Db = ReturnType<typeof createClient<any, "public", any>>;

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
  // Presente nos echoes (mensagens que a empresa enviou): destinatário.
  // Cada provedor usa um nome diferente para o mesmo campo.
  to?: string;
  recipient_id?: string;
  wa_id?: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
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
  supabase: Db,
  companyId: string,
  status: WhatsappStatus,
): Promise<void> {
  const normalized =
    status.status.includes("read") ? "read" :
    status.status.includes("deliver") ? "delivered" :
    status.status.includes("fail") || status.status.includes("error") ? "failed" :
    "sent";

  const firstError = status.errors?.[0];

  // Disparo em massa: reflete entrega/leitura/falha no destinatário da campanha.
  const { data: target } = await supabase
    .from("campaign_targets")
    .select("id, campaign_id")
    .eq("company_id", companyId)
    .eq("message_ref", status.id)
    .maybeSingle();
  if (target?.id) {
    await supabase
      .from("campaign_targets")
      .update({
        status: normalized,
        ...(firstError
          ? { error: (firstError.message ?? firstError.title ?? "Falha na entrega").slice(0, 500) }
          : {}),
      })
      .eq("id", target.id);
    await supabase.rpc("recount_campaign", { p_campaign_id: target.campaign_id });
  }

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
// Devolve também os bytes: o áudio precisa deles para a transcrição, e baixar
// de novo pela URL pública seria uma volta desnecessária.
type DownloadedMedia = { url: string; bytes: Uint8Array; mime: string };

async function downloadMedia(
  mediaId: string,
  config: WhatsappConfig,
  msgId: string,
  mimetype: string,
  supabase: Db,
  supabaseUrl: string,
): Promise<DownloadedMedia | null> {
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

  return {
    url: `${supabaseUrl}/storage/v1/object/public/chat-media/${filePath}`,
    bytes,
    mime: mimeKey,
  };
}

// Transcreve o áudio do lead. Sem isso o SDR IA recebe "[Áudio]" e responde no
// escuro — e boa parte dos leads manda áudio em vez de digitar.
async function transcribeAudio(
  media: DownloadedMedia,
  apiKey: string,
): Promise<string | null> {
  const extByMime: Record<string, string> = {
    "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mpeg": "mp3",
    "audio/mp4": "m4a", "audio/aac": "m4a", "audio/amr": "amr", "audio/wav": "wav",
  };
  const ext = extByMime[media.mime] ?? "ogg";

  try {
    const form = new FormData();
    // O nome do arquivo importa: a API decide o decoder pela extensão.
    // Cópia para ArrayBuffer: o Uint8Array do fetch pode vir sobre
    // SharedArrayBuffer, que o BlobPart não aceita.
    const buffer = media.bytes.slice().buffer as ArrayBuffer;
    form.append("file", new Blob([buffer], { type: media.mime }), `audio.${ext}`);
    form.append("model", "whisper-1");
    form.append("language", "pt");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.error("transcribeAudio falhou", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json() as { text?: string };
    return data.text?.trim() || null;
  } catch (e) {
    console.error("transcribeAudio: exception", e instanceof Error ? e.message : "unknown");
    return null;
  }
}

// Texto + mídia (já baixada para o bucket) de uma mensagem do webhook.
// Vale tanto para o que chega do cliente quanto para os echoes do celular.
async function extractContent(
  msg: WhatsappMessage,
  config: WhatsappConfig,
  supabase: Db,
  supabaseUrl: string,
  openaiKey: string | null,
): Promise<{
  content: string;
  mediaUrl: string | null;
  mediaType: string | null;
  mimetype: string | null;
  transcript: string | null;
}> {
  const media = async (
    id: string | undefined,
    type: "image" | "video" | "audio" | "document",
    fallbackMime: string,
    caption: string,
  ) => {
    const base = { mediaType: type, mimetype: fallbackMime, transcript: null as string | null };
    if (!id) return { content: caption, mediaUrl: null, ...base };

    const downloaded = await downloadMedia(id, config, msg.id, fallbackMime, supabase, supabaseUrl);
    if (!downloaded) return { content: caption, mediaUrl: null, ...base };

    // O texto do áudio vira o conteúdo da mensagem: é ele que alimenta o
    // histórico da IA, a busca e o sinal de fechamento. O áudio continua no
    // bucket para ouvir no chat.
    if (type === "audio" && openaiKey) {
      const transcript = await transcribeAudio(downloaded, openaiKey);
      if (transcript) {
        return {
          content: transcript,
          mediaUrl: downloaded.url,
          ...base,
          mimetype: downloaded.mime,
          transcript,
        };
      }
    }

    return { content: caption, mediaUrl: downloaded.url, ...base, mimetype: downloaded.mime };
  };

  switch (msg.type) {
    case "text":
      return { content: msg.text?.body ?? "", mediaUrl: null, mediaType: null, mimetype: null, transcript: null };
    case "image":
      return await media(msg.image?.id, "image", msg.image?.mime_type ?? "image/jpeg", msg.image?.caption ?? "[Imagem]");
    case "video":
      return await media(msg.video?.id, "video", msg.video?.mime_type ?? "video/mp4", msg.video?.caption ?? "[Vídeo]");
    case "audio":
      return await media(msg.audio?.id, "audio", msg.audio?.mime_type ?? "audio/ogg", "[Áudio]");
    case "document":
      return await media(
        msg.document?.id,
        "document",
        msg.document?.mime_type ?? "application/pdf",
        msg.document?.caption ?? msg.document?.filename ?? "[Documento]",
      );
    default:
      return { content: `[${msg.type}]`, mediaUrl: null, mediaType: null, mimetype: null, transcript: null };
  }
}

// Destinatário de um echo (mensagem que saiu do número da empresa).
function echoRecipient(msg: WhatsappMessage): string | null {
  const raw = msg.to ?? msg.recipient_id ?? msg.wa_id ?? null;
  const digits = raw ? String(raw).replace(/\D/g, "") : "";
  return digits || null;
}

// Grava a mensagem ignorando duplicata pelo wamid.
//
// Não dá para usar upsert(onConflict) aqui: o índice único de conversations é
// parcial (where message_ref is not null) e o PostgREST não envia o predicado,
// então o Postgres rejeita o ON CONFLICT com 42P10.
async function insertMessage(
  supabase: Db,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("conversations").insert(row as never);
  if (!error) return;
  if (error.code === "23505") return; // já gravada por outro webhook
  console.error("insertMessage falhou", error.code, error.message);
}

// wamids que já estão gravados, para pular antes de baixar mídia.
async function existingRefs(
  supabase: Db,
  companyId: string,
  refs: string[],
): Promise<Set<string>> {
  if (refs.length === 0) return new Set();
  const { data } = await supabase
    .from("conversations")
    .select("message_ref")
    .eq("company_id", companyId)
    .in("message_ref", refs);
  return new Set(((data ?? []) as Array<{ message_ref: string }>).map((r) => r.message_ref));
}

async function findOrCreateContact(
  supabase: Db,
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
  supabase: Db,
  config: WhatsappConfig,
  contact: { id: string; ai_paused: boolean },
  fromPhone: string,
  aiConfig: AiConfig | null,
  apiKey: string | null,
): Promise<void> {
  if (contact.ai_paused) return;
  if (!aiConfig?.enabled) return;
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

// Processa um único change do payload (statuses, mensagens, echoes, histórico).
// A Meta manda entry[].changes[] — echoes e mensagens costumam vir em changes
// distintos (campos "messages" e "smb_message_echoes"), por isso cada change é
// tratado separadamente.
async function processChange(
  supabase: Db,
  supabaseUrl: string,
  field: string,
  value: Record<string, any>,
): Promise<void> {
  const phoneNumberId: string | undefined = value.metadata?.phone_number_id;
  if (!phoneNumberId) {
    console.log("webhook: change sem phone_number_id", field, Object.keys(value).join(","));
    return;
  }

  const { data: configRaw } = await supabase
    .from("whatsapp_configs")
    .select("id, user_id, company_id, phone_number_id, access_token, api_base_url")
    .eq("phone_number_id", phoneNumberId)
    .eq("active", true)
    .maybeSingle();

  const config = configRaw as WhatsappConfig | null;
  if (!config) {
    console.log("webhook: phone_number_id desconhecido", phoneNumberId);
    return;
  }

  for (const status of (value.statuses ?? []) as WhatsappStatus[]) {
    await updateDeliveryStatus(supabase, config.company_id, status);
  }

  // Uma leitura só por webhook: serve à transcrição do áudio e à resposta da
  // IA. A transcrição não depende do SDR estar ligado — o áudio transcrito vale
  // para o humano ler no chat de qualquer forma.
  const { data: aiConfigRaw } = await supabase
    .from("ai_configs")
    .select("enabled, system_prompt, model, openai_api_key")
    .eq("company_id", config.company_id)
    .maybeSingle();
  const aiConfig = aiConfigRaw as AiConfig | null;
  const openaiKey = aiConfig?.openai_api_key?.trim() || Deno.env.get("OPENAI_API_KEY") || null;

  const contacts = (value.contacts ?? []) as WhatsappContact[];
  const nameByWaId = new Map(contacts.map((c) => [c.wa_id, c.profile?.name ?? null]));

  // Número da própria empresa: o que sai dele é mensagem enviada, não recebida.
  const businessPhone = String(value.metadata?.display_phone_number ?? "").replace(/\D/g, "");

  const incoming = (value.messages ?? []) as WhatsappMessage[];

  // Echoes: chegam em "message_echoes" (Coexistence) e, em alguns provedores,
  // dentro de "messages" com o from sendo o próprio número da empresa.
  const echoes = [
    ...((value.message_echoes ?? []) as WhatsappMessage[]),
    ...incoming.filter((m) => !!businessPhone && m.from?.replace(/\D/g, "") === businessPhone),
  ];
  const echoIds = new Set(echoes.map((e) => e.id));

  if (echoes.length > 0) console.log(`webhook: ${echoes.length} echo(s) em "${field}"`);

  // ── Mensagens recebidas do cliente ─────────────────────────────────────────────
  for (const msg of incoming) {
    if (!msg.from || echoIds.has(msg.id)) continue;

    const { data: dup } = await supabase
      .from("conversations")
      .select("id")
      .eq("company_id", config.company_id)
      .eq("message_ref", msg.id)
      .maybeSingle();
    if (dup?.id) continue;

    const { content, mediaUrl, mediaType, mimetype, transcript } =
      await extractContent(msg, config, supabase, supabaseUrl, openaiKey);
    if (!content && !mediaUrl) continue;

    const contact = await findOrCreateContact(supabase, config, msg.from, nameByWaId.get(msg.from) ?? null);
    if (!contact) continue;

    await insertMessage(supabase, {
      user_id: config.user_id,
      company_id: config.company_id,
      contact_id: contact.id,
      sender: "contact",
      content,
      channel: "whatsapp",
      message_ref: msg.id,
      metadata: {
        ...(mediaUrl ? { mediaUrl, mediaType, mimetype } : {}),
        ...(transcript ? { transcribed: true } : {}),
        wa_timestamp: msg.timestamp ?? null,
      },
    });

    // Texto e áudio transcrito seguem para o SDR: nos dois casos existe uma
    // frase real do lead para responder. Imagem e documento ficam com o humano.
    if (content && (msg.type === "text" || transcript)) {
      await maybeAiReply(supabase, config, contact, msg.from, aiConfig, openaiKey);
    }
  }

  // ── Mensagens enviadas pelo celular (Coexistence: message_echoes) ─────────
  // Quando o número está no app do WhatsApp Business e na API ao mesmo tempo,
  // o que o time responde pelo celular chega aqui — sem isso o CRM só mostra um
  // lado da conversa. Também cobre o eco do que o próprio CRM enviou, que é
  // descartado por já existir com o mesmo wamid.
  const knownEchoes = await existingRefs(supabase, config.company_id, echoes.map((e) => e.id).filter(Boolean));

  for (const echo of echoes) {
    const contactPhone = echoRecipient(echo);
    if (!contactPhone || !echo.id || knownEchoes.has(echo.id)) continue;

    // Áudio que a empresa enviou não é transcrito: o custo não se paga, ninguém
    // precisa ler de volta o que o próprio time gravou.
    const { content, mediaUrl, mediaType, mimetype } =
      await extractContent(echo, config, supabase, supabaseUrl, null);
    if (!content && !mediaUrl) continue;

    const contact = await findOrCreateContact(supabase, config, contactPhone, null);
    if (!contact) continue;

    await insertMessage(supabase, {
      user_id: config.user_id,
      company_id: config.company_id,
      contact_id: contact.id,
      sender: "user",
      content,
      channel: "whatsapp",
      message_ref: echo.id,
      created_at: echo.timestamp
        ? new Date(Number(echo.timestamp) * 1000).toISOString()
        : new Date().toISOString(),
      metadata: {
        ...(mediaUrl ? { mediaUrl, mediaType, mimetype } : {}),
        wa_timestamp: echo.timestamp ?? null,
        source: "echo",
        deliveryStatus: "sent",
      },
    });
  }

  // ── Sincronização de histórico (Datafy smb_app_data) ────────────────────────
  // Chega em vários webhooks assíncronos após "trigger-history-sync".
  // value.history[].threads[].messages[] — cada thread é uma conversa.
  // A IA nunca responde a mensagens de histórico (só importa).
  for (const chunk of (value.history ?? []) as Array<Record<string, unknown>>) {
    for (const thread of (chunk.threads ?? []) as Array<Record<string, unknown>>) {
      const phone = String(thread.id ?? "").replace(/\D/g, "");
      if (!phone) continue;

      const contact = await findOrCreateContact(supabase, config, phone, null);
      if (!contact) continue;

      const rows: Array<Record<string, unknown>> = [];
      for (const m of (thread.messages ?? []) as Array<Record<string, unknown>>) {
        const wamid = String(m.id ?? "");
        if (!wamid) continue;
        const type = String(m.type ?? "");
        let text: string | null = null;
        if (type === "text") text = String((m.text as Record<string, unknown>)?.body ?? "").trim() || null;
        else if (type === "image") text = "[Imagem]";
        else if (type === "video") text = "[Vídeo]";
        else if (type === "audio") text = "[Áudio]";
        else if (type === "document") text = "[Documento]";
        else if (type === "sticker") text = "[Sticker]";
        else if (type === "location") text = "[Localização]";
        else if (type === "revoke") text = "[Mensagem apagada]";
        else if (["reaction", "system", "edit", "unsupported"].includes(type)) text = null;
        else text = `[${type}]`;
        if (!text) continue;

        const fromMe = (m.history_context as Record<string, unknown>)?.from_me === true;
        const ts = Number(m.timestamp ?? 0);
        rows.push({
          user_id: config.user_id,
          company_id: config.company_id,
          contact_id: contact.id,
          sender: fromMe ? "user" : "contact",
          content: text,
          channel: "whatsapp",
          message_ref: wamid,
          created_at: ts ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
          metadata: { source: "history_sync" },
        });
      }
      if (rows.length === 0) continue;

      const known = await existingRefs(supabase, config.company_id, rows.map((r) => r.message_ref as string));
      const novos = rows.filter((r) => !known.has(r.message_ref as string));
      if (novos.length === 0) continue;

      const { error } = await supabase.from("conversations").insert(novos as never);
      // Colisão com outro webhook em paralelo: regrava uma a uma.
      if (error?.code === "23505") {
        for (const row of novos) await insertMessage(supabase, row);
      } else if (error) {
        console.error("history insert falhou:", error.code, error.message);
      }
    }
  }

  // ── Sincronização de contatos (Datafy smb_app_state_sync) ─────────────────
  for (const c of (value.state_sync ?? []) as Array<Record<string, unknown>>) {
    if (c.action !== "add") continue;
    const phone = String(c.wa_id ?? c.phone ?? "").replace(/\D/g, "");
    if (!phone) continue;
    const name = String(c.name ?? c.display_name ?? phone);
    await findOrCreateContact(supabase, config, phone, name);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── GET: verificação do webhook ───────────────────────────────────────────────
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
    const entries = (payload?.entry ?? []) as Array<Record<string, any>>;
    if (entries.length === 0) return json({ ok: true, ignored: "no entry" });

    // Um payload pode trazer vários changes (ex.: "messages" e
    // "smb_message_echoes" juntos). Ler só o primeiro descartava os echoes.
    let processed = 0;
    for (const entry of entries) {
      for (const change of (entry.changes ?? []) as Array<Record<string, any>>) {
        const value = change?.value;
        if (!value) continue;
        processed++;
        await processChange(supabase, supabaseUrl, String(change.field ?? "?"), value);
      }
    }

    if (processed === 0) {
      console.log("webhook: payload sem changes", JSON.stringify(payload).slice(0, 500));
    }

    return json({ ok: true });
  } catch (error) {
    console.error("whatsapp-webhook error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Internal error" }, 500);
  }
});

// Webhook de entrada do WhatsApp (Meta/Datafy Cloud API).
//
// GET  -> handshake de verificação (hub.mode/hub.verify_token/hub.challenge)
// POST -> mensagens recebidas + status de entrega
//
// Todas as contas apontam o webhook do Datafy para esta mesma URL; a conta
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
  video?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
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
  phone_number_id: string;
  access_token: string;
  api_base_url: string;
};

async function updateDeliveryStatus(
  supabase: ReturnType<typeof createClient>,
  userId: string,
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
    .eq("user_id", userId)
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
// Datafy tem duas peculiaridades tratadas aqui: o lookup pode estar em
// /media/{id} (não /{id}), e às vezes ele devolve o binário direto em vez
// de JSON {url}.
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
  const filePath = `${config.user_id}/${msgId}.${ext}`;

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
  userId: string,
  phone: string,
  displayName: string | null,
): Promise<string | null> {
  const { data: existing } = await supabase.rpc("find_contact_by_phone", {
    p_user_id: userId,
    p_phone: phone,
  });
  const found = (existing as Array<{ id: string }> | null)?.[0];
  if (found?.id) return found.id;

  const { data: created, error } = await supabase
    .from("contacts")
    .insert({
      user_id: userId,
      name: displayName?.trim() || phone,
      phone,
      stage: "new",
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("findOrCreateContact: insert falhou", error.message);
    return null;
  }
  return created?.id ?? null;
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
      .select("id, user_id, phone_number_id, access_token, api_base_url")
      .eq("phone_number_id", phoneNumberId)
      .eq("active", true)
      .maybeSingle();

    const config = configRaw as WhatsappConfig | null;
    if (!config) return json({ error: "Unknown phone number" }, 404);

    // Status de entrega (sent/delivered/read/failed)
    for (const status of (value.statuses ?? []) as WhatsappStatus[]) {
      await updateDeliveryStatus(supabase, config.user_id, status);
    }

    // Nome de exibição do contato, se veio no payload
    const contacts = (value.contacts ?? []) as WhatsappContact[];
    const nameByWaId = new Map(contacts.map((c) => [c.wa_id, c.profile?.name ?? null]));

    // Mensagens recebidas
    for (const msg of (value.messages ?? []) as WhatsappMessage[]) {
      if (!msg.from) continue;

      // Dedupe por wamid
      const { data: dup } = await supabase
        .from("conversations")
        .select("id")
        .eq("user_id", config.user_id)
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
        // video/audio/sticker/location/interactive/etc: registra só o tipo por enquanto
        content = `[${msg.type}]`;
      }

      if (!content && !mediaUrl) continue;

      const contactId = await findOrCreateContact(
        supabase,
        config.user_id,
        msg.from,
        nameByWaId.get(msg.from) ?? null,
      );
      if (!contactId) continue;

      await supabase.from("conversations").insert({
        user_id: config.user_id,
        contact_id: contactId,
        sender: "contact",
        content,
        channel: "whatsapp",
        message_ref: msg.id,
        metadata: {
          ...(mediaUrl ? { mediaUrl, mediaType, mimetype } : {}),
          wa_timestamp: msg.timestamp ?? null,
        },
      });
    }

    return json({ ok: true });
  } catch (error) {
    console.error("whatsapp-webhook error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Internal error" }, 500);
  }
});

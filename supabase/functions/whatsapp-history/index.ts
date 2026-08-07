// Importa o histórico de conversas do WhatsApp para o CRM (UAZAPI).
//
// Roda em lotes: uma chamada processa conversas até estourar o orçamento de
// tempo e devolve o offset seguinte, que o front usa para continuar. Sem isso a
// função morre no timeout em qualquer conta com movimento.
//
// Mídia entra também: cada arquivo custa um download na UAZAPI mais um upload
// para o bucket, então há um teto por chamada — o lote seguinte continua de
// onde parou, e uma conta com muito áudio simplesmente leva mais rodadas.
//
// O que não entra é transcrição de áudio antigo: seriam centenas de chamadas
// pagas à OpenAI de uma vez. Áudio histórico dá para ouvir; o que chegar pelo
// webhook daqui para frente continua sendo transcrito.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveCompanyId } from "../_shared/company.ts";
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

/** Margem para o lote fechar antes do limite da function. */
const BUDGET_MS = 45_000;
const CHATS_PER_CALL = 25;
const MESSAGES_PER_CHAT = 200;
/** Teto de arquivos por chamada: o resto fica para o lote seguinte. */
const MEDIA_PER_CALL = 30;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3",
  "audio/mp4": "m4a", "application/pdf": "pdf",
};

// Sem os genéricos explícitos o ReturnType resolve para os defaults (never) e
// não aceita o cliente real — mesmo motivo do alias no whatsapp-webhook.
// deno-lint-ignore no-explicit-any
type Db = ReturnType<typeof createClient<any, "public", any>>;

/** Baixa da UAZAPI e sobe para o bucket, devolvendo a URL pública. */
async function storeMedia(
  admin: Db,
  target: uaz.UazapiTarget,
  supabaseUrl: string,
  companyId: string,
  messageId: string,
): Promise<{ url: string; mime: string } | null> {
  const link = await uaz.downloadMedia(target, messageId);
  if (!link) return null;
  try {
    const res = await fetch(link.fileURL, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mime = (link.mimetype || "application/octet-stream").split(";")[0].trim();
    const path = `${companyId}/${messageId}.${EXT_BY_MIME[mime] ?? "bin"}`;

    const { error } = await admin.storage
      .from("chat-media")
      .upload(path, bytes, { contentType: mime, upsert: true });
    if (error) return null;

    return { url: `${supabaseUrl}/storage/v1/object/public/chat-media/${path}`, mime };
  } catch {
    return null;
  }
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

    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    const { companyId, error: companyError } = await resolveCompanyId(
      admin, user.id, body.company_id as string | undefined,
    );
    if (!companyId) return json({ error: companyError }, 403);

    const { data: configRaw } = await admin
      .from("whatsapp_configs")
      .select("user_id, provider, api_base_url, instance_token, active")
      .eq("company_id", companyId)
      .maybeSingle();
    const config = configRaw as {
      user_id: string; provider: string; api_base_url: string;
      instance_token: string | null; active: boolean;
    } | null;

    if (!config?.active) return json({ error: "WhatsApp não configurado ou desativado." }, 400);
    if (config.provider !== "uazapi" || !config.instance_token) {
      return json({ error: "A importação de histórico existe só na conexão por UAZAPI." }, 400);
    }

    const target: uaz.UazapiTarget = { base: config.api_base_url, token: config.instance_token };
    const offset = Math.max(0, Number(body.offset) || 0);

    const { chats, total, error: chatsError } = await uaz.findChats(target, {
      limit: CHATS_PER_CALL, offset,
    });
    if (chatsError) return json({ error: chatsError }, 502);

    const startedAt = Date.now();
    let importedMessages = 0;
    let processedChats = 0;
    let createdContacts = 0;
    let mediaDone = 0;

    for (const chat of chats) {
      processedChats += 1;
      if (Date.now() - startedAt > BUDGET_MS) break;

      // Grupo não vira contato do CRM — o funil é 1 a 1.
      if (chat.wa_isGroup) continue;
      const phone = uaz.jidToPhone(chat.wa_chatid);
      if (!phone) continue;

      const displayName =
        (chat.wa_contactName || chat.wa_name || chat.name || "").trim() || phone;

      // Reaproveita o contato existente pelo telefone; só cria se não houver.
      const { data: found } = await admin.rpc("find_contact_by_phone", {
        p_company_id: companyId, p_phone: phone,
      });
      let contactId = (found as Array<{ id: string }> | null)?.[0]?.id ?? null;

      if (!contactId) {
        const { data: created } = await admin
          .from("contacts")
          .insert({
            user_id: config.user_id,
            company_id: companyId,
            name: displayName,
            phone,
            stage: "new",
          })
          .select("id")
          .maybeSingle();
        contactId = (created as { id: string } | null)?.id ?? null;
        if (contactId) createdContacts += 1;
      }
      if (!contactId) continue;

      const { messages, error: msgError } = await uaz.findMessages(target, {
        chatid: chat.wa_chatid, limit: MESSAGES_PER_CHAT,
      });
      if (msgError || messages.length === 0) continue;

      // Uma consulta por conversa em vez de uma por mensagem.
      const ids = messages.map((m) => m.messageid).filter(Boolean);
      const { data: existing } = await admin
        .from("conversations")
        .select("id, message_ref, metadata")
        .eq("company_id", companyId)
        .in("message_ref", ids);
      const existingRows = (existing ?? []) as Array<{
        id: string; message_ref: string; metadata: Record<string, unknown> | null;
      }>;
      const known = new Set(existingRows.map((r) => r.message_ref));

      // Quem já foi importado antes de a mídia entrar no escopo ficou só com o
      // rótulo. Reimportar preenche o arquivo em vez de pular a linha.
      const semArquivo = new Map(
        existingRows
          .filter((r) => !(r.metadata && typeof r.metadata === "object" && r.metadata.mediaUrl))
          .map((r) => [r.message_ref, r]),
      );

      for (const m of messages) {
        if (mediaDone >= MEDIA_PER_CALL) break;
        const alvo = semArquivo.get(m.messageid);
        const kind = uaz.messageKind(m.messageType);
        if (!alvo || kind === "text" || kind === "other") continue;

        mediaDone += 1;
        const media = await storeMedia(admin, target, supabaseUrl, companyId, m.messageid);
        if (!media) continue;

        await admin
          .from("conversations")
          .update({
            metadata: {
              ...(alvo.metadata ?? {}),
              mediaType: kind,
              mediaUrl: media.url,
              mimetype: media.mime,
            },
          })
          .eq("id", alvo.id);
      }

      const novas = messages.filter((m) => m.messageid && !known.has(m.messageid));
      const rows: Array<Record<string, unknown>> = [];

      for (const m of novas) {
        const kind = uaz.messageKind(m.messageType);
        let media: { url: string; mime: string } | null = null;

        // Sem o arquivo, áudio e imagem antigos viram só um rótulo na tela.
        if (kind !== "text" && kind !== "other" && mediaDone < MEDIA_PER_CALL) {
          mediaDone += 1;
          media = await storeMedia(admin, target, supabaseUrl, companyId, m.messageid);
        }

        rows.push({
          user_id: config.user_id,
          company_id: companyId,
          contact_id: contactId,
          // fromMe = saiu do número da empresa; o resto é o cliente falando.
          sender: m.fromMe ? "user" : "contact",
          content: uaz.messageText(m),
          channel: "whatsapp",
          message_ref: m.messageid,
          // created_at é a data real da mensagem: sem isso o histórico inteiro
          // aparece empilhado no momento da importação.
          created_at: new Date(Number(m.messageTimestamp) || Date.now()).toISOString(),
          metadata: {
            imported: true,
            waType: m.messageType,
            ...(kind !== "text" ? { mediaType: kind } : {}),
            ...(media ? { mediaUrl: media.url, mimetype: media.mime } : {}),
          },
        });
      }

      if (rows.length > 0) {
        const { error: insertError } = await admin.from("conversations").insert(rows as never);
        // 23505 = corrida com o webhook gravando a mesma mensagem; não é falha.
        if (insertError && insertError.code !== "23505") {
          console.error("whatsapp-history: insert falhou", insertError.message);
        } else {
          importedMessages += rows.length;
        }
      }
    }

    const nextOffset = offset + processedChats;
    return json({
      done: nextOffset >= total || chats.length === 0,
      next_offset: nextOffset,
      total_chats: total,
      processed_chats: processedChats,
      imported_messages: importedMessages,
      created_contacts: createdContacts,
      media_files: mediaDone,
    });
  } catch (error) {
    console.error("whatsapp-history error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Erro interno" }, 500);
  }
});

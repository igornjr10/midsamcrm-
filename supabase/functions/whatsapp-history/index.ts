// Importa o histórico de conversas do WhatsApp para o CRM (UAZAPI).
//
// Roda em lotes: uma chamada processa conversas até estourar o orçamento de
// tempo e devolve o offset seguinte, que o front usa para continuar. Sem isso a
// função morre no timeout em qualquer conta com movimento.
//
// Só texto e legenda entram. Mídia histórica ficaria cara demais — cada arquivo
// exige uma chamada de download e um upload para o bucket, e são centenas.
// Mensagem de mídia entra com o rótulo ([Áudio], [Imagem]) e o que chegar dali
// para frente, pelo webhook, vem com o arquivo.
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
        .select("message_ref")
        .eq("company_id", companyId)
        .in("message_ref", ids);
      const known = new Set(
        ((existing ?? []) as Array<{ message_ref: string }>).map((r) => r.message_ref),
      );

      const rows = messages
        .filter((m) => m.messageid && !known.has(m.messageid))
        .map((m) => ({
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
            ...(uaz.messageKind(m.messageType) !== "text"
              ? { mediaType: uaz.messageKind(m.messageType) }
              : {}),
          },
        }));

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
    });
  } catch (error) {
    console.error("whatsapp-history error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Erro interno" }, 500);
  }
});

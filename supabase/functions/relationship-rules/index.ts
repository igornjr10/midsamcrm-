// Réguas de relacionamento: aniversário, reativação, NPS e as por data.
//
// Roda por cron, uma vez por dia é suficiente — nenhuma delas é urgente ao
// minuto. Percorre as réguas ligadas, pergunta ao banco quem deve receber
// (relationship_rule_targets faz o filtro e o cooldown) e envia.
//
// As réguas 'data' apontam para um campo de data do contato (vencimento,
// retorno, data do evento) e disparam N dias antes ou depois dele. A
// mensagem pode usar {{data}} e {{dias}} além de {{nome}}/{{primeiro_nome}}.
//
// Autenticação como no sdr-followup: service role ou x-cron-secret.
//
// Agendamento (uma vez por dia, 9h de Brasília = 12h UTC):
//   select cron.schedule('reguas-relacionamento', '0 12 * * *', $$
//     select net.http_post(
//       url := '<SUPABASE_URL>/functions/v1/relationship-rules',
//       headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
//       body := '{}'::jsonb
//     ) $$);
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { normalizePhone } from "../_shared/phone.ts";
import { localClock } from "../_shared/date.ts";
import { consumeCoins } from "../_shared/usage.ts";
import { hasFeature } from "../_shared/features.ts";
import { OUTBOUND_COLUMNS, renderPlaceholders, sendText, type OutboundConfig } from "../_shared/whatsapp-out.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
type Db = any;

type Rule = {
  id: string;
  company_id: string;
  kind: "aniversario" | "reativacao" | "nps" | "data" | "agenda" | "giftback";
  message: string;
  title: string | null;
  field_key: string | null;
  offset_days: number;
};

type Target = {
  contact_id: string;
  name: string | null;
  phone: string | null;
  /** Régua por data: o valor do campo, para {{data}}. */
  field_value: string | null;
  /** Régua sobre registro: o título dele (a apólice, o pacote), para {{titulo}}. */
  record_title: string | null;
};

/** "2026-10-12" -> "12/10/2026". O que não parece data volta como veio. */
function formatDate(value: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (value ?? "");
}

function renderDatePlaceholders(template: string, rule: Rule, target: Target): string {
  if (rule.kind !== "data") return template;
  return template
    .replace(/\{\{\s*data\s*\}\}/gi, formatDate(target.field_value))
    .replace(/\{\{\s*dias\s*\}\}/gi, String(Math.abs(rule.offset_days)))
    .replace(/\{\{\s*titulo\s*\}\}/gi, target.record_title ?? "")
    .replace(/\s{2,}/g, " ");
}

/** Espaçamento entre envios: o número não pode disparar em rajada. */
const SEND_INTERVAL_MS = 400;
/** Teto por régua por volta, para a function não estourar o tempo. */
const MAX_PER_RULE = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Janela educada de envio: 9h às 20h no fuso da empresa.
 *
 * Régua de relacionamento não tem urgência nenhuma, e "parabéns!" às 3 da manhã
 * é o tipo de automação que faz o cliente pedir para sair da lista. Fora da
 * janela, a volta não envia — o cron do dia seguinte pega.
 */
function insideWindow(timezone: string): boolean {
  const { hour } = localClock(timezone);
  return hour >= 9 && hour < 20;
}

async function runRule(
  supabase: Db,
  rule: Rule,
  config: OutboundConfig,
): Promise<{ sent: number; failed: number }> {
  const { data: targets } = await supabase.rpc("relationship_rule_targets", {
    p_rule_id: rule.id,
    p_limit: MAX_PER_RULE,
  });

  let sent = 0;
  let failed = 0;

  for (const target of (targets ?? []) as Target[]) {
    if (!target.phone) continue;

    const usage = await consumeCoins(supabase, rule.company_id, "followup_out", {
      contactId: target.contact_id,
      ref: rule.kind,
    });
    if (!usage.allowed) {
      console.log("relationship-rules: cota esgotada", rule.company_id);
      break;
    }

    const text = renderPlaceholders(renderDatePlaceholders(rule.message, rule, target), target.name);
    const { messageId, error } = await sendText(config, normalizePhone(target.phone), text);

    await supabase.from("relationship_logs").insert({
      company_id: rule.company_id,
      rule_id: rule.id,
      contact_id: target.contact_id,
      kind: rule.kind,
      status: error ? "failed" : "sent",
      content: text,
      message_ref: messageId,
      error,
    });

    if (error) {
      failed += 1;
    } else {
      sent += 1;
      // A mensagem também entra no chat: quem abrir a conversa amanhã precisa
      // ver o que a plataforma falou em nome dele.
      await supabase.from("conversations").insert({
        user_id: null,
        company_id: rule.company_id,
        contact_id: target.contact_id,
        sender: "ai",
        content: text,
        channel: "whatsapp",
        message_ref: messageId,
        metadata: {
          deliveryStatus: "sent",
          relationshipRule: rule.kind === "data" ? rule.title ?? "data" : rule.kind,
        },
      });

      // NPS: marca que perguntou. É essa data que autoriza o webhook a ler a
      // próxima resposta numérica como nota.
      if (rule.kind === "nps") {
        await supabase
          .from("contacts")
          .update({ nps_asked_at: new Date().toISOString() })
          .eq("id", target.contact_id);
      }
    }

    await sleep(SEND_INTERVAL_MS);
  }

  return { sent, failed };
}

type ReminderTarget = {
  appointment_id: string;
  contact_id: string;
  name: string | null;
  phone: string | null;
  title: string;
  starts_at: string;
  all_day: boolean;
  resource_name: string | null;
};

function fmtInTz(iso: string, timeZone: string) {
  const d = new Date(iso);
  const data = new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit" }).format(d);
  const dia = new Intl.DateTimeFormat("pt-BR", { timeZone, weekday: "long" }).format(d);
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(d);
  return { data, dia, hora };
}

/**
 * Lembrete do dia anterior. O alvo é o compromisso, não o contato: quem tem
 * dois horários amanhã recebe dois lembretes, cada um com sua hora.
 */
async function runAgendaRule(
  supabase: Db,
  rule: Rule,
  config: OutboundConfig,
  timezone: string,
): Promise<{ sent: number; failed: number }> {
  const { data: targets } = await supabase.rpc("appointment_reminder_targets", {
    p_company_id: rule.company_id,
  });

  let sent = 0;
  let failed = 0;

  for (const t of (targets ?? []) as ReminderTarget[]) {
    if (!t.phone) continue;

    const usage = await consumeCoins(supabase, rule.company_id, "followup_out", {
      contactId: t.contact_id,
      ref: "agenda",
    });
    if (!usage.allowed) break;

    const { data, dia, hora } = fmtInTz(t.starts_at, timezone);
    const text = renderPlaceholders(
      rule.message
        .replace(/\{\{\s*data\s*\}\}/gi, data)
        .replace(/\{\{\s*dia_semana\s*\}\}/gi, dia)
        .replace(/\{\{\s*hora\s*\}\}/gi, t.all_day ? "" : hora)
        .replace(/\s*às\s*\{\{\s*hora\s*\}\}/gi, t.all_day ? "" : ` às ${hora}`)
        .replace(/\{\{\s*titulo\s*\}\}/gi, t.title)
        .replace(/\{\{\s*recurso\s*\}\}/gi, t.resource_name ? ` com ${t.resource_name}` : "")
        .replace(/\s{2,}/g, " "),
      t.name,
    );
    const { messageId, error } = await sendText(config, normalizePhone(t.phone), text);

    await supabase.from("relationship_logs").insert({
      company_id: rule.company_id,
      rule_id: rule.id,
      contact_id: t.contact_id,
      kind: "agenda",
      status: error ? "failed" : "sent",
      content: text,
      message_ref: messageId,
      error,
    });

    if (error) {
      failed += 1;
    } else {
      sent += 1;
      await supabase.from("conversations").insert({
        user_id: null,
        company_id: rule.company_id,
        contact_id: t.contact_id,
        sender: "ai",
        content: text,
        channel: "whatsapp",
        message_ref: messageId,
        metadata: { deliveryStatus: "sent", relationshipRule: "agenda" },
      });
      // É esta data que autoriza o webhook a ler o próximo "1" ou "2" como resposta.
      await supabase
        .from("appointments")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", t.appointment_id);
    }

    await sleep(SEND_INTERVAL_MS);
  }

  return { sent, failed };
}

type GiftbackTarget = {
  id: string;
  code: string;
  value: number;
  expires_at: string;
  contact_id: string;
  contacts: { name: string | null; phone: string | null } | null;
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Giftback ativo vencendo em N dias (N em crm_giftback_settings). Um aviso por cupom. */
async function runGiftbackRule(
  supabase: Db,
  rule: Rule,
  config: OutboundConfig,
  timezone: string,
): Promise<{ sent: number; failed: number }> {
  const { data: cfg } = await supabase
    .from("crm_giftback_settings").select("reminder_days").eq("company_id", rule.company_id).maybeSingle();
  const days = Math.max(0, Number((cfg as { reminder_days?: number } | null)?.reminder_days ?? 3));
  const until = new Date(Date.now() + (days + 1) * 86_400_000).toISOString();

  const { data: targets } = await supabase
    .from("crm_coupons")
    .select("id, code, value, expires_at, contact_id, contacts(name, phone)")
    .eq("company_id", rule.company_id)
    .eq("kind", "giftback")
    .eq("status", "ativo")
    .is("reminder_sent_at", null)
    .not("contact_id", "is", null)
    .gt("expires_at", new Date().toISOString())
    .lte("expires_at", until)
    .limit(MAX_PER_RULE);

  let sent = 0;
  let failed = 0;
  for (const t of (targets ?? []) as GiftbackTarget[]) {
    const phone = t.contacts?.phone;
    if (!phone) continue;
    const usage = await consumeCoins(supabase, rule.company_id, "followup_out", { contactId: t.contact_id, ref: "giftback" });
    if (!usage.allowed) break;

    const validade = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit" }).format(new Date(t.expires_at));
    const text = renderPlaceholders(
      rule.message
        .replace(/\{\{\s*codigo\s*\}\}/gi, t.code)
        .replace(/\{\{\s*valor\s*\}\}/gi, brl(Number(t.value)))
        .replace(/\{\{\s*validade\s*\}\}/gi, validade),
      t.contacts?.name ?? null,
    );
    const { messageId, error } = await sendText(config, normalizePhone(phone), text);
    await supabase.from("relationship_logs").insert({
      company_id: rule.company_id, rule_id: rule.id, contact_id: t.contact_id, kind: "giftback",
      status: error ? "failed" : "sent", content: text, message_ref: messageId, error,
    });
    if (error) {
      failed += 1;
    } else {
      sent += 1;
      await supabase.from("conversations").insert({
        user_id: null, company_id: rule.company_id, contact_id: t.contact_id, sender: "ai", content: text,
        channel: "whatsapp", message_ref: messageId, metadata: { deliveryStatus: "sent", relationshipRule: "giftback" },
      });
      await supabase.from("crm_coupons").update({ reminder_sent_at: new Date().toISOString() }).eq("id", t.id);
    }
    await sleep(SEND_INTERVAL_MS);
  }
  return { sent, failed };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronSecret = Deno.env.get("CRON_SECRET");

  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  const allowed =
    token === serviceKey || (!!cronSecret && req.headers.get("x-cron-secret") === cronSecret);
  if (!allowed) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { data: rulesRaw } = await supabase
      .from("relationship_rules")
      .select("id, company_id, kind, message, title, field_key, offset_days")
      .eq("enabled", true);
    const rules = (rulesRaw ?? []) as Rule[];

    const results: Array<Record<string, unknown>> = [];

    for (const rule of rules) {
      // Régua é automação do SDR: empresa sem o módulo não dispara nada.
      if (!(await hasFeature(supabase, rule.company_id, "sdr"))) continue;

      const { data: configRaw } = await supabase
        .from("whatsapp_configs")
        .select(OUTBOUND_COLUMNS)
        .eq("company_id", rule.company_id)
        .eq("active", true)
        .maybeSingle();
      const config = configRaw as OutboundConfig | null;
      if (!config) continue;

      const { data: aiConfig } = await supabase
        .from("ai_configs")
        .select("followup_timezone")
        .eq("company_id", rule.company_id)
        .maybeSingle();
      const timezone =
        (aiConfig as { followup_timezone?: string } | null)?.followup_timezone?.trim() ||
        "America/Sao_Paulo";

      if (!insideWindow(timezone)) {
        results.push({ company_id: rule.company_id, kind: rule.kind, skipped: "fora da janela" });
        continue;
      }

      const outcome = rule.kind === "agenda"
        ? await runAgendaRule(supabase, rule, config, timezone)
        : rule.kind === "giftback"
        ? await runGiftbackRule(supabase, rule, config, timezone)
        : await runRule(supabase, rule, config);
      results.push({ company_id: rule.company_id, kind: rule.kind, title: rule.title, ...outcome });
    }

    return json({ rules: rules.length, results });
  } catch (error) {
    console.error("relationship-rules error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Erro interno" }, 500);
  }
});

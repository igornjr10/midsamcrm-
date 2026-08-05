// Follow-up automático do SDR IA.
//
// Percorre os contatos que ficaram sem responder e envia o próximo passo da
// cadência configurada em followup_steps. Toda tentativa vira uma linha em
// followup_logs (histórico da página do SDR).
//
// Duas formas de chamar:
//   1) com o JWT do usuário  -> roda só para a empresa dele ("Executar agora")
//   2) com o service role key ou o header x-cron-secret (= CRON_SECRET)
//      -> roda para todas as empresas com follow-up ligado (agendador)
//
// Exemplo de agendamento (a cada 15 min), via pg_cron + pg_net no projeto:
//   select cron.schedule('sdr-followup', '*/15 * * * *', $$
//     select net.http_post(
//       url := 'https://<PROJECT>.supabase.co/functions/v1/sdr-followup',
//       headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
//       body := '{}'::jsonb
//     );
//   $$);
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { parseWhatsAppApiError } from "../_shared/whatsapp-error.ts";
import { resolveCompanyId } from "../_shared/company.ts";
import { todayBrief } from "../_shared/date.ts";
import { buildTemplatePayload, renderTemplateText, type VariableMap } from "../_shared/whatsapp-template.ts";

// Sem os genéricos explícitos o ReturnType resolve para os defaults (never) e
// não aceita o cliente real.
type Db = ReturnType<typeof createClient<any, "public", any>>;

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

function resolveApiBase(raw: string | null | undefined): string {
  return (raw?.trim() || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SEND_INTERVAL_MS = 200;
// Margem para responder antes do timeout da edge function.
const RUN_BUDGET_MS = 55_000;
const MAX_PER_COMPANY = 60;
// Fora dessa janela o WhatsApp só entrega template aprovado.
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

type AiConfig = {
  company_id: string;
  enabled: boolean;
  system_prompt: string | null;
  model: string;
  openai_api_key: string | null;
  followup_enabled: boolean;
  followup_timezone: string;
  followup_window_start: number;
  followup_window_end: number;
  followup_skip_weekends: boolean;
  followup_only_open_stages: boolean;
};

type FollowupStep = {
  id: string;
  step_order: number;
  delay_hours: number;
  kind: "text" | "ai" | "template";
  message: string | null;
  template_name: string | null;
  template_language: string;
  template_body: string | null;
  variable_map: VariableMap;
};

type Candidate = {
  contact_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  stage: string;
  last_inbound_at: string | null;
  last_message_at: string | null;
  last_followup_at: string | null;
  followups_done: number;
};

type WhatsappConfig = {
  user_id: string;
  phone_number_id: string;
  access_token: string;
  api_base_url: string;
};

type CompanyResult = {
  company_id: string;
  sent: number;
  failed: number;
  skipped: number;
  reason?: string;
};

/** Hora e dia da semana no fuso da empresa (fuso inválido cai no do servidor). */
function localTime(timezone: string): { hour: number; weekday: number } {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
      weekday: "short",
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? now.getHours());
    const weekdayLabel = parts.find((p) => p.type === "weekday")?.value ?? "";
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weekday = weekdays.indexOf(weekdayLabel);
    return { hour, weekday: weekday < 0 ? now.getDay() : weekday };
  } catch {
    return { hour: now.getHours(), weekday: now.getDay() };
  }
}

function withinWindow(config: AiConfig): boolean {
  const { hour, weekday } = localTime(config.followup_timezone);
  if (config.followup_skip_weekends && (weekday === 0 || weekday === 6)) return false;
  return hour >= config.followup_window_start && hour < config.followup_window_end;
}

/** Placeholders simples aceitos em mensagens de texto do follow-up. */
function renderMessage(template: string, contact: Candidate): string {
  const name = (contact.name ?? "").trim();
  const firstName = name.split(/\s+/)[0] ?? "";
  return template
    .replace(/\{\{\s*nome\s*\}\}/gi, name)
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, firstName)
    .trim();
}

async function sendText(
  config: WhatsappConfig,
  phone: string,
  text: string,
): Promise<string | null> {
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
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(parseWhatsAppApiError(await res.text().catch(() => "")));
  const data = await res.json().catch(() => ({})) as { messages?: Array<{ id?: string }> };
  return data.messages?.[0]?.id ?? null;
}

/** Texto do follow-up escrito pelo agente, com o histórico recente como contexto. */
async function writeAiMessage(
  supabase: Db,
  aiConfig: AiConfig,
  contact: Candidate,
  instruction: string,
): Promise<string> {
  const apiKey = aiConfig.openai_api_key?.trim() || Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("Sem chave da OpenAI configurada para escrever o follow-up.");

  const { data: history } = await supabase
    .from("conversations")
    .select("sender, content")
    .eq("contact_id", contact.contact_id)
    .order("created_at", { ascending: false })
    .limit(12);

  const messages = [
    {
      role: "system",
      content:
        (aiConfig.system_prompt?.trim() ||
          "Você é um atendente comercial simpático e objetivo. Responda em português do Brasil, em mensagens curtas de WhatsApp.") +
        `\n\n${todayBrief(aiConfig.followup_timezone ?? undefined)} Use sempre o ano corrente ao falar de datas.` +
        "\n\nAgora você vai escrever uma mensagem de follow-up: o cliente parou de responder. " +
        "Escreva APENAS o texto da mensagem, curto, natural e sem saudação formal repetida. " +
        "Não invente preços, prazos ou condições.",
    },
    ...((history ?? []) as Array<{ sender: string; content: string }>)
      .slice()
      .reverse()
      .map((m) => ({
        role: m.sender === "contact" ? "user" : "assistant",
        content: m.content,
      })),
    { role: "user", content: `[instrução interna do follow-up] ${instruction}` },
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: aiConfig.model || "gpt-4o-mini",
      messages,
      max_tokens: 300,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`OpenAI respondeu ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("A IA não retornou texto para o follow-up.");
  return reply;
}

async function runCompany(
  supabase: Db,
  aiConfig: AiConfig,
  deadline: number,
): Promise<CompanyResult> {
  const result: CompanyResult = { company_id: aiConfig.company_id, sent: 0, failed: 0, skipped: 0 };

  if (!aiConfig.followup_enabled) {
    result.reason = "follow-up desligado";
    return result;
  }
  if (!withinWindow(aiConfig)) {
    result.reason = "fora da janela de envio configurada";
    return result;
  }

  const { data: stepsRaw } = await supabase
    .from("followup_steps")
    .select("*")
    .eq("company_id", aiConfig.company_id)
    .eq("active", true)
    .order("step_order", { ascending: true });
  const steps = (stepsRaw ?? []) as FollowupStep[];
  if (steps.length === 0) {
    result.reason = "nenhum passo configurado";
    return result;
  }

  const { data: waConfigRaw } = await supabase
    .from("whatsapp_configs")
    .select("user_id, phone_number_id, access_token, api_base_url, active")
    .eq("company_id", aiConfig.company_id)
    .eq("active", true)
    .maybeSingle();
  const waConfig = waConfigRaw as (WhatsappConfig & { active: boolean }) | null;
  if (!waConfig) {
    result.reason = "WhatsApp não configurado ou desativado";
    return result;
  }

  const { data: candidatesRaw, error: candidatesError } = await supabase.rpc("followup_candidates", {
    p_company_id: aiConfig.company_id,
    p_open_only: aiConfig.followup_only_open_stages,
    p_limit: 400,
  });
  if (candidatesError) {
    result.reason = candidatesError.message;
    return result;
  }

  const now = Date.now();

  for (const candidate of (candidatesRaw ?? []) as Candidate[]) {
    if (Date.now() > deadline) break;
    if (result.sent + result.failed >= MAX_PER_COMPANY) break;

    const lastMessageAt = candidate.last_message_at ? Date.parse(candidate.last_message_at) : null;
    if (!lastMessageAt) continue;
    const lastInboundAt = candidate.last_inbound_at ? Date.parse(candidate.last_inbound_at) : null;

    // Só faz sentido cobrar quem ficou em silêncio: se a última mensagem é do
    // contato, quem deve responder é o agente (ou o humano), não o follow-up.
    if (lastInboundAt !== null && lastMessageAt <= lastInboundAt) continue;

    const step = steps[candidate.followups_done];
    if (!step) continue; // cadência terminada para este contato

    const lastFollowupAt = candidate.last_followup_at ? Date.parse(candidate.last_followup_at) : null;
    const since = lastFollowupAt ?? lastMessageAt;
    if (now - since < step.delay_hours * 3_600_000) continue;

    const phone = (candidate.phone ?? "").replace(/\D/g, "");
    const logBase = {
      company_id: aiConfig.company_id,
      contact_id: candidate.contact_id,
      step_id: step.id,
      step_order: step.step_order,
      kind: step.kind,
    };

    // Texto livre só passa dentro das 24h desde a última mensagem do contato.
    const sessionOpen = lastInboundAt !== null && now - lastInboundAt < SESSION_WINDOW_MS;
    if (step.kind !== "template" && !sessionOpen) {
      await supabase.from("followup_logs").insert({
        ...logBase,
        status: "skipped",
        error: "Fora da janela de 24h: só um passo do tipo template consegue reabrir a conversa.",
      });
      result.skipped++;
      continue;
    }

    try {
      let content: string;
      let wamid: string | null;
      let isTemplate = false;

      if (step.kind === "template") {
        if (!step.template_name) throw new Error("Passo sem template escolhido.");
        const { payload, bodyParams } = buildTemplatePayload(
          phone,
          step.template_name,
          step.template_language,
          step.variable_map ?? {},
          { name: candidate.name, phone: candidate.phone, email: candidate.email },
        );
        const base = resolveApiBase(waConfig.api_base_url);
        const res = await fetch(`${base}/${waConfig.phone_number_id}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${waConfig.access_token}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(parseWhatsAppApiError(await res.text().catch(() => "")));
        const data = await res.json().catch(() => ({})) as { messages?: Array<{ id?: string }> };
        wamid = data.messages?.[0]?.id ?? null;
        content = step.template_body
          ? renderTemplateText(step.template_body, bodyParams)
          : `[template: ${step.template_name}]`;
        isTemplate = true;
      } else {
        const instruction = (step.message ?? "").trim();
        if (!instruction) throw new Error("Passo sem mensagem configurada.");
        content =
          step.kind === "ai"
            ? await writeAiMessage(supabase, aiConfig, candidate, instruction)
            : renderMessage(instruction, candidate);
        if (!content) throw new Error("Mensagem do follow-up ficou vazia.");
        wamid = await sendText(waConfig, phone, content);
      }

      await supabase.from("followup_logs").insert({
        ...logBase,
        status: "sent",
        content,
        message_ref: wamid,
      });

      // Espelha no chat para o histórico do contato ficar completo.
      await supabase.from("conversations").insert({
        user_id: waConfig.user_id,
        company_id: aiConfig.company_id,
        contact_id: candidate.contact_id,
        sender: "ai",
        content,
        channel: "whatsapp",
        message_ref: wamid,
        metadata: {
          deliveryStatus: "sent",
          followup: true,
          followupStep: step.step_order,
          ...(isTemplate ? { isTemplate: true, template: step.template_name } : {}),
        },
      });

      result.sent++;
    } catch (err) {
      await supabase.from("followup_logs").insert({
        ...logBase,
        status: "failed",
        error: (err instanceof Error ? err.message : "Erro no envio").slice(0, 500),
      });
      result.failed++;
    }

    await sleep(SEND_INTERVAL_MS);
  }

  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const cronSecret = Deno.env.get("CRON_SECRET");

    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isCron =
      token === serviceKey || (!!cronSecret && req.headers.get("x-cron-secret") === cronSecret);

    // `*` pelo mesmo motivo do webhook: uma coluna ausente derruba o select
    // inteiro, e aí o runner roda sem config nenhuma.
    const selectFields = "*";

    let configs: AiConfig[] = [];

    if (isCron) {
      const { data } = await supabase.from("ai_configs").select(selectFields).eq("followup_enabled", true);
      configs = (data ?? []) as unknown as AiConfig[];
    } else {
      if (!token) return json({ error: "Unauthorized" }, 401);
      const supabaseAuth = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
      if (authError || !user) return json({ error: "Unauthorized" }, 401);

      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const { companyId, error: companyError } = await resolveCompanyId(
        supabase,
        user.id,
        body.company_id as string | undefined,
      );
      if (!companyId) return json({ error: companyError }, 403);

      const { data } = await supabase
        .from("ai_configs")
        .select(selectFields)
        .eq("company_id", companyId)
        .maybeSingle();
      if (!data) {
        return json({ error: "Configure o SDR IA antes de rodar o follow-up." }, 400);
      }
      configs = [data as unknown as AiConfig];
    }

    const deadline = Date.now() + RUN_BUDGET_MS;
    const results: CompanyResult[] = [];
    for (const config of configs) {
      results.push(await runCompany(supabase, config, deadline));
    }

    return json({
      companies: results.length,
      sent: results.reduce((acc, r) => acc + r.sent, 0),
      failed: results.reduce((acc, r) => acc + r.failed, 0),
      skipped: results.reduce((acc, r) => acc + r.skipped, 0),
      reason: results.length === 1 ? results[0].reason ?? null : null,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno";
    console.error("sdr-followup error:", message);
    return json({ error: message }, 200);
  }
});

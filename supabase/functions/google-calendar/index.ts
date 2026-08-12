// Google Agenda <-> Agenda do CRM.
//
// Credenciais do app Google (client id/secret) ficam em secret da function:
// elas valem para todas as empresas e nunca devem chegar ao browser. O refresh
// token de cada empresa fica em google_calendar_configs, que tem RLS sem policy
// — só esta function, com service role, lê aquilo.
//
// Ações (?action=):
//   auth-url    -> devolve a URL do consentimento do Google
//   status      -> conta conectada, último sync, erro pendente
//   disconnect  -> revoga o acesso e desfaz o par com os eventos
//   sync        -> manda o que está na fila e traz o que mudou no Google
//   sync-all    -> o mesmo para todas as empresas conectadas (cron)
// e GET /callback, que é para onde o Google redireciona depois do consentimento.
//
// Agendamento (a cada 5 min), via pg_cron + pg_net no projeto:
//   select cron.schedule('google-calendar-sync', '*/5 * * * *', $$
//     select net.http_post(
//       url := '<SUPABASE_URL>/functions/v1/google-calendar?action=sync-all',
//       headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
//       body := '{}'::jsonb
//     ) $$);
// Sem o cron nada se perde: a Agenda sincroniza ao abrir. O cron só encurta a
// distância entre marcar algo no celular e aquilo aparecer aqui.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveCompanyId } from "../_shared/company.ts";
import { DEFAULT_TZ } from "../_shared/date.ts";
import * as google from "../_shared/google.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
type Admin = any;

type Config = {
  id: string;
  company_id: string;
  user_id: string;
  google_email: string | null;
  calendar_id: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  sync_token: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  active: boolean;
};

type Appointment = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  status: string;
  google_event_id: string | null;
};

/** Janela do primeiro sync: o que passou há mais de um mês não interessa à agenda. */
const FIRST_SYNC_DAYS = 30;
/** Depois disso a fila desiste do item, para um evento problemático não travar o resto. */
const MAX_ATTEMPTS = 5;

function redirectUri(): string {
  const custom = Deno.env.get("GOOGLE_REDIRECT_URI")?.trim();
  if (custom) return custom;
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-calendar/callback`;
}

function credentials(): { clientId: string; clientSecret: string } | null {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function loadConfig(admin: Admin, companyId: string): Promise<Config | null> {
  const { data } = await admin
    .from("google_calendar_configs")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  return (data as Config | null) ?? null;
}

/**
 * Access token válido, renovando quando preciso.
 *
 * O access token do Google dura 1h; o refresh token é que sustenta a conexão.
 * Quando o Google recusa o refresh (o cliente removeu o acesso na conta dele),
 * a config vai a inactive: repetir a chamada só produziria o mesmo erro, e a
 * tela precisa saber que o caso é reconectar, não tentar de novo.
 */
async function ensureAccessToken(
  admin: Admin,
  config: Config,
): Promise<{ token: string | null; error: string | null; needsReconnect: boolean }> {
  const creds = credentials();
  if (!creds) {
    return { token: null, error: "Google não configurado nos secrets da function.", needsReconnect: false };
  }

  const expiresAt = config.access_token_expires_at ? Date.parse(config.access_token_expires_at) : 0;
  // Margem de 60s: um token que expira no meio da chamada seria 401 na volta.
  if (config.access_token && expiresAt > Date.now() + 60_000) {
    return { token: config.access_token, error: null, needsReconnect: false };
  }

  const { tokens, error, revoked } = await google.refreshAccessToken(
    creds.clientId,
    creds.clientSecret,
    config.refresh_token,
  );

  if (!tokens) {
    await admin
      .from("google_calendar_configs")
      .update({ last_error: error, ...(revoked ? { active: false } : {}) })
      .eq("id", config.id);
    return { token: null, error, needsReconnect: revoked };
  }

  await admin
    .from("google_calendar_configs")
    .update({
      access_token: tokens.access_token,
      access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      last_error: null,
      active: true,
    })
    .eq("id", config.id);

  return { token: tokens.access_token, error: null, needsReconnect: false };
}

// ── CRM -> Google ───────────────────────────────────────────────────────────

/**
 * Compromisso que vale evento no Google.
 *
 * 'pending' fica de fora: é pedido do lead que o SDR IA registrou, ainda sem
 * confirmação humana (migration 0034). Jogar isso no calendário da equipe
 * marcaria como compromisso algo que ninguém aceitou — e ocuparia o horário
 * para quem olha o Google.
 */
function shouldHaveEvent(appointment: Appointment): boolean {
  return appointment.status === "scheduled" || appointment.status === "done";
}

async function pushOne(
  admin: Admin,
  config: Config,
  token: string,
  row: { appointment_id: string; op: string; google_event_id: string | null },
): Promise<{ ok: boolean; error: string | null }> {
  const calendar = encodeURIComponent(config.calendar_id);

  const deleteEvent = async (eventId: string) => {
    const res = await google.calendarRequest(token, `/calendars/${calendar}/events/${eventId}`, {
      method: "DELETE",
    });
    // 404/410 = já não existe lá. É o resultado que se queria.
    if (res.error && res.status !== 404 && res.status !== 410) {
      return { ok: false, error: res.error };
    }
    return { ok: true, error: null };
  };

  if (row.op === "delete") {
    if (!row.google_event_id) return { ok: true, error: null };
    return await deleteEvent(row.google_event_id);
  }

  const { data } = await admin
    .from("appointments")
    .select("id, title, description, location, starts_at, ends_at, all_day, status, google_event_id")
    .eq("id", row.appointment_id)
    .maybeSingle();
  const appointment = data as Appointment | null;

  // Apagado entre o enfileiramento e agora: a linha de delete da mesma fila
  // cuida do evento.
  if (!appointment) return { ok: true, error: null };

  if (!shouldHaveEvent(appointment)) {
    // Cancelado (ou voltou a pendente) depois de já estar no Google: some de lá.
    if (appointment.google_event_id) {
      const res = await deleteEvent(appointment.google_event_id);
      if (!res.ok) return res;
      await admin
        .from("appointments")
        .update({ google_event_id: null, google_synced_at: new Date().toISOString() })
        .eq("id", appointment.id);
    }
    return { ok: true, error: null };
  }

  const body = google.toGoogleEvent(appointment, DEFAULT_TZ);

  if (appointment.google_event_id) {
    const res = await google.calendarRequest(
      token,
      `/calendars/${calendar}/events/${appointment.google_event_id}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
    if (!res.error) {
      await admin
        .from("appointments")
        .update({ google_synced_at: new Date().toISOString() })
        .eq("id", appointment.id);
      return { ok: true, error: null };
    }
    // Sumiu do outro lado (apagado direto no Google): recria em vez de ficar
    // repetindo um PATCH que nunca vai funcionar.
    if (res.status !== 404 && res.status !== 410) return { ok: false, error: res.error };
  }

  const created = await google.calendarRequest(token, `/calendars/${calendar}/events`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (created.error) return { ok: false, error: created.error };

  await admin
    .from("appointments")
    .update({
      google_event_id: created.data?.id ?? null,
      google_synced_at: new Date().toISOString(),
    })
    .eq("id", appointment.id);

  return { ok: true, error: null };
}

async function drainOutbox(
  admin: Admin,
  config: Config,
  token: string,
): Promise<{ pushed: number; failed: number; error: string | null }> {
  const { data: queue } = await admin
    .from("google_calendar_outbox")
    .select("id, appointment_id, op, google_event_id, attempts")
    .eq("company_id", config.company_id)
    .lt("attempts", MAX_ATTEMPTS)
    .order("id", { ascending: true })
    .limit(200);

  const rows = (queue ?? []) as Array<{
    id: number;
    appointment_id: string;
    op: string;
    google_event_id: string | null;
    attempts: number;
  }>;
  if (rows.length === 0) return { pushed: 0, failed: 0, error: null };

  // Um compromisso editado cinco vezes gerou cinco linhas; o que vale é o
  // estado atual dele, então só a última operação de cada um é executada.
  const latest = new Map<string, typeof rows[number]>();
  const idsByAppointment = new Map<string, number[]>();
  for (const row of rows) {
    latest.set(row.appointment_id, row);
    const ids = idsByAppointment.get(row.appointment_id) ?? [];
    ids.push(row.id);
    idsByAppointment.set(row.appointment_id, ids);
  }

  let pushed = 0;
  let failed = 0;
  let lastError: string | null = null;
  const done: number[] = [];

  for (const [appointmentId, row] of latest) {
    const res = await pushOne(admin, config, token, row);
    const ids = idsByAppointment.get(appointmentId) ?? [];
    if (res.ok) {
      pushed += 1;
      done.push(...ids);
    } else {
      failed += 1;
      lastError = res.error;
      await admin
        .from("google_calendar_outbox")
        .update({ attempts: row.attempts + 1, last_error: res.error })
        .in("id", ids);
    }
  }

  if (done.length > 0) {
    await admin.from("google_calendar_outbox").delete().in("id", done);
  }

  return { pushed, failed, error: lastError };
}

// ── Google -> CRM ───────────────────────────────────────────────────────────

type PullResult = { applied: number; syncToken: string | null; error: string | null };

async function pullChanges(admin: Admin, config: Config, token: string): Promise<PullResult> {
  const calendar = encodeURIComponent(config.calendar_id);
  let syncToken = config.sync_token;
  let applied = 0;

  // Duas voltas no máximo: a segunda é a releitura completa depois de um
  // syncToken expirado (410), e ela nunca expira por definição.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const events: google.GoogleEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;
    let expired = false;
    let error: string | null = null;

    for (let page = 0; page < 20; page += 1) {
      const params = new URLSearchParams({
        maxResults: "250",
        showDeleted: "true",
        // Série recorrente vira uma ocorrência por vez: a Agenda desenha
        // compromissos com data, não regras de repetição.
        singleEvents: "true",
      });
      if (syncToken) params.set("syncToken", syncToken);
      else params.set("timeMin", new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000).toISOString());
      if (pageToken) params.set("pageToken", pageToken);

      const res = await google.calendarRequest(
        token,
        `/calendars/${calendar}/events?${params.toString()}`,
      );

      // 410: o Google descartou o ponto de partida (acontece depois de dias sem
      // sincronizar). A saída prevista na API é reler tudo do zero.
      if (res.status === 410) {
        expired = true;
        break;
      }
      if (res.error) {
        error = res.error;
        break;
      }

      events.push(...((res.data?.items ?? []) as google.GoogleEvent[]));
      nextSyncToken = res.data?.nextSyncToken ?? null;
      pageToken = res.data?.nextPageToken ?? undefined;
      if (!pageToken) break;
    }

    if (expired) {
      syncToken = null;
      await admin.from("google_calendar_configs").update({ sync_token: null }).eq("id", config.id);
      continue;
    }
    if (error) return { applied: 0, syncToken: null, error };

    for (const event of events) {
      if (await applyEvent(admin, config, event)) applied += 1;
    }
    return { applied, syncToken: nextSyncToken, error: null };
  }

  return { applied, syncToken: null, error: "O Google não devolveu um ponto de sincronização." };
}

/** Aplica um evento do Google na agenda. Devolve true se algo mudou de fato. */
async function applyEvent(admin: Admin, config: Config, event: google.GoogleEvent): Promise<boolean> {
  if (!event.id) return false;

  const { data: existingRaw } = await admin
    .from("appointments")
    .select("id, title, description, location, starts_at, ends_at, all_day, status, google_event_id")
    .eq("company_id", config.company_id)
    .eq("google_event_id", event.id)
    .maybeSingle();
  const existing = existingRaw as Appointment | null;

  // Apagado no Google. Vira cancelado em vez de sumir: quem marcou por aqui
  // ainda quer achar o registro, e a Agenda já sabe mostrar cancelado.
  if (event.status === "cancelled") {
    if (!existing || existing.status === "canceled") return false;
    await admin
      .from("appointments")
      .update({ status: "canceled", google_synced_at: new Date().toISOString() })
      .eq("id", existing.id);
    return true;
  }

  const mapped = google.fromGoogleEvent(event, DEFAULT_TZ);
  if (!mapped) return false;

  if (!existing) {
    await admin.from("appointments").insert({
      user_id: config.user_id,
      company_id: config.company_id,
      ...mapped,
      kind: "meeting",
      status: "scheduled",
      google_event_id: event.id,
      google_synced_at: new Date().toISOString(),
    });
    return true;
  }

  // O evento que acabou de sair daqui volta na mesma leitura. Sem esta
  // comparação, todo sync reescreveria a tabela inteira sem nada ter mudado.
  const same =
    existing.title === mapped.title &&
    existing.description === mapped.description &&
    existing.location === mapped.location &&
    existing.all_day === mapped.all_day &&
    Date.parse(existing.starts_at) === Date.parse(mapped.starts_at) &&
    (existing.ends_at ? Date.parse(existing.ends_at) : null) ===
      (mapped.ends_at ? Date.parse(mapped.ends_at) : null);
  if (same) return false;

  await admin
    .from("appointments")
    .update({ ...mapped, google_synced_at: new Date().toISOString() })
    .eq("id", existing.id);
  return true;
}

// ── Sync ────────────────────────────────────────────────────────────────────

type SyncResult = {
  connected: boolean;
  pushed?: number;
  failed?: number;
  applied?: number;
  needs_reconnect?: boolean;
  error?: string | null;
};

async function syncCompany(admin: Admin, companyId: string): Promise<SyncResult> {
  const config = await loadConfig(admin, companyId);
  if (!config) return { connected: false };
  if (!config.active) {
    return { connected: true, needs_reconnect: true, error: config.last_error };
  }

  const { token, error: tokenError, needsReconnect } = await ensureAccessToken(admin, config);
  if (!token) return { connected: true, needs_reconnect: needsReconnect, error: tokenError };

  // Empurra antes de puxar: assim o que a equipe acabou de marcar aqui já volta
  // na leitura como evento existente, em vez de entrar de novo na volta seguinte.
  const push = await drainOutbox(admin, config, token);
  const pull = await pullChanges(admin, config, token);

  const error = pull.error ?? push.error;
  await admin
    .from("google_calendar_configs")
    .update({
      last_sync_at: new Date().toISOString(),
      last_error: error,
      ...(pull.syncToken ? { sync_token: pull.syncToken } : {}),
    })
    .eq("id", config.id);

  return {
    connected: true,
    pushed: push.pushed,
    failed: push.failed,
    applied: pull.applied,
    error,
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────

/** Volta do consentimento: sempre uma página do app, com o resultado na query. */
function redirectBack(target: string, params: Record<string, string>): Response {
  const url = new URL(target);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: url.toString() } });
}

async function handleCallback(req: Request, admin: Admin): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const denied = url.searchParams.get("error");

  const { data: stateRowRaw } = await admin
    .from("google_oauth_states")
    .select("state, company_id, user_id, redirect_to, expires_at")
    .eq("state", state)
    .maybeSingle();
  const stateRow = stateRowRaw as
    | { company_id: string; user_id: string; redirect_to: string; expires_at: string }
    | null;

  // Sem state válido não há para onde voltar com segurança: a URL de destino é
  // justamente o que ele guarda.
  if (!stateRow || Date.parse(stateRow.expires_at) < Date.now()) {
    return json({ error: "Autorização expirada. Comece de novo pelas Configurações." }, 400);
  }
  // Uso único.
  await admin.from("google_oauth_states").delete().eq("state", state);

  const back = stateRow.redirect_to;
  if (denied || !code) {
    return redirectBack(back, { google: "erro", google_msg: denied ?? "sem código de autorização" });
  }

  const creds = credentials();
  if (!creds) return redirectBack(back, { google: "erro", google_msg: "Google não configurado" });

  const { tokens, error } = await google.exchangeCode(
    creds.clientId,
    creds.clientSecret,
    redirectUri(),
    code,
  );
  if (!tokens?.refresh_token) {
    return redirectBack(back, {
      google: "erro",
      google_msg: error ?? "O Google não devolveu o refresh token. Tente de novo.",
    });
  }

  const existing = await loadConfig(admin, stateRow.company_id);
  const { error: saveError } = await admin.from("google_calendar_configs").upsert(
    {
      ...(existing?.id ? { id: existing.id } : {}),
      company_id: stateRow.company_id,
      user_id: stateRow.user_id,
      google_email: google.emailFromIdToken(tokens.id_token),
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      // Conta nova = calendário novo: o ponto de sincronização anterior não
      // vale mais nada.
      sync_token: null,
      last_error: null,
      active: true,
    },
    { onConflict: "company_id" },
  );
  if (saveError) {
    return redirectBack(back, { google: "erro", google_msg: saveError.message });
  }

  // Primeira sincronização já aqui: o cliente volta para a Agenda com os
  // compromissos dos dois lados no lugar, sem precisar apertar mais nada.
  await syncCompany(admin, stateRow.company_id);

  return redirectBack(back, { google: "conectado" });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const url = new URL(req.url);

    if (url.pathname.endsWith("/callback")) {
      return await handleCallback(req, admin);
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const action = url.searchParams.get("action") ?? "status";
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Chamada de máquina (cron): sincroniza todas as empresas conectadas.
    if (action === "sync-all") {
      const cronSecret = Deno.env.get("CRON_SECRET");
      const token = req.headers.get("Authorization")?.replace("Bearer ", "");
      const allowed =
        token === serviceKey || (!!cronSecret && req.headers.get("x-cron-secret") === cronSecret);
      if (!allowed) return json({ error: "Unauthorized" }, 401);

      const { data: configs } = await admin
        .from("google_calendar_configs")
        .select("company_id")
        .eq("active", true);
      const results = [];
      for (const row of (configs ?? []) as Array<{ company_id: string }>) {
        results.push({ company_id: row.company_id, ...(await syncCompany(admin, row.company_id)) });
      }
      return json({ companies: results.length, results });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { companyId, error: companyError } = await resolveCompanyId(
      admin,
      user.id,
      body.company_id as string | undefined,
    );
    if (!companyId) return json({ error: companyError }, 403);

    if (action === "status") {
      const config = await loadConfig(admin, companyId);
      if (!config) return json({ connected: false });
      return json({
        connected: true,
        active: config.active,
        google_email: config.google_email,
        calendar_id: config.calendar_id,
        last_sync_at: config.last_sync_at,
        last_error: config.last_error,
      });
    }

    if (action === "auth-url") {
      const creds = credentials();
      if (!creds) {
        return json(
          { error: "Faltam GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nos secrets da function." },
          500,
        );
      }

      // Para onde voltar depois do consentimento. Vem do browser autenticado;
      // exigir http(s) absoluto impede que a function vire trampolim para
      // esquemas estranhos. APP_URL, quando existe, tem a palavra final.
      const appUrl = Deno.env.get("APP_URL")?.trim();
      const requested = (body.redirect_to as string | undefined)?.trim();
      let back = appUrl ? `${appUrl.replace(/\/$/, "")}/configuracoes` : requested;
      if (!back || !/^https?:\/\//i.test(back)) {
        return json({ error: "URL de retorno inválida." }, 400);
      }
      try {
        back = new URL(back).toString();
      } catch {
        return json({ error: "URL de retorno inválida." }, 400);
      }

      // Consentimento abandonado no meio deixa a linha para trás; a próxima
      // tentativa limpa o que já venceu.
      await admin.from("google_oauth_states").delete().lt("expires_at", new Date().toISOString());

      const state = crypto.randomUUID();
      const { error: stateError } = await admin.from("google_oauth_states").insert({
        state,
        company_id: companyId,
        user_id: user.id,
        redirect_to: back,
      });
      if (stateError) return json({ error: stateError.message }, 400);

      return json({ url: google.buildAuthUrl(creds.clientId, redirectUri(), state) });
    }

    if (action === "disconnect") {
      const config = await loadConfig(admin, companyId);
      if (!config) return json({ ok: true });

      await google.revokeToken(config.refresh_token);
      await admin.from("google_calendar_configs").delete().eq("id", config.id);
      await admin.from("google_calendar_outbox").delete().eq("company_id", companyId);
      // Desfaz o par: os compromissos ficam, mas soltos. Numa reconexão futura
      // eles são reenviados como eventos novos em vez de tentarem alterar
      // eventos de uma conta que já não responde.
      await admin
        .from("appointments")
        .update({ google_event_id: null, google_synced_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .not("google_event_id", "is", null);

      return json({ ok: true });
    }

    if (action === "sync") {
      const result = await syncCompany(admin, companyId);
      return json(result);
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (error) {
    console.error("google-calendar error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Erro interno" }, 500);
  }
});

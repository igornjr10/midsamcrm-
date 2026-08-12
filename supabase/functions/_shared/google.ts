// Adapter do Google Calendar: OAuth, tokens e tradução evento <-> compromisso.
//
// Só fala com o Google. Nada aqui conhece Supabase — quem lê e grava é a
// function google-calendar, que passa os valores prontos.

import { DEFAULT_TZ, localISO, tzOffsetMs } from "./date.ts";

const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// `calendar` (leitura e escrita de eventos) + identificação da conta, para a
// tela poder dizer qual e-mail está conectado.
const SCOPES = "openid email https://www.googleapis.com/auth/calendar";

export type TokenSet = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
};

export type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
};

/**
 * URL do consentimento.
 *
 * access_type=offline + prompt=consent porque é o refresh token que interessa:
 * sem ele a conexão morre em uma hora, e o Google só o entrega quando o usuário
 * passa pela tela de consentimento — nas autorizações seguintes da mesma conta
 * ele vem vazio, e a empresa ficaria conectada sem conseguir renovar nada.
 */
export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(body: Record<string, string>): Promise<{
  tokens: TokenSet | null;
  error: string | null;
  /** true quando o Google recusou a credencial em definitivo (acesso revogado). */
  revoked: boolean;
}> {
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = String(data?.error ?? res.status);
      return {
        tokens: null,
        error: data?.error_description ?? `Google recusou o token (${code})`,
        revoked: code === "invalid_grant",
      };
    }
    return { tokens: data as TokenSet, error: null, revoked: false };
  } catch (err) {
    return {
      tokens: null,
      error: err instanceof Error ? err.message : "Falha ao falar com o Google",
      revoked: false,
    };
  }
}

export function exchangeCode(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
) {
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code,
  });
}

export function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string) {
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function revokeToken(token: string): Promise<void> {
  // Melhor esforço: se falhar, a conexão já vai ser apagada deste lado de
  // qualquer jeito e o usuário pode revogar na conta Google.
  try {
    await fetch(`${OAUTH_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" });
  } catch {
    /* ignorado de propósito */
  }
}

/**
 * E-mail da conta conectada, lido do id_token.
 *
 * Sem verificar assinatura: o token acabou de chegar do endpoint do Google por
 * TLS, na resposta a uma requisição nossa. É só rótulo de tela — nada de
 * permissão depende dele.
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}

export type CalendarResponse = {
  status: number;
  // deno-lint-ignore no-explicit-any
  data: any;
  error: string | null;
};

export async function calendarRequest(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<CalendarResponse> {
  try {
    const res = await fetch(`${CALENDAR_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    // DELETE responde 204 sem corpo.
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    return {
      status: res.status,
      data,
      error: res.ok ? null : (data?.error?.message ?? `Google respondeu ${res.status}`),
    };
  } catch (err) {
    return {
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : "Falha ao falar com o Google",
    };
  }
}

// ── Tradução ────────────────────────────────────────────────────────────────

export type AppointmentLike = {
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
};

const DAY_MS = 86_400_000;

/** Instante UTC das 00:00 de um dia local (YYYY-MM-DD) no fuso da empresa. */
function startOfLocalDay(dateKey: string, timezone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  // Offset medido ao meio-dia daquele dia: pega o horário de verão certo.
  const offset = tzOffsetMs(new Date(Date.UTC(year, month - 1, day, 12)), timezone);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offset);
}

/**
 * Compromisso -> evento do Google.
 *
 * Dia inteiro vira start.date/end.date (o Google trata `end` como exclusivo, daí
 * o +1 dia); com hora vira dateTime no fuso da empresa. Mandar dia inteiro como
 * dateTime faria o evento aparecer como "00:00 às 00:00" no celular.
 */
export function toGoogleEvent(
  appointment: AppointmentLike,
  timezone = DEFAULT_TZ,
): Record<string, unknown> {
  const base = {
    summary: appointment.title,
    description: appointment.description ?? undefined,
    location: appointment.location ?? undefined,
  };

  if (appointment.all_day) {
    const startKey = localISO(timezone, new Date(appointment.starts_at));
    const endSource = appointment.ends_at ? new Date(appointment.ends_at) : new Date(appointment.starts_at);
    const endKey = localISO(timezone, new Date(endSource.getTime() + DAY_MS));
    return { ...base, start: { date: startKey }, end: { date: endKey } };
  }

  const start = new Date(appointment.starts_at);
  // Sem fim marcado o Google exige um mesmo assim: 1h é a duração padrão dele.
  const end = appointment.ends_at ? new Date(appointment.ends_at) : new Date(start.getTime() + 3_600_000);
  return {
    ...base,
    start: { dateTime: start.toISOString(), timeZone: timezone },
    end: { dateTime: end.toISOString(), timeZone: timezone },
  };
}

export type MappedEvent = {
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
};

/** Evento do Google -> campos de compromisso. Devolve null se não dá para situar no tempo. */
export function fromGoogleEvent(event: GoogleEvent, timezone = DEFAULT_TZ): MappedEvent | null {
  const common = {
    title: event.summary?.trim() || "(sem título)",
    description: event.description ?? null,
    location: event.location ?? null,
  };

  if (event.start?.dateTime) {
    return {
      ...common,
      all_day: false,
      starts_at: new Date(event.start.dateTime).toISOString(),
      ends_at: event.end?.dateTime ? new Date(event.end.dateTime).toISOString() : null,
    };
  }

  if (event.start?.date) {
    const starts = startOfLocalDay(event.start.date, timezone);
    // end.date é exclusivo: um evento de um dia só chega como dia+1 e não tem
    // fim para guardar; de dois ou mais, o fim é o último dia de fato.
    const endKey = event.end?.date;
    const endExclusive = endKey ? startOfLocalDay(endKey, timezone) : null;
    const spansMoreThanADay = !!endExclusive && endExclusive.getTime() - starts.getTime() > DAY_MS;
    return {
      ...common,
      all_day: true,
      starts_at: starts.toISOString(),
      ends_at: spansMoreThanADay ? new Date(endExclusive!.getTime() - DAY_MS).toISOString() : null,
    };
  }

  return null;
}

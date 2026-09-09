// Adapter do OpenWA (painel self-hosted, engine whatsapp-web.js ou Baileys).
//
// Mesma ideia do _shared/uazapi.ts: traduzir os dois sentidos para o formato da
// Meta Cloud API, que é o que o miolo do CRM entende.
//
// Contrato levantado por sondagem contra a v0.23.3 — a doc do painel é uma SPA
// que não expõe spec. Confirmado na prática (tudo com header x-api-key):
//
//   GET  /api/sessions                          -> [{id,name,status,phone,pushName,...}]
//   GET  /api/sessions/{id}                     -> a mesma linha
//   POST /api/sessions            {name}        -> cria a sessão
//   POST /api/sessions/{id}/start | /stop | /logout
//   GET  /api/sessions/{id}/qr                  -> { qrCode: "data:image/png;base64,..." }
//   POST /api/sessions/{id}/messages/send-text  {chatId,text}
//   POST /api/sessions/{id}/messages/send-image|video|document|audio
//                                               {chatId,url|base64+mimetype,caption|filename}
//   GET/POST /api/sessions/{id}/webhooks        {sessionId,url,events,filters}
//     (mandar `active` no POST devolve 400: o DTO de criação não aceita campo
//      fora da lista dele, e o erro não diz qual)
//
// O que NÃO foi possível levantar por sondagem: o corpo exato do evento
// message.received — o painel só entrega chats e mensagens com a sessão
// conectada, e as duas sessões estavam em qr_ready. Daí normalizeWebhook ser
// deliberadamente tolerante e logar o payload cru quando não reconhece nada:
// um formato a mais é uma linha a mais na lista de candidatos, não um adapter
// novo.

const TIMEOUT = 20_000;

export type OpenwaTarget = {
  /** URL do painel, sem barra no fim. */
  base: string;
  /** Chave de API do painel (admin). Vale para todas as sessões. */
  apiKey: string;
};

export type OpenwaSession = {
  id: string;
  name: string;
  status: string;
  phone: string | null;
  pushName: string | null;
};

function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

async function call<T>(
  target: OpenwaTarget,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${normalizeBase(target.base)}/api${path}`, {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", "x-api-key": target.apiKey },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await res.json().catch(() => null) as T | null;

    if (!res.ok) {
      const raw = data as unknown as { message?: string; error?: string } | null;
      // 409 = sessão existe mas não está pareada. A mensagem crua ("Session is
      // not connected") não diz o que fazer.
      const friendly = res.status === 409
        ? "O número não está conectado. Leia o QR code em Configurações."
        : raw?.message ?? raw?.error ?? `OpenWA respondeu ${res.status}`;
      return { ok: false, status: res.status, data, error: friendly };
    }
    return { ok: true, status: res.status, data, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "falha de rede";
    return { ok: false, status: 0, data: null, error: `Não foi possível falar com o OpenWA: ${message}` };
  }
}

// ── Sessões ─────────────────────────────────────────────────────────────────

export async function listSessions(target: OpenwaTarget) {
  const { data, error } = await call<OpenwaSession[]>(target, "/sessions");
  return { sessions: data ?? [], error };
}

export async function getSession(target: OpenwaTarget, sessionId: string) {
  const { data, error } = await call<OpenwaSession>(target, `/sessions/${sessionId}`);
  return { session: data, error };
}

export async function createSession(target: OpenwaTarget, name: string) {
  const { data, error } = await call<OpenwaSession>(target, "/sessions", {
    method: "POST",
    body: { name },
  });
  return { session: data, error };
}

export async function startSession(target: OpenwaTarget, sessionId: string) {
  const { ok, error } = await call(target, `/sessions/${sessionId}/start`, { method: "POST" });
  return { ok, error };
}

export async function logoutSession(target: OpenwaTarget, sessionId: string) {
  const { ok, error } = await call(target, `/sessions/${sessionId}/logout`, { method: "POST" });
  return { ok, error };
}

/** QR já vem como data URI (data:image/png;base64,...) — o front exibe direto. */
export async function getQr(target: OpenwaTarget, sessionId: string) {
  const { data, error } = await call<{ qrCode?: string }>(target, `/sessions/${sessionId}/qr`);
  return { qr: data?.qrCode ?? null, error };
}

/**
 * Estado da sessão traduzido para o vocabulário do CRM (open/connecting/close).
 *
 * Os nomes do OpenWA mudam com o engine: whatsapp-web.js e Baileys não usam a
 * mesma palavra para "esperando o QR". Por isso o casamento é por pedaço do
 * texto, e o desconhecido cai em connecting — o pior erro aqui seria dizer
 * "desconectado" para uma sessão que está subindo.
 */
export function mapStatus(status: string | null | undefined): "open" | "connecting" | "close" {
  const s = (status ?? "").toLowerCase();
  if (s.includes("connected") && !s.includes("dis")) return "open";
  if (s === "ready" || s === "authenticated" || s === "open") return "open";
  if (s.includes("qr") || s.includes("start") || s.includes("init") || s.includes("connecting")) {
    return "connecting";
  }
  if (s.includes("disconnect") || s.includes("stop") || s.includes("fail") || s.includes("logout")) {
    return "close";
  }
  return "connecting";
}

// ── Webhook ─────────────────────────────────────────────────────────────────

export type OpenwaWebhook = { id: string; url: string; events: string[]; active: boolean };

export async function listWebhooks(target: OpenwaTarget, sessionId: string) {
  const { data, error } = await call<OpenwaWebhook[]>(target, `/sessions/${sessionId}/webhooks`);
  return { webhooks: data ?? [], error };
}

export async function createWebhook(
  target: OpenwaTarget,
  sessionId: string,
  url: string,
  events: string[] = ["message.received", "message.sent"],
) {
  // Sem `active`: o DTO de criação recusa campo fora da lista dele e devolve um
  // "Bad Request" seco, sem dizer qual. O webhook já nasce ativo.
  const { data, error } = await call<OpenwaWebhook>(target, `/sessions/${sessionId}/webhooks`, {
    method: "POST",
    body: { sessionId, url, events, filters: null },
  });
  return { webhook: data, error };
}

export async function deleteWebhook(target: OpenwaTarget, sessionId: string, webhookId: string) {
  const { ok, error } = await call(target, `/sessions/${sessionId}/webhooks/${webhookId}`, {
    method: "DELETE",
  });
  return { ok, error };
}

// ── Envio ───────────────────────────────────────────────────────────────────

/** 5511999999999 -> 5511999999999@c.us (o engine é whatsapp-web.js). */
export function phoneToChatId(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@c.us`;
}

function messageIdOf(data: unknown): string | null {
  const d = data as Record<string, any> | null;
  return d?.id?._serialized ?? d?.messageId ?? d?.id ?? d?.key?.id ?? null;
}

export async function sendText(
  target: OpenwaTarget,
  sessionId: string,
  phone: string,
  text: string,
): Promise<{ messageId: string | null; error: string | null }> {
  const { ok, data, error } = await call<Record<string, any>>(
    target,
    `/sessions/${sessionId}/messages/send-text`,
    { method: "POST", body: { chatId: phoneToChatId(phone), text } },
  );
  if (!ok) return { messageId: null, error };
  return { messageId: messageIdOf(data), error: null };
}

export async function sendMedia(
  target: OpenwaTarget,
  sessionId: string,
  phone: string,
  media: { url: string; type: string; caption?: string; fileName?: string },
): Promise<{ messageId: string | null; error: string | null }> {
  const kind = ["image", "video", "audio", "document"].includes(media.type) ? media.type : "document";

  // caption vale para imagem e vídeo; documento usa filename. Mandar os dois
  // sempre faz o painel recusar o corpo.
  const body: Record<string, unknown> = { chatId: phoneToChatId(phone), url: media.url };
  if ((kind === "image" || kind === "video") && media.caption) body.caption = media.caption;
  if (kind === "document" && (media.fileName || media.caption)) {
    body.filename = media.fileName ?? media.caption;
  }

  const { ok, data, error } = await call<Record<string, any>>(
    target,
    `/sessions/${sessionId}/messages/send-${kind}`,
    { method: "POST", body },
  );
  if (!ok) return { messageId: null, error };
  return { messageId: messageIdOf(data), error: null };
}

// ── Webhook -> formato da Meta ──────────────────────────────────────────────

export type NormalizedValue = {
  messages: Array<Record<string, any>>;
  message_echoes: Array<Record<string, any>>;
  statuses: Array<Record<string, any>>;
  contacts: Array<Record<string, any>>;
};

/** 5511999999999@c.us / @s.whatsapp.net / @lid -> 5511999999999 */
function jidToPhone(jid: unknown): string | null {
  const raw = String(jid ?? "");
  if (!raw) return null;
  const digits = raw.split("@")[0].split(":")[0].replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/** O primeiro valor não vazio entre vários caminhos possíveis do payload. */
function pick(source: Record<string, any>, keys: string[]): any {
  for (const key of keys) {
    const value = key.split(".").reduce<any>((acc, part) => acc?.[part], source);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/**
 * O objeto da mensagem dentro do envelope.
 *
 * O painel manda { event, sessionId, data: {...} } — mas o "data" às vezes vem
 * com a mensagem um nível abaixo (data.message), e um evento de teste pode vir
 * na raiz. Procurar em vez de assumir custa três linhas e evita um adapter
 * quebrado por causa de um nível de aninhamento.
 */
function findMessage(payload: Record<string, any>): Record<string, any> | null {
  const candidates = [
    payload?.data?.message,
    payload?.data?.msg,
    payload?.data,
    payload?.message,
    payload?.payload?.message,
    payload?.payload,
    payload,
  ];
  for (const c of candidates) {
    if (c && typeof c === "object" && (pick(c, ["from", "chatId", "sender", "key.remoteJid"]) !== undefined)) {
      return c as Record<string, any>;
    }
  }
  return null;
}

const MEDIA_LABEL: Record<string, string> = {
  image: "[Imagem]",
  video: "[Vídeo]",
  audio: "[Áudio]",
  ptt: "[Áudio]",
  document: "[Documento]",
  sticker: "[Figurinha]",
  location: "[Localização]",
};

/**
 * Evento do OpenWA -> `value` no formato da Meta.
 *
 * Mídia por enquanto entra como rótulo ("[Imagem]"), não como arquivo: baixar
 * exige o endpoint de download do painel, que não deu para confirmar sem uma
 * sessão conectada. O atendente vê que chegou mídia e abre no celular; texto,
 * que é o que a IA lê e responde, funciona inteiro.
 */
export function normalizeWebhook(payload: Record<string, any>): NormalizedValue {
  const value: NormalizedValue = { messages: [], message_echoes: [], statuses: [], contacts: [] };

  const event = String(payload?.event ?? payload?.type ?? "");
  // Eventos de sessão (qr, status, disconnected) não viram conversa.
  if (event.startsWith("session.") || event.startsWith("presence.")) return value;

  const m = findMessage(payload);
  if (!m) return value;

  const chat = String(pick(m, ["chatId", "from", "key.remoteJid", "chat.id._serialized"]) ?? "");
  // Grupo não vira conversa do CRM.
  if (chat.endsWith("@g.us") || pick(m, ["isGroup", "isGroupMsg"]) === true) return value;

  const fromMe = pick(m, ["fromMe", "key.fromMe"]) === true || event === "message.sent";
  const counterpart = fromMe
    ? pick(m, ["to", "chatId", "key.remoteJid"])
    : pick(m, ["from", "author", "chatId", "key.remoteJid"]);
  const phone = jidToPhone(counterpart) ?? jidToPhone(chat);
  if (!phone) return value;

  const id = String(pick(m, ["id._serialized", "id", "messageId", "key.id"]) ?? "");
  if (!id) return value;

  const rawType = String(pick(m, ["type", "messageType"]) ?? "chat").toLowerCase();
  const text = String(pick(m, ["body", "text", "content", "caption", "message.conversation"]) ?? "");
  const label = MEDIA_LABEL[rawType];

  const timestampRaw = Number(pick(m, ["timestamp", "t", "messageTimestamp"]) ?? 0);
  // O painel manda segundos; alguns engines mandam milissegundos.
  const timestamp = timestampRaw > 1e12 ? Math.floor(timestampRaw / 1000) : timestampRaw;

  const msg: Record<string, unknown> = {
    id,
    ...(timestamp ? { timestamp: String(timestamp) } : {}),
    type: "text",
    text: { body: label ? `${label}${text ? ` ${text}` : ""}` : text },
  };

  if (fromMe) {
    value.message_echoes.push({ ...msg, to: phone });
  } else {
    value.messages.push({ ...msg, from: phone });
    const nome = pick(m, ["notifyName", "pushName", "senderName", "sender.pushname", "_data.notifyName"]);
    if (nome) value.contacts.push({ wa_id: phone, profile: { name: String(nome) } });
  }

  return value;
}

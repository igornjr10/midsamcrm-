// Adapter da UAZAPI (uazapiGO v2).
//
// Mesma ideia do _shared/evolution.ts: traduzir os dois sentidos para o formato
// da Meta Cloud API, que é o que o miolo do CRM entende.
//
// Contrato levantado por sondagem contra um servidor v2.1.4 — a documentação
// pública é uma SPA que não expõe o spec. O que foi confirmado na prática:
//
//   POST /instance/init     admintoken  {name}  -> { token, instance:{id,...} }
//   POST /instance/connect  token               -> { instance:{ qrcode, paircode } }
//   GET  /instance/status   token               -> { instance:{ status, ... } }
//   POST /send/text         token  {number,text}
//   POST /webhook           token  {url,events,enabled}
//
// Atenção: no host gratuito (free.uazapi.com) a instância é apagada sozinha
// depois de 1 hora. Serve para avaliar, não para atender cliente.

const TIMEOUT = 20_000;

export type UazapiTarget = {
  /** URL do servidor, sem barra no fim. */
  base: string;
  /** Token da instância (operações do dia a dia) ou o admintoken (criação). */
  token: string;
};

function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

async function call<T>(
  base: string,
  path: string,
  headers: Record<string, string>,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${normalizeBase(base)}${path}`, {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", ...headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await res.json().catch(() => null) as T | null;
    if (!res.ok) {
      const raw = data as unknown as { error?: string; message?: string; response?: string } | null;
      const detail = raw?.error ?? raw?.message ?? raw?.response;
      // 503 no /send é instância desconectada — a mensagem crua não diz isso.
      const friendly = res.status === 503
        ? "O número não está conectado. Leia o QR code em Configurações."
        : detail ?? `UAZAPI respondeu ${res.status}`;
      return { ok: false, status: res.status, data, error: friendly };
    }
    return { ok: true, status: res.status, data, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "falha de rede";
    return { ok: false, status: 0, data: null, error: `Não foi possível falar com o servidor UAZAPI: ${message}` };
  }
}

// ── Instância ───────────────────────────────────────────────────────────────

export type CreatedInstance = {
  instanceId: string | null;
  instanceName: string;
  /** Token da instância — chave de roteamento e credencial de envio. */
  token: string | null;
};

/** Cria a instância. Usa o admintoken do servidor, não o da instância. */
export async function createInstance(
  base: string,
  adminToken: string,
  instanceName: string,
): Promise<{ instance: CreatedInstance | null; error: string | null }> {
  const { ok, data, error } = await call<Record<string, any>>(
    base,
    "/instance/init",
    { admintoken: adminToken },
    { method: "POST", body: { name: instanceName } },
  );
  if (!ok || !data) return { instance: null, error: error ?? "Falha ao criar instância" };

  return {
    instance: {
      instanceId: data.instance?.id ?? null,
      instanceName: data.instance?.name ?? instanceName,
      token: data.token ?? data.instance?.token ?? null,
    },
    error: null,
  };
}

/** QR novo. O código vem em instance.qrcode, já como data:image/png;base64. */
export async function connectInstance(
  target: UazapiTarget,
): Promise<{ qrBase64: string | null; pairingCode: string | null; connected: boolean; error: string | null }> {
  const { ok, data, error } = await call<Record<string, any>>(
    target.base,
    "/instance/connect",
    { token: target.token },
    { method: "POST", body: {} },
  );
  if (!ok || !data) return { qrBase64: null, pairingCode: null, connected: false, error: error ?? "Falha ao gerar QR code" };
  return {
    qrBase64: data.instance?.qrcode || null,
    pairingCode: data.instance?.paircode || null,
    connected: Boolean(data.connected),
    error: null,
  };
}

export type ConnectionState = "open" | "connecting" | "close" | "unknown";

export async function instanceState(
  target: UazapiTarget,
): Promise<{ state: ConnectionState; error: string | null }> {
  const { ok, data, error } = await call<Record<string, any>>(
    target.base,
    "/instance/status",
    { token: target.token },
  );
  if (!ok || !data) return { state: "unknown", error: error ?? "Falha ao consultar status" };

  // O vocabulário da UAZAPI é connected/connecting/disconnected; o resto do CRM
  // fala open/connecting/close, herdado do Evolution.
  const raw = String(data.instance?.status ?? "").toLowerCase();
  const state: ConnectionState =
    raw === "connected" ? "open" :
    raw === "connecting" ? "connecting" :
    raw === "disconnected" ? "close" :
    "unknown";
  return { state, error: null };
}

/**
 * Aponta o webhook da instância.
 *
 * O token vai como query na URL de propósito: é ele que identifica a empresa
 * quando o evento chega, sem depender de achar um campo dentro do payload.
 */
export async function setInstanceWebhook(
  target: UazapiTarget,
  webhookUrl: string,
): Promise<{ ok: boolean; error: string | null }> {
  const { ok, error } = await call(
    target.base,
    "/webhook",
    { token: target.token },
    {
      method: "POST",
      body: {
        enabled: true,
        url: webhookUrl,
        events: ["messages", "messages_update", "connection"],
        excludeMessages: [],
        addUrlEvents: false,
        addUrlTypesMessages: false,
      },
    },
  );
  return { ok, error };
}

export async function logoutInstance(target: UazapiTarget): Promise<{ ok: boolean; error: string | null }> {
  const { ok, error } = await call(
    target.base,
    "/instance/disconnect",
    { token: target.token },
    { method: "POST", body: {} },
  );
  return { ok, error };
}

// ── Envio ───────────────────────────────────────────────────────────────────

function toNumber(phone: string): string {
  return String(phone).replace(/\D/g, "");
}

/** O id da mensagem enviada aparece com nomes diferentes conforme a rota. */
function sentId(data: Record<string, any> | null): string | null {
  return data?.messageid ?? data?.id ?? data?.key?.id ?? data?.message?.id ?? null;
}

export async function sendText(
  target: UazapiTarget,
  phone: string,
  text: string,
): Promise<{ messageId: string | null; error: string | null }> {
  const { ok, data, error } = await call<Record<string, any>>(
    target.base,
    "/send/text",
    { token: target.token },
    { method: "POST", body: { number: toNumber(phone), text } },
  );
  if (!ok) return { messageId: null, error: error ?? "Falha ao enviar" };
  return { messageId: sentId(data), error: null };
}

// ── Leitura (histórico) ─────────────────────────────────────────────────────

export type UazChat = {
  wa_chatid: string;
  wa_isGroup: boolean;
  wa_name: string;
  wa_contactName: string;
  name: string;
  phone: string;
  wa_lastMsgTimestamp: number;
};

/** Conversas da instância. Grupos vêm junto e são filtrados por quem chama. */
export async function findChats(
  target: UazapiTarget,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ chats: UazChat[]; total: number; error: string | null }> {
  const { ok, data, error } = await call<Record<string, any>>(
    target.base,
    "/chat/find",
    { token: target.token },
    { method: "POST", body: { limit: opts.limit ?? 200, offset: opts.offset ?? 0 } },
  );
  if (!ok || !data) return { chats: [], total: 0, error: error ?? "Falha ao listar conversas" };
  return {
    chats: (data.chats ?? []) as UazChat[],
    total: Number(data.pagination?.totalRecords ?? 0),
    error: null,
  };
}

export type UazMessage = {
  messageid: string;
  chatid: string;
  fromMe: boolean;
  isGroup: boolean;
  messageTimestamp: number;
  messageType: string;
  text: string;
  senderName: string;
  /** Telefone real do remetente. `sender` pode ser um @lid, que não é número. */
  sender_pn: string;
  content?: Record<string, unknown>;
};

export async function findMessages(
  target: UazapiTarget,
  opts: { chatid?: string; limit?: number; offset?: number } = {},
): Promise<{ messages: UazMessage[]; hasMore: boolean; error: string | null }> {
  const { ok, data, error } = await call<Record<string, any>>(
    target.base,
    "/message/find",
    { token: target.token },
    {
      method: "POST",
      body: {
        ...(opts.chatid ? { chatid: opts.chatid } : {}),
        limit: opts.limit ?? 100,
        offset: opts.offset ?? 0,
      },
    },
  );
  if (!ok || !data) return { messages: [], hasMore: false, error: error ?? "Falha ao listar mensagens" };
  return {
    messages: (data.messages ?? []) as UazMessage[],
    hasMore: Boolean(data.hasMore),
    error: null,
  };
}

/** URL decriptada de uma mídia. O content.URL do payload é .enc e não abre. */
export async function downloadMedia(
  target: UazapiTarget,
  messageId: string,
): Promise<{ fileURL: string; mimetype: string } | null> {
  const { ok, data } = await call<Record<string, any>>(
    target.base,
    "/message/download",
    { token: target.token },
    { method: "POST", body: { id: messageId } },
  );
  if (!ok || !data?.fileURL) return null;
  return { fileURL: String(data.fileURL), mimetype: String(data.mimetype ?? "") };
}

/** JID -> dígitos. Grupo e broadcast devolvem null. */
export function jidToPhone(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const raw = String(jid);
  if (!raw.endsWith("@s.whatsapp.net") && !raw.endsWith("@c.us")) return null;
  const digits = raw.split("@")[0].split(":")[0].replace(/\D/g, "");
  return digits || null;
}

/** messageType da UAZAPI -> tipo da Meta, que é o que o CRM entende. */
export function messageKind(type: string): "text" | "image" | "video" | "audio" | "document" | "other" {
  const t = (type ?? "").toLowerCase();
  if (t === "conversation" || t === "extendedtextmessage") return "text";
  if (t === "imagemessage") return "image";
  if (t === "videomessage") return "video";
  if (t === "audiomessage" || t === "pttmessage") return "audio";
  if (t === "documentmessage") return "document";
  return "other";
}

/** Texto exibível de uma mensagem, com rótulo quando é mídia sem legenda. */
export function messageText(msg: UazMessage): string {
  const direct = (msg.text ?? "").trim() || String((msg.content as any)?.text ?? "").trim();
  if (direct) return direct;
  const caption = String((msg.content as any)?.caption ?? "").trim();
  if (caption) return caption;
  const label: Record<string, string> = {
    image: "[Imagem]", video: "[Vídeo]", audio: "[Áudio]", document: "[Documento]",
  };
  return label[messageKind(msg.messageType)] ?? `[${msg.messageType}]`;
}

export async function sendMedia(
  target: UazapiTarget,
  phone: string,
  media: { url: string; type: string; caption?: string; fileName?: string },
): Promise<{ messageId: string | null; error: string | null }> {
  const type = ["image", "video", "audio", "document"].includes(media.type) ? media.type : "document";
  const { ok, data, error } = await call<Record<string, any>>(
    target.base,
    "/send/media",
    { token: target.token },
    {
      method: "POST",
      body: {
        number: toNumber(phone),
        type,
        file: media.url,
        ...(media.caption ? { text: media.caption } : {}),
        ...(media.fileName ? { docName: media.fileName } : {}),
      },
    },
  );
  if (!ok) return { messageId: null, error: error ?? "Falha ao enviar mídia" };
  return { messageId: sentId(data), error: null };
}

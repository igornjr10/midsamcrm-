// Adapter da Evolution API v2 (Baileys).
//
// O CRM foi escrito em cima do formato da Meta Cloud API. Em vez de espalhar
// `if (provider === ...)` pelo webhook inteiro, este módulo traduz os dois
// sentidos: normalizeEvolutionPayload devolve o mesmo `value` que a Meta manda
// (messages/message_echoes/statuses/contacts), e as funções de envio expõem a
// mesma assinatura que o código já usava.
//
// Testado contra v2.3.7. As rotas mudaram entre v1 e v2 (o v1 aninhava o corpo
// em `textMessage: { text }`); nada aqui funciona num servidor v1.

const TIMEOUT = 20_000;

/** Eventos que o CRM consome. Assinar o resto só gera ruído no log. */
export const EVOLUTION_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "CONNECTION_UPDATE",
];

export type EvolutionTarget = {
  /** URL do servidor, sem barra no fim. */
  base: string;
  /** Token da instância, ou a key global para operações de criação. */
  apikey: string;
  instance: string;
};

function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/** O nome da instância entra no path e pode ter espaço ("moto garagem"). */
function instancePath(instance: string): string {
  return encodeURIComponent(instance.trim());
}

async function call<T>(
  target: EvolutionTarget,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  const url = `${normalizeBase(target.base)}${path}`;
  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        apikey: target.apikey,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await res.json().catch(() => null) as T | null;
    if (!res.ok) {
      // O Evolution devolve o motivo em `response.message`, que costuma ser um
      // array de strings — juntar aqui evita "[object Object]" chegando no toast.
      const raw = data as unknown as {
        message?: unknown;
        response?: { message?: unknown };
        error?: string;
      } | null;
      const detail = raw?.response?.message ?? raw?.message ?? raw?.error;
      const text = Array.isArray(detail) ? detail.join("; ") : typeof detail === "string" ? detail : null;
      return { ok: false, status: res.status, data, error: text ?? `Evolution respondeu ${res.status}` };
    }
    return { ok: true, status: res.status, data, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "falha de rede";
    return { ok: false, status: 0, data: null, error: `Não foi possível falar com o servidor Evolution: ${message}` };
  }
}

// ── Instância ───────────────────────────────────────────────────────────────

export type CreatedInstance = {
  instanceId: string | null;
  instanceName: string;
  /** Token próprio da instância — vira a chave de roteamento do webhook. */
  token: string | null;
  qrBase64: string | null;
  pairingCode: string | null;
};

/**
 * Cria a instância já com o webhook apontado. Usa a key global do servidor,
 * não a da instância — esta ainda não existe.
 */
export async function createInstance(
  base: string,
  globalApiKey: string,
  instanceName: string,
  webhookUrl: string,
): Promise<{ instance: CreatedInstance | null; error: string | null }> {
  const { ok, data, error } = await call<Record<string, any>>(
    { base, apikey: globalApiKey, instance: instanceName },
    "/instance/create",
    {
      method: "POST",
      body: {
        instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
        webhook: {
          enabled: true,
          url: webhookUrl,
          // byEvents=false: tudo numa URL só. Com true o Evolution acrescenta
          // /messages-upsert ao path, e aí cada evento precisaria de uma rota.
          byEvents: false,
          base64: true,
          events: EVOLUTION_EVENTS,
        },
      },
    },
  );
  if (!ok || !data) return { instance: null, error: error ?? "Falha ao criar instância" };

  // `hash` já veio como string e como { apikey } dependendo da minor do v2.
  const hash = data.hash;
  const token = typeof hash === "string" ? hash : (hash?.apikey ?? null);

  return {
    instance: {
      instanceId: data.instance?.instanceId ?? null,
      instanceName: data.instance?.instanceName ?? instanceName,
      token,
      qrBase64: data.qrcode?.base64 ?? null,
      pairingCode: data.qrcode?.pairingCode ?? null,
    },
    error: null,
  };
}

/** QR novo para uma instância que já existe (o anterior expira em ~60s). */
export async function connectInstance(
  target: EvolutionTarget,
): Promise<{ qrBase64: string | null; pairingCode: string | null; error: string | null }> {
  const { ok, data, error } = await call<Record<string, any>>(
    target,
    `/instance/connect/${instancePath(target.instance)}`,
  );
  if (!ok || !data) return { qrBase64: null, pairingCode: null, error: error ?? "Falha ao gerar QR code" };
  return { qrBase64: data.base64 ?? null, pairingCode: data.pairingCode ?? null, error: null };
}

export type ConnectionState = "open" | "connecting" | "close" | "unknown";

export async function instanceState(
  target: EvolutionTarget,
): Promise<{ state: ConnectionState; error: string | null }> {
  const { ok, data, error } = await call<Record<string, any>>(
    target,
    `/instance/connectionState/${instancePath(target.instance)}`,
  );
  if (!ok || !data) return { state: "unknown", error: error ?? "Falha ao consultar status" };
  const raw = String(data.instance?.state ?? "unknown");
  const state: ConnectionState =
    raw === "open" || raw === "connecting" || raw === "close" ? raw : "unknown";
  return { state, error: null };
}

/** Reaponta o webhook. Necessário em instância criada fora do CRM. */
export async function setInstanceWebhook(
  target: EvolutionTarget,
  webhookUrl: string,
): Promise<{ ok: boolean; error: string | null }> {
  const { ok, error } = await call(
    target,
    `/webhook/set/${instancePath(target.instance)}`,
    {
      method: "POST",
      body: {
        webhook: {
          enabled: true,
          url: webhookUrl,
          byEvents: false,
          base64: true,
          events: EVOLUTION_EVENTS,
        },
      },
    },
  );
  return { ok, error };
}

/** Desconecta o número mas mantém a instância (dá para ler o QR de novo). */
export async function logoutInstance(target: EvolutionTarget): Promise<{ ok: boolean; error: string | null }> {
  const { ok, error } = await call(target, `/instance/logout/${instancePath(target.instance)}`, {
    method: "DELETE",
  });
  return { ok, error };
}

// ── Envio ───────────────────────────────────────────────────────────────────

/** Só dígitos: o Evolution resolve o JID sozinho a partir do número. */
function toNumber(phone: string): string {
  return String(phone).replace(/\D/g, "");
}

function sentId(data: Record<string, any> | null): string | null {
  return data?.key?.id ?? null;
}

export async function sendText(
  target: EvolutionTarget,
  phone: string,
  text: string,
): Promise<{ messageId: string | null; error: string | null }> {
  const { ok, data, error } = await call<Record<string, any>>(
    target,
    `/message/sendText/${instancePath(target.instance)}`,
    { method: "POST", body: { number: toNumber(phone), text } },
  );
  if (!ok) return { messageId: null, error: error ?? "Falha ao enviar" };
  return { messageId: sentId(data), error: null };
}

export async function sendMedia(
  target: EvolutionTarget,
  phone: string,
  media: { url: string; type: string; mimetype?: string; caption?: string; fileName?: string },
): Promise<{ messageId: string | null; error: string | null }> {
  const number = toNumber(phone);

  // Áudio tem rota própria: mandar pelo sendMedia entrega como arquivo anexo,
  // não como mensagem de voz.
  if (media.type === "audio") {
    const { ok, data, error } = await call<Record<string, any>>(
      target,
      `/message/sendWhatsAppAudio/${instancePath(target.instance)}`,
      { method: "POST", body: { number, audio: media.url } },
    );
    if (!ok) return { messageId: null, error: error ?? "Falha ao enviar áudio" };
    return { messageId: sentId(data), error: null };
  }

  const mediatype = ["image", "video", "document"].includes(media.type) ? media.type : "document";
  const { ok, data, error } = await call<Record<string, any>>(
    target,
    `/message/sendMedia/${instancePath(target.instance)}`,
    {
      method: "POST",
      body: {
        number,
        mediatype,
        ...(media.mimetype ? { mimetype: media.mimetype } : {}),
        ...(media.caption ? { caption: media.caption } : {}),
        // O WhatsApp exige nome no documento; sem isso chega como "file".
        fileName: media.fileName ?? media.url.split("/").pop()?.split("?")[0] ?? `arquivo-${Date.now()}`,
        media: media.url,
      },
    },
  );
  if (!ok) return { messageId: null, error: error ?? "Falha ao enviar mídia" };
  return { messageId: sentId(data), error: null };
}

/**
 * Baixa a mídia de uma mensagem recebida.
 *
 * O Baileys guarda o arquivo criptografado no servidor do WhatsApp — não existe
 * URL pública como no /media/{id} da Meta. O Evolution descriptografa e devolve
 * em base64 a partir da chave da mensagem.
 */
export async function fetchMediaBase64(
  target: EvolutionTarget,
  messageId: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const { ok, data } = await call<Record<string, any>>(
    target,
    `/chat/getBase64FromMediaMessage/${instancePath(target.instance)}`,
    { method: "POST", body: { message: { key: { id: messageId } }, convertToMp4: false } },
  );
  if (!ok || !data?.base64) return null;
  try {
    const binary = atob(String(data.base64));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes, mime: String(data.mimetype ?? "application/octet-stream") };
  } catch {
    return null;
  }
}

// ── Normalização do webhook ─────────────────────────────────────────────────

/** JID -> dígitos. Grupo (@g.us) e status@broadcast devolvem null. */
export function jidToPhone(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const raw = String(jid);
  if (!raw.endsWith("@s.whatsapp.net") && !raw.endsWith("@c.us")) return null;
  const digits = raw.split("@")[0].split(":")[0].replace(/\D/g, "");
  return digits || null;
}

/** Tipo Baileys -> tipo da Meta, que é o que extractContent entende. */
function messageShape(message: Record<string, any> | null | undefined): {
  type: string;
  text: string;
  mimetype: string | null;
  caption: string;
  fileName: string | null;
} | null {
  if (!message) return null;

  if (typeof message.conversation === "string") {
    return { type: "text", text: message.conversation, mimetype: null, caption: "", fileName: null };
  }
  if (message.extendedTextMessage?.text) {
    return { type: "text", text: String(message.extendedTextMessage.text), mimetype: null, caption: "", fileName: null };
  }
  if (message.imageMessage) {
    return {
      type: "image", text: "", mimetype: message.imageMessage.mimetype ?? "image/jpeg",
      caption: message.imageMessage.caption ?? "", fileName: null,
    };
  }
  if (message.videoMessage) {
    return {
      type: "video", text: "", mimetype: message.videoMessage.mimetype ?? "video/mp4",
      caption: message.videoMessage.caption ?? "", fileName: null,
    };
  }
  if (message.audioMessage) {
    return {
      type: "audio", text: "", mimetype: message.audioMessage.mimetype ?? "audio/ogg",
      caption: "", fileName: null,
    };
  }
  if (message.documentMessage || message.documentWithCaptionMessage) {
    const doc = message.documentMessage ?? message.documentWithCaptionMessage?.message?.documentMessage ?? {};
    return {
      type: "document", text: "", mimetype: doc.mimetype ?? "application/pdf",
      caption: doc.caption ?? "", fileName: doc.fileName ?? null,
    };
  }
  // Figurinha, localização, contato, reação: entram como o tipo cru e viram
  // "[sticker]" no chat. Melhor registrar do que sumir com a mensagem.
  const known = Object.keys(message).find((k) => k.endsWith("Message"));
  return known ? { type: known.replace(/Message$/, ""), text: "", mimetype: null, caption: "", fileName: null } : null;
}

/** O `value` normalizado, no formato que processChange já consome. */
export type NormalizedValue = {
  messages: Array<Record<string, unknown>>;
  message_echoes: Array<Record<string, unknown>>;
  statuses: Array<{ id: string; status: string }>;
  contacts: Array<{ wa_id: string; profile?: { name?: string } }>;
};

/**
 * Traduz um evento do Evolution para o `value` da Meta.
 *
 * Devolve `instanceToken` (o `apikey` que vem em todo evento do v2) porque é
 * ele, e não o nome, que identifica a instância sem ambiguidade — a listagem
 * do servidor tem nomes repetidos.
 */
export function normalizeEvolutionPayload(payload: Record<string, any>): {
  instanceToken: string | null;
  instanceName: string | null;
  event: string;
  value: NormalizedValue;
  connectionState: string | null;
} | null {
  const event = String(payload?.event ?? "").toLowerCase().replace(/_/g, ".");
  if (!event) return null;

  const value: NormalizedValue = { messages: [], message_echoes: [], statuses: [], contacts: [] };
  const instanceToken = payload.apikey ? String(payload.apikey) : null;
  const instanceName = payload.instance ? String(payload.instance) : null;
  let connectionState: string | null = null;

  // Um upsert pode vir como objeto ou como lista.
  const items: Array<Record<string, any>> = Array.isArray(payload.data)
    ? payload.data
    : payload.data
      ? [payload.data]
      : [];

  if (event === "messages.upsert") {
    for (const item of items) {
      const key = item.key ?? {};
      const phone = jidToPhone(key.remoteJid);
      // Grupo e status não viram contato do CRM.
      if (!phone || !key.id) continue;

      const shape = messageShape(item.message);
      if (!shape) continue;

      const msg: Record<string, unknown> = {
        id: String(key.id),
        timestamp: item.messageTimestamp ? String(item.messageTimestamp) : undefined,
        type: shape.type,
        ...(shape.type === "text" ? { text: { body: shape.text } } : {}),
        ...(shape.type !== "text"
          ? {
              [shape.type]: {
                // O "id" da mídia aqui é o id da própria mensagem: é por ele que
                // o getBase64FromMediaMessage devolve o arquivo.
                id: String(key.id),
                mime_type: shape.mimetype,
                ...(shape.caption ? { caption: shape.caption } : {}),
                ...(shape.fileName ? { filename: shape.fileName } : {}),
              },
            }
          : {}),
      };

      if (key.fromMe) {
        // Mensagem que saiu do número da empresa (pelo celular ou pelo CRM).
        value.message_echoes.push({ ...msg, to: phone });
      } else {
        value.messages.push({ ...msg, from: phone });
        if (item.pushName) {
          value.contacts.push({ wa_id: phone, profile: { name: String(item.pushName) } });
        }
      }
    }
  } else if (event === "messages.update") {
    for (const item of items) {
      const id = item.keyId ?? item.key?.id;
      if (!id) continue;
      // Baileys: PENDING, SERVER_ACK, DELIVERY_ACK, READ, PLAYED. O
      // updateDeliveryStatus casa por substring, então mandamos em minúsculo
      // com o vocabulário da Meta.
      const raw = String(item.status ?? "").toUpperCase();
      const status =
        raw === "READ" || raw === "PLAYED" ? "read" :
        raw === "DELIVERY_ACK" ? "delivered" :
        raw === "SERVER_ACK" || raw === "PENDING" ? "sent" :
        raw.toLowerCase();
      value.statuses.push({ id: String(id), status });
    }
  } else if (event === "connection.update") {
    connectionState = items[0]?.state ? String(items[0].state) : null;
  }

  return { instanceToken, instanceName, event, value, connectionState };
}

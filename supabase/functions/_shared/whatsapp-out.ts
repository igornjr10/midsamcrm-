// Enviar texto pelo WhatsApp, seja qual for o provedor da empresa.
//
// Existia uma cópia disso dentro do whatsapp-webhook (para a IA responder) e
// outra, só da Meta, dentro do sdr-followup — que por isso nunca funcionou em
// Evolution, UAZAPI ou OpenWA: o follow-up automático dessas empresas postava
// para a Graph API com phone_number_id nulo e falhava calado.
//
// Quem precisa mandar uma mensagem em nome da empresa usa esta função. Nova
// régua, novo canal, nova automação: um lugar só para ensinar o provedor.

import * as evo from "./evolution.ts";
import * as uaz from "./uazapi.ts";
import * as owa from "./openwa.ts";

export type OutboundConfig = {
  company_id: string;
  provider: string;
  api_base_url: string | null;
  phone_number_id: string | null;
  access_token: string | null;
  instance_name: string | null;
  instance_id: string | null;
  instance_token: string | null;
};

/** Colunas mínimas para enviar. Literal única: o supabase-js infere o tipo daqui. */
export const OUTBOUND_COLUMNS =
  "company_id, provider, api_base_url, phone_number_id, access_token, instance_name, instance_id, instance_token";

function metaBase(raw: string | null): string {
  return (raw?.trim() || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
}

export async function sendText(
  config: OutboundConfig,
  phone: string,
  text: string,
): Promise<{ messageId: string | null; error: string | null }> {
  if (config.provider === "openwa") {
    const base = config.api_base_url || Deno.env.get("OPENWA_BASE_URL")?.trim() || "";
    const apiKey = Deno.env.get("OPENWA_API_KEY")?.trim() ?? "";
    if (!config.instance_id) return { messageId: null, error: "Sessão do OpenWA não vinculada." };
    return await owa.sendText({ base, apiKey }, config.instance_id, phone, text);
  }

  if (config.provider === "uazapi") {
    return await uaz.sendText(
      { base: config.api_base_url ?? "", token: config.instance_token ?? "" },
      phone,
      text,
    );
  }

  if (config.provider === "evolution") {
    return await evo.sendText(
      {
        base: config.api_base_url ?? "",
        apikey: config.instance_token ?? "",
        instance: config.instance_name ?? "",
      },
      phone,
      text,
    );
  }

  // Meta Cloud API.
  try {
    const res = await fetch(`${metaBase(config.api_base_url)}/${config.phone_number_id}/messages`, {
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
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      return { messageId: null, error: `Meta respondeu ${res.status}: ${raw.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({})) as { messages?: Array<{ id?: string }> };
    return { messageId: data.messages?.[0]?.id ?? null, error: null };
  } catch (err) {
    return {
      messageId: null,
      error: err instanceof Error ? err.message : "falha de rede ao falar com a Meta",
    };
  }
}

/**
 * Manda um payload de template já montado (buildTemplatePayload).
 *
 * Só a Meta tem template: é o único caminho para falar com quem está fora da
 * janela de 24h. Os outros provedores não chegam aqui.
 */
export async function sendTemplate(
  config: OutboundConfig,
  payload: Record<string, unknown>,
): Promise<{ messageId: string | null; error: string | null }> {
  try {
    const res = await fetch(`${metaBase(config.api_base_url)}/${config.phone_number_id}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.access_token}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      return { messageId: null, error: `Meta respondeu ${res.status}: ${raw.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({})) as { messages?: Array<{ id?: string }> };
    return { messageId: data.messages?.[0]?.id ?? null, error: null };
  } catch (err) {
    return {
      messageId: null,
      error: err instanceof Error ? err.message : "falha de rede ao falar com a Meta",
    };
  }
}

/** Mesma convenção do follow-up e das campanhas. */
export function renderPlaceholders(template: string, contactName: string | null): string {
  const name = (contactName ?? "").trim();
  const firstName = name.split(/\s+/)[0] ?? "";
  return template
    .replace(/\{\{\s*nome\s*\}\}/gi, name)
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, firstName)
    .trim();
}

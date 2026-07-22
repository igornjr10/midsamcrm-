/**
 * Converte o corpo de erro da API do WhatsApp (Meta/Datafy Cloud API) em uma
 * mensagem curta e legível.
 *
 * Exemplo Meta/Datafy:
 *   {"error":{"message":"Invalid OAuth access token.","type":"OAuthException"}}
 */
export function parseWhatsAppApiError(raw: string): string {
  const trimmed = raw.trim().slice(0, 1000);
  try {
    const parsed = JSON.parse(trimmed);
    let inner: unknown = parsed?.error?.message ?? parsed?.message ?? parsed?.error;
    if (Array.isArray(inner) && inner.length > 0) inner = inner[0];
    if (typeof inner === "string" && inner.trim()) {
      return inner.replace(/^Error:\s*/i, "").trim();
    }
  } catch {
    // não é JSON — cai pro texto cru
  }
  return trimmed || "Erro desconhecido na API do WhatsApp";
}

/** Lança erro com mensagem legível quando a resposta da API não for 2xx. */
export async function assertWhatsAppResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const raw = await response.text().catch(() => "");
  throw new Error(parseWhatsAppApiError(raw));
}

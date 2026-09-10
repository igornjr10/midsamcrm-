import { supabase } from "@/integrations/supabase/client";

/**
 * Manda um texto pelo WhatsApp da empresa, pela mesma edge function do Chat.
 * Usado fora do Chat: aviso de status do pedido, do chamado, vaga da lista
 * de espera. Lança erro com a mensagem que a function devolveu.
 */
export async function sendWhatsappText(params: {
  company_id: string;
  contact_id: string;
  phone: string;
  text: string;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke("whatsapp-send?action=send-text", {
    body: params,
  });
  if (error || (data && data.success === false)) {
    throw new Error((data?.error as string) || error?.message || "Falha ao enviar");
  }
}

/** Nome curto para a mensagem: "Oi Ana" e não "Oi (99) 98457-3986". */
export function firstNameForMessage(name: string | null | undefined): string {
  const clean = (name ?? "").trim();
  if (!clean || /\d{4}/.test(clean)) return "";
  return clean.split(/\s+/)[0] ?? "";
}

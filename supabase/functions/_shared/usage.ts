// Coins: cobra o envio antes de mandar.
//
// A ordem importa. Cobrar depois do envio deixaria passar tudo o que estourou
// o limite — a mensagem já foi. Cobrar antes e não enviar cobraria por nada,
// então quem chama precisa desistir do envio quando `allowed` vem false.
//
// A conta mora na function consume_coins (0044): checar o saldo e gravar o
// evento na mesma chamada é o que impede dois envios simultâneos de lerem o
// mesmo saldo e passarem os dois.

// deno-lint-ignore no-explicit-any
type Admin = any;

export type UsageKind =
  | "whatsapp_out"
  | "ai_reply"
  | "campaign_out"
  | "followup_out"
  | "email_out";

export type ConsumeResult = {
  allowed: boolean;
  coins?: number;
  used?: number;
  monthly_coins?: number;
  unlimited?: boolean;
  reason?: string;
};

/**
 * Cobra um evento de consumo.
 *
 * Em caso de erro devolve `allowed: true`: uma falha de banco não pode virar
 * bloqueio de atendimento para quem está em dia. O prejuízo de deixar passar
 * alguns envios num incidente é menor do que o de calar o WhatsApp de todos os
 * clientes porque a medição tossiu.
 */
export async function consumeCoins(
  admin: Admin,
  companyId: string,
  kind: UsageKind,
  extra: { contactId?: string | null; ref?: string | null } = {},
): Promise<ConsumeResult> {
  const { data, error } = await admin.rpc("consume_coins", {
    p_company_id: companyId,
    p_kind: kind,
    p_contact_id: extra.contactId ?? null,
    p_ref: extra.ref ?? null,
  });

  if (error) {
    console.error("consumeCoins: falha ao medir consumo", error.message);
    return { allowed: true };
  }
  return (data ?? { allowed: true }) as ConsumeResult;
}

/** Mensagem para o front quando a cota do mês acabou. */
export function limitReachedMessage(result: ConsumeResult): string {
  const limite = result.monthly_coins ? ` (${result.monthly_coins} coins)` : "";
  return `A cota de envios do mês acabou${limite}. Fale com o suporte para liberar mais.`;
}

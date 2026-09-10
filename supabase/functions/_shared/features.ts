// Módulos: a checagem que vale.
//
// O front esconde o item do menu, e isso é UX. Quem impede o uso é aqui: sem
// esta verificação, a empresa que não comprou Disparos manda uma campanha
// chamando a function na mão — o botão não existir na tela não protege nada.
//
// A conta mora na function company_feature_set (0042), a mesma que o front
// consulta. Duas implementações da mesma regra divergem no primeiro caso de
// borda, e o caso de borda aqui é alguém usando o que não pagou.

// deno-lint-ignore no-explicit-any
type Admin = any;

type FeatureRow = { feature_key: string; enabled: boolean };

/**
 * A empresa tem este módulo?
 *
 * Em caso de erro devolve `true`: uma falha de consulta não pode virar recusa
 * de atendimento para quem está em dia. O risco de deixar passar num erro raro
 * é menor do que o de derrubar o WhatsApp de todo mundo quando o banco tosse.
 */
export async function hasFeature(
  admin: Admin,
  companyId: string,
  featureKey: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("company_feature_set", { p_company_id: companyId });
  if (error) {
    console.error("hasFeature: falha ao resolver módulos", error.message);
    return true;
  }
  const row = ((data ?? []) as FeatureRow[]).find((f) => f.feature_key === featureKey);
  // Módulo que não está no catálogo ainda não foi modelado: liberado.
  return row ? row.enabled : true;
}

/** Mensagem pronta para devolver ao front quando o módulo não faz parte do plano. */
export function featureDeniedMessage(label: string): string {
  return `${label} não faz parte do plano desta empresa. Fale com o suporte para liberar.`;
}

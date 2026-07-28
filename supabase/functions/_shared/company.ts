// Resolve qual empresa a requisição pode operar.
//
// O front manda company_id quando o usuário está atuando em outra empresa
// (super admin acessando a conta de um cliente, ou alguém com mais de uma
// membership). Sem isso, cada function usaria sempre a primeira membership e
// o super admin acabaria mandando mensagem pelo número da própria conta.

// deno-lint-ignore no-explicit-any
type Admin = any;

export async function resolveCompanyId(
  supabaseAdmin: Admin,
  userId: string,
  requestedCompanyId?: string | null,
): Promise<{ companyId: string | null; error: string | null }> {
  const requested = requestedCompanyId?.trim();

  if (requested) {
    const { data: membership } = await supabaseAdmin
      .from("company_members")
      .select("company_id")
      .eq("user_id", userId)
      .eq("company_id", requested)
      .maybeSingle();
    if (membership?.company_id) return { companyId: requested, error: null };

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("is_super_admin")
      .eq("user_id", userId)
      .maybeSingle();
    if (profile?.is_super_admin) return { companyId: requested, error: null };

    return { companyId: null, error: "Sem permissão para acessar esta empresa." };
  }

  const { data: first } = await supabaseAdmin
    .from("company_members")
    .select("company_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (!first?.company_id) return { companyId: null, error: "Usuário sem empresa vinculada." };
  return { companyId: first.company_id as string, error: null };
}

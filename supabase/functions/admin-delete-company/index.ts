// Apaga uma empresa e, junto, os usuários que só existiam para ela.
// Restrito ao super admin do produto.
//
// ATENÇÃO: isto é irreversível e leva muito mais do que a linha de companies.
// São 42 chaves estrangeiras com `on delete cascade` apontando para
// companies(id) — contatos, conversas, mensagens, vendas, agendamentos,
// campanhas, pedidos, chamados. Não existe lixeira e não existe desfazer.
//
// Por isso o nome da empresa vem no corpo e é conferido aqui, contra o banco.
// A confirmação da tela protege contra o clique errado; esta protege contra o
// client errado — um bug de estado mandando o id da linha de cima não apaga
// nada, porque o nome não vai bater.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: profile } = await admin
      .from("profiles")
      .select("is_super_admin")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!profile?.is_super_admin) return json({ error: "Acesso restrito ao super admin" }, 403);

    const body = await req.json() as { company_id?: string; confirm_name?: string };
    const companyId = body.company_id?.trim();
    const confirmName = body.confirm_name?.trim();

    if (!companyId) return json({ error: "company_id é obrigatório" }, 400);
    if (!confirmName) return json({ error: "confirm_name é obrigatório" }, 400);

    const { data: company } = await admin
      .from("companies")
      .select("id, name")
      .eq("id", companyId)
      .maybeSingle();
    if (!company) return json({ error: "Empresa não encontrada" }, 404);

    if (company.name.trim() !== confirmName) {
      return json({ error: "O nome digitado não confere com o da empresa" }, 400);
    }

    // Quem era membro precisa ser lido ANTES: company_members some no cascade,
    // e depois do delete não há mais como saber quem ficou órfão.
    const { data: memberRows } = await admin
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId);
    const memberIds = [...new Set(((memberRows ?? []) as Array<{ user_id: string }>).map((m) => m.user_id))];

    const { error: deleteError } = await admin.from("companies").delete().eq("id", companyId);
    if (deleteError) return json({ error: deleteError.message }, 400);

    // A partir daqui a empresa já morreu. Uma falha ao apagar usuário deixa
    // uma conta sem empresa nenhuma — chata, mas inofensiva e reversível à mão.
    // O contrário (apagar o usuário e falhar na empresa) não teria conserto.
    const deletedUsers: string[] = [];
    const keptUsers: string[] = [];

    for (const userId of memberIds) {
      // O próprio super admin nunca é apagado por esta rota, nem que ele fosse
      // membro: ele acabaria de deletar a si mesmo no meio da própria chamada.
      if (userId === user.id) {
        keptUsers.push(userId);
        continue;
      }

      // Ainda pertence a outra empresa? Então a conta não era só desta, e
      // apagá-la derrubaria o acesso de alguém a um CRM que continua de pé.
      const { count } = await admin
        .from("company_members")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      if ((count ?? 0) > 0) {
        keptUsers.push(userId);
        continue;
      }

      const { data: otherProfile } = await admin
        .from("profiles")
        .select("is_super_admin")
        .eq("user_id", userId)
        .maybeSingle();
      if (otherProfile?.is_super_admin) {
        keptUsers.push(userId);
        continue;
      }

      const { error: userError } = await admin.auth.admin.deleteUser(userId);
      if (userError) {
        console.error("admin-delete-company: falha ao apagar usuário", userId, userError.message);
        keptUsers.push(userId);
        continue;
      }
      deletedUsers.push(userId);
    }

    return json({
      ok: true,
      company_name: company.name,
      deleted_users: deletedUsers.length,
      kept_users: keptUsers.length,
    });
  } catch (error) {
    console.error("admin-delete-company error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Erro interno" }, 500);
  }
});

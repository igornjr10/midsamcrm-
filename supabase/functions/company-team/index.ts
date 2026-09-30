// Equipe da empresa: o admin cadastra, edita e remove quem usa o CRM com ele.
//
// Até aqui só o super admin criava usuário, e sempre como dono de empresa nova
// (admin-create-company). Esta function deixa o admin da própria empresa fazer
// isso dentro da empresa dele — nunca em outra.
//
// Papéis: "admin" (tudo, inclusive configurações e equipe) e "member", que a
// tela chama de Vendedor.
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

const ROLES = ["admin", "member"] as const;
type Role = typeof ROLES[number];
const MIN_PASSWORD = 8;
// ~100 anos: o Auth não tem "banido para sempre", só duração.
const BAN_FOREVER = "876000h";

/** Conta do Auth pelo e-mail. O SDK não busca por e-mail, só pagina. */
// deno-lint-ignore no-explicit-any
async function findAuthUserByEmail(admin: any, email: string): Promise<{ id: string } | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    const users = (data?.users ?? []) as Array<{ id: string; email?: string }>;
    const hit = users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return { id: hit.id };
    if (users.length < 1000) return null;
  }
  return null;
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already") && (m.includes("registered") || m.includes("exists"))) {
    return "Este e-mail já tem uma conta no CRM. Use outro e-mail.";
  }
  if (m.includes("password")) return `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`;
  if (m.includes("email")) return "E-mail inválido.";
  return message;
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

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const companyId = typeof body.company_id === "string" ? body.company_id.trim() : "";
    if (!companyId) return json({ error: "company_id é obrigatório" }, 400);

    // Quem pode mexer na equipe: admin desta empresa, ou o super admin.
    const [{ data: callerMembership }, { data: callerProfile }] = await Promise.all([
      admin.from("company_members").select("role")
        .eq("company_id", companyId).eq("user_id", user.id).maybeSingle(),
      admin.from("profiles").select("is_super_admin").eq("user_id", user.id).maybeSingle(),
    ]);
    const callerIsSuper = Boolean(callerProfile?.is_super_admin);
    if (callerMembership?.role !== "admin" && !callerIsSuper) {
      return json({ error: "Só o admin da empresa pode gerenciar a equipe." }, 403);
    }

    const adminCount = async (): Promise<number> => {
      const { count } = await admin.from("company_members")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId).eq("role", "admin");
      return count ?? 0;
    };

    // ── Cadastrar ─────────────────────────────────────────────────────────────
    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const fullName = String(body.full_name ?? "").trim();
      const role = isRole(body.role) ? body.role : "member";

      if (!fullName) return json({ error: "Informe o nome." }, 400);
      if (!email) return json({ error: "Informe o e-mail." }, 400);
      if (password.length < MIN_PASSWORD) {
        return json({ error: `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.` }, 400);
      }

      // skip_auto_company: sem isso o trigger handle_new_user criaria uma
      // empresa própria para o vendedor, e ele cairia nela em vez desta.
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, skip_auto_company: "true" },
      });
      if (createError || !created.user) {
        const message = createError?.message ?? "Falha ao criar usuário";
        const alreadyExists = /already|exists/i.test(message);
        if (!alreadyExists) return json({ error: friendlyAuthError(message) }, 400);

        // Quem foi removido da equipe fica com o login bloqueado, não apagado.
        // Cadastrar de novo o mesmo e-mail reativa essa conta — desde que ela
        // não esteja em empresa nenhuma, senão seria tomar a conta de alguém.
        const existing = await findAuthUserByEmail(admin, email);
        if (!existing) return json({ error: friendlyAuthError(message) }, 400);

        const [{ count: memberships }, { data: existingProfile }] = await Promise.all([
          admin.from("company_members").select("id", { count: "exact", head: true }).eq("user_id", existing.id),
          admin.from("profiles").select("is_super_admin").eq("user_id", existing.id).maybeSingle(),
        ]);
        if ((memberships ?? 0) > 0 || existingProfile?.is_super_admin) {
          return json({ error: friendlyAuthError(message) }, 400);
        }

        const { error: reactivateError } = await admin.auth.admin.updateUserById(existing.id, {
          password,
          ban_duration: "none",
          email_confirm: true,
          user_metadata: { full_name: fullName, skip_auto_company: "true" },
        });
        if (reactivateError) return json({ error: friendlyAuthError(reactivateError.message) }, 400);
        await admin.from("profiles").update({ full_name: fullName }).eq("user_id", existing.id);

        const { error: rejoinError } = await admin.from("company_members")
          .insert({ company_id: companyId, user_id: existing.id, role });
        if (rejoinError) return json({ error: rejoinError.message }, 400);

        return json({ ok: true, user_id: existing.id, reactivated: true });
      }

      const { error: memberError } = await admin.from("company_members")
        .insert({ company_id: companyId, user_id: created.user.id, role });
      if (memberError) {
        // Usuário sem empresa não entra em lugar nenhum: desfaz.
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: memberError.message }, 400);
      }

      return json({ ok: true, user_id: created.user.id });
    }

    // Editar e remover agem sobre alguém que já é desta empresa.
    const targetId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    if (!targetId) return json({ error: "user_id é obrigatório" }, 400);

    const { data: targetMembership } = await admin.from("company_members").select("id, role")
      .eq("company_id", companyId).eq("user_id", targetId).maybeSingle();
    if (!targetMembership) return json({ error: "Essa pessoa não faz parte da equipe." }, 404);

    // Conta compartilhada: se o usuário também está em outra empresa (ou é o
    // super admin), a senha e o nome dele não são desta empresa para trocar —
    // senão o admin de um cliente assumiria a conta de alguém de fora.
    const [{ count: otherCompanies }, { data: targetProfile }] = await Promise.all([
      admin.from("company_members").select("id", { count: "exact", head: true })
        .eq("user_id", targetId).neq("company_id", companyId),
      admin.from("profiles").select("is_super_admin").eq("user_id", targetId).maybeSingle(),
    ]);
    const sharedAccount = (otherCompanies ?? 0) > 0 || Boolean(targetProfile?.is_super_admin);

    // ── Editar ────────────────────────────────────────────────────────────────
    if (action === "update") {
      const role = body.role === undefined ? undefined : body.role;
      const fullName = typeof body.full_name === "string" ? body.full_name.trim() : undefined;
      const password = typeof body.password === "string" && body.password ? body.password : undefined;

      if (role !== undefined && !isRole(role)) return json({ error: "Papel inválido." }, 400);
      if (password !== undefined && password.length < MIN_PASSWORD) {
        return json({ error: `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.` }, 400);
      }
      if ((password !== undefined || fullName !== undefined) && sharedAccount) {
        return json({ error: "Essa conta também é usada em outra empresa; nome e senha não podem ser trocados aqui." }, 403);
      }

      if (role && role !== targetMembership.role) {
        if (targetMembership.role === "admin" && role !== "admin" && (await adminCount()) <= 1) {
          return json({ error: "A empresa precisa ter pelo menos um admin." }, 400);
        }
        const { error } = await admin.from("company_members").update({ role }).eq("id", targetMembership.id);
        if (error) return json({ error: error.message }, 400);
      }

      if (fullName !== undefined) {
        if (!fullName) return json({ error: "O nome não pode ficar vazio." }, 400);
        const { error } = await admin.from("profiles").update({ full_name: fullName }).eq("user_id", targetId);
        if (error) return json({ error: error.message }, 400);
      }

      if (password !== undefined) {
        const { error } = await admin.auth.admin.updateUserById(targetId, { password });
        if (error) return json({ error: friendlyAuthError(error.message) }, 400);
      }

      return json({ ok: true });
    }

    // ── Remover ───────────────────────────────────────────────────────────────
    if (action === "remove") {
      if (targetId === user.id) return json({ error: "Você não pode remover a si mesmo." }, 400);
      if (targetMembership.role === "admin" && (await adminCount()) <= 1) {
        return json({ error: "A empresa precisa ter pelo menos um admin." }, 400);
      }

      const { error } = await admin.from("company_members").delete().eq("id", targetMembership.id);
      if (error) return json({ error: error.message }, 400);

      // Bloqueia o login em vez de apagar a conta: contacts, conversations,
      // tasks e outras tabelas têm user_id com ON DELETE CASCADE, e apagar o
      // usuário levaria junto os contatos que ele cadastrou e as mensagens que
      // ele mandou. Conta de outra empresa (ou do super admin) segue ativa.
      if (!sharedAccount) {
        const { error: banError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: BAN_FOREVER });
        if (banError) console.error("company-team: falha ao bloquear login", banError.message);
      }

      return json({ ok: true });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (error) {
    console.error("company-team error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Erro interno" }, 500);
  }
});

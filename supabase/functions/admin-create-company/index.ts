// Cria uma empresa nova + o usuário admin dela (login e-mail/senha).
// Restrito ao super admin do produto.
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

    const { company_name, email, password, full_name } = await req.json() as {
      company_name?: string;
      email?: string;
      password?: string;
      full_name?: string;
    };

    if (!company_name?.trim() || !email?.trim() || !password || password.length < 6) {
      return json({ error: "company_name, email e password (mín. 6 caracteres) são obrigatórios" }, 400);
    }

    // skip_auto_company: o trigger handle_new_user não cria empresa automática;
    // vinculamos manualmente à empresa criada aqui.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      user_metadata: {
        full_name: full_name?.trim() || null,
        business_name: company_name.trim(),
        skip_auto_company: "true",
      },
    });
    if (createError || !created.user) {
      return json({ error: createError?.message ?? "Falha ao criar usuário" }, 400);
    }

    const { data: company, error: companyError } = await admin
      .from("companies")
      .insert({ name: company_name.trim() })
      .select("id")
      .maybeSingle();
    if (companyError || !company) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: companyError?.message ?? "Falha ao criar empresa" }, 400);
    }

    const { error: memberError } = await admin
      .from("company_members")
      .insert({ company_id: company.id, user_id: created.user.id, role: "admin" });
    if (memberError) {
      return json({ error: memberError.message }, 400);
    }

    return json({ ok: true, company_id: company.id, user_id: created.user.id });
  } catch (error) {
    console.error("admin-create-company error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Erro interno" }, 500);
  }
});

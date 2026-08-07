// Renomeia uma empresa e/ou troca o e-mail de login do dono dela.
// Restrito ao super admin do produto.
//
// O rename sozinho caberia no client (a RLS já deixa o super admin escrever em
// companies), mas o e-mail está em auth.users e só a service role muda —
// então as duas coisas ficam aqui, numa chamada só.
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

    const body = await req.json() as {
      company_id?: string;
      company_name?: string;
      email?: string;
    };
    const companyId = body.company_id?.trim();
    const name = body.company_name?.trim();
    const email = body.email?.trim();

    if (!companyId) return json({ error: "company_id é obrigatório" }, 400);
    if (!name && !email) return json({ error: "Nada para alterar" }, 400);
    if (name !== undefined && name === "") return json({ error: "O nome da empresa não pode ficar vazio" }, 400);

    // Dono = membership 'admin' mais antiga (mesma regra de public.company_owners).
    const { data: members } = await admin
      .from("company_members")
      .select("user_id, role")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    const rows = (members ?? []) as Array<{ user_id: string; role: string }>;
    const owner = rows.find((m) => m.role === "admin") ?? rows[0];

    // E-mail primeiro: é o que mais falha (endereço já em uso). Se quebrar aqui,
    // o nome ainda não mudou e o super admin corrige e tenta de novo.
    if (email) {
      if (!owner) return json({ error: "Esta empresa não tem usuário vinculado para trocar o e-mail" }, 400);
      const { error: emailError } = await admin.auth.admin.updateUserById(owner.user_id, {
        email,
        email_confirm: true,
      });
      if (emailError) {
        const msg = /already|registered|exists/i.test(emailError.message)
          ? "Este e-mail já está em uso por outro usuário."
          : emailError.message;
        return json({ error: msg }, 400);
      }
    }

    if (name) {
      const { error: nameError } = await admin
        .from("companies")
        .update({ name })
        .eq("id", companyId);
      if (nameError) return json({ error: nameError.message }, 400);
    }

    return json({ ok: true });
  } catch (error) {
    console.error("admin-update-company error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Erro interno" }, 500);
  }
});

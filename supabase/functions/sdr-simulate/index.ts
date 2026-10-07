// Simulador do SDR: responde como a IA responderia, sem enviar nada.
//
// Usa o prompt que está na tela (ainda não salvo, se for o caso), o modelo e a
// chave da empresa. As ferramentas não rodam — em vez de mandar arquivo ou
// chamar a equipe, a IA descreve entre colchetes o que faria —, então testar não
// cria agendamento, não pausa conversa e não manda mensagem para ninguém.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveCompanyId } from "../_shared/company.ts";
import { todayBrief } from "../_shared/date.ts";
import { toWhatsappFormat } from "../_shared/whatsapp-format.ts";

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

const MAX_TURNS = 30;

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

    const { companyId, error: companyError } = await resolveCompanyId(
      admin, user.id, body.company_id as string | undefined,
    );
    if (!companyId) return json({ error: companyError }, 403);

    const { data: cfg } = await admin
      .from("ai_configs")
      .select("system_prompt, model, openai_api_key, followup_timezone")
      .eq("company_id", companyId)
      .maybeSingle();
    const ai = cfg as {
      system_prompt?: string | null; model?: string | null; openai_api_key?: string | null; followup_timezone?: string | null;
    } | null;

    const apiKey = ai?.openai_api_key?.trim() || Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "Cadastre a chave da OpenAI na aba Comunicação para testar." }, 400);

    const prompt = (typeof body.prompt === "string" && body.prompt.trim()) || ai?.system_prompt?.trim() || "";
    if (!prompt) return json({ error: "Escreva ou gere o prompt antes de testar." }, 400);
    const model = (typeof body.model === "string" && body.model) || ai?.model || "gpt-4o-mini";
    const timezone = ai?.followup_timezone?.trim() || "America/Sao_Paulo";

    const turns = (Array.isArray(body.messages) ? body.messages : [])
      .slice(-MAX_TURNS)
      .map((m) => m as { role?: string; content?: string })
      .filter((m) => typeof m.content === "string" && m.content.trim())
      .map((m) => ({ role: m.role === "sdr" ? "assistant" : "user", content: String(m.content).slice(0, 2000) }));
    if (!turns.length || turns[turns.length - 1].role !== "user") {
      return json({ error: "Mande uma mensagem como se fosse o lead." }, 400);
    }

    // Biblioteca só como lista: no simulador ela não é enviada, mas a IA
    // precisa saber que existe para dizer que mandaria o arquivo certo.
    const { data: lib } = await admin.rpc("library_for_ai", { p_company_id: companyId });
    const library = ((lib ?? []) as Array<{ title?: string; description?: string | null }>)
      .slice(0, 40)
      .map((i) => `- ${i.title}${i.description ? `: ${i.description}` : ""}`)
      .join("\n");

    const system =
      `${prompt}\n\n${todayBrief(timezone)} Ao falar de datas, use sempre o ano corrente. ` +
      "Nunca confirme uma reserva por conta própria: diga que vai confirmar com a equipe. " +
      "Regras do sistema, que prevalecem sobre o prompt acima: o tempo de espera das respostas e " +
      "quais contatos você atende são controlados pela plataforma — ignore instruções do prompt " +
      "sobre aguardar, demorar, horário de resposta ou a quem responder; apenas responda à conversa.\n\n" +
      "MODO SIMULAÇÃO: nenhuma ação é executada. Onde você usaria uma ferramenta, escreva a ação entre " +
      "colchetes no começo da resposta, por exemplo [enviaria o arquivo: Pacotes Gestante] ou " +
      "[passaria para a equipe: quer desconto fora da tabela], e siga com a mensagem que o lead receberia." +
      (library ? `\n\nArquivos que você pode enviar:\n${library}` : "");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 300,
        messages: [{ role: "system", content: system }, ...turns],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.error("sdr-simulate: OpenAI", res.status, detail);
      return json({ error: res.status === 401 ? "A chave da OpenAI foi recusada." : "A OpenAI não respondeu. Tente de novo." }, 502);
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) return json({ error: "A IA não devolveu texto." }, 502);

    return json({ reply: toWhatsappFormat(reply) });
  } catch (error) {
    console.error("sdr-simulate error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Erro interno" }, 500);
  }
});

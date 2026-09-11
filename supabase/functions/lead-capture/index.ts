// Pop-up de captação: o script que o site carrega e o endpoint que recebe o lead.
//
// GET  ?token=...  -> JavaScript que desenha o pop-up (uma vez a cada 7 dias
//                     por visitante) e envia o formulário para cá.
// POST {token,...} -> cria ou atualiza o contato, aplica a etiqueta, gera o
//                     cupom de boas-vindas e manda por WhatsApp.
//
// Público por desenho: roda no site do cliente, sem login. O token identifica
// o formulário sem expor a empresa, e o que se grava é só o que o formulário
// pediu. Sem limite de taxa aqui — o cupom só sai para telefone válido, e o
// mesmo telefone não ganha dois.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { normalizePhone } from "../_shared/phone.ts";
import { OUTBOUND_COLUMNS, type OutboundConfig } from "../_shared/whatsapp-out.ts";
import { sendAutomation } from "../_shared/outbound.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
type Db = any;

type LeadForm = {
  id: string;
  company_id: string;
  token: string;
  title: string;
  subtitle: string;
  button_label: string;
  fields: string[];
  tag: string | null;
  coupon_percent: number | null;
  coupon_validity_days: number;
  success_message: string;
  theme_color: string;
  active: boolean;
};

const BASE_LABELS: Record<string, string> = {
  name: "Seu nome",
  phone: "WhatsApp com DDD",
  email: "E-mail",
  birth_date: "Data de nascimento",
};

/** O pop-up inteiro, em JS puro, com o estilo embutido. */
function popupScript(form: LeadForm, labels: Record<string, string>, endpoint: string): string {
  const fields = form.fields.map((key) => ({
    key,
    label: labels[key] ?? BASE_LABELS[key] ?? key,
    type: key === "email" ? "email" : key === "birth_date" ? "date" : key === "phone" ? "tel" : "text",
    required: key === "phone",
  }));
  const cfg = JSON.stringify({
    title: form.title, subtitle: form.subtitle, button: form.button_label, success: form.success_message,
    color: form.theme_color, fields, token: form.token, endpoint,
  });
  return `(function(){
var cfg=${cfg};
var KEY="midsam_lead_"+cfg.token;
try{var last=localStorage.getItem(KEY);if(last&&Date.now()-Number(last)<7*864e5)return;}catch(e){}
function el(t,a,c){var e=document.createElement(t);for(var k in a||{}){if(k==="style")e.style.cssText=a[k];else if(k==="text")e.textContent=a[k];else e.setAttribute(k,a[k]);}(c||[]).forEach(function(x){e.appendChild(x)});return e;}
function show(){
var ov=el("div",{style:"position:fixed;inset:0;background:rgba(20,26,46,.5);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif"});
var box=el("div",{style:"background:#fff;color:#141a2e;border-radius:16px;max-width:360px;width:100%;box-shadow:0 24px 64px -16px rgba(0,0,0,.4);overflow:hidden;position:relative"});
box.appendChild(el("div",{style:"height:8px;background:"+cfg.color}));
var close=el("button",{type:"button","aria-label":"Fechar",text:"\\u00d7",style:"position:absolute;top:10px;right:12px;border:0;background:none;font-size:24px;line-height:1;color:#6b7390;cursor:pointer"});
close.onclick=function(){dismiss()};box.appendChild(close);
var body=el("div",{style:"padding:22px 20px 20px"});
body.appendChild(el("p",{text:cfg.title,style:"margin:0 0 6px;font-size:19px;font-weight:700;line-height:1.2"}));
body.appendChild(el("p",{text:cfg.subtitle,style:"margin:0 0 14px;font-size:14px;color:#5e6784"}));
var f=el("form");var inputs={};
cfg.fields.forEach(function(fd){var i=el("input",{type:fd.type,placeholder:fd.label,name:fd.key,style:"display:block;width:100%;box-sizing:border-box;margin:0 0 10px;padding:10px 12px;border:1px solid #dde1eb;border-radius:10px;font-size:14px;outline:none"});if(fd.required)i.required=true;inputs[fd.key]=i;f.appendChild(i);});
var btn=el("button",{type:"submit",text:cfg.button,style:"width:100%;border:0;border-radius:10px;padding:12px;font-size:15px;font-weight:600;color:#fff;background:"+cfg.color+";cursor:pointer"});
f.appendChild(btn);
var msg=el("p",{style:"margin:10px 0 0;font-size:13px;color:#5e6784;min-height:18px"});
f.onsubmit=function(ev){ev.preventDefault();btn.disabled=true;btn.textContent="Enviando...";var data={token:cfg.token};for(var k in inputs)data[k]=inputs[k].value;
fetch(cfg.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(res){
if(res&&res.ok){f.style.display="none";msg.style.color="#0e6b4a";msg.textContent=cfg.success+(res.coupon?" Seu cupom: "+res.coupon:"");try{localStorage.setItem(KEY,String(Date.now()))}catch(e){}setTimeout(dismiss,6000);}
else{btn.disabled=false;btn.textContent=cfg.button;msg.style.color="#b3261e";msg.textContent=(res&&res.error)||"Não deu certo. Tente de novo.";}
}).catch(function(){btn.disabled=false;btn.textContent=cfg.button;msg.textContent="Sem conexão. Tente de novo.";});};
body.appendChild(f);body.appendChild(msg);box.appendChild(body);ov.appendChild(box);
ov.addEventListener("click",function(e){if(e.target===ov)dismiss()});
document.body.appendChild(ov);
function dismiss(){try{localStorage.setItem(KEY,String(Date.now()))}catch(e){}ov.remove();}
}
if(document.readyState==="complete")setTimeout(show,4000);else window.addEventListener("load",function(){setTimeout(show,4000)});
})();`;
}

function validEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase: Db = createClient(supabaseUrl, serviceKey);
  const url = new URL(req.url);
  const endpoint = `${supabaseUrl}/functions/v1/lead-capture`;

  const loadForm = async (token: string | null): Promise<LeadForm | null> => {
    if (!token || !/^[a-f0-9]{32}$/.test(token)) return null;
    const { data } = await supabase.from("crm_lead_forms").select("*").eq("token", token).eq("active", true).maybeSingle();
    return (data as LeadForm | null) ?? null;
  };

  // ── GET: o script ─────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const form = await loadForm(url.searchParams.get("token"));
    if (!form) return new Response("/* pop-up inativo */", { headers: { ...corsHeaders, "Content-Type": "application/javascript" } });

    const { data: fieldDefs } = await supabase
      .from("contact_fields").select("key, label").eq("company_id", form.company_id);
    const labels: Record<string, string> = {};
    for (const f of (fieldDefs ?? []) as Array<{ key: string; label: string }>) labels[f.key] = f.label;

    return new Response(popupScript(form, labels, endpoint), {
      headers: { ...corsHeaders, "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" },
    });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── POST: o lead ──────────────────────────────────────────────────────────
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const form = await loadForm(typeof body.token === "string" ? body.token : null);
    if (!form) return json({ error: "formulário inativo" }, 404);

    const phone = normalizePhone(String(body.phone ?? ""));
    if (phone.replace(/\D/g, "").length < 12) return json({ error: "Informe o WhatsApp com DDD." }, 400);
    const name = String(body.name ?? "").trim().slice(0, 120);
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 160);
    if (email && !validEmail(email)) return json({ error: "E-mail inválido." }, 400);
    const birth = /^\d{4}-\d{2}-\d{2}$/.test(String(body.birth_date ?? "")) ? String(body.birth_date) : null;

    // Só chaves que o formulário pede, e só as que existem em contact_fields.
    const { data: defs } = await supabase.from("contact_fields").select("key, type").eq("company_id", form.company_id);
    const fieldValues: Record<string, unknown> = {};
    for (const d of (defs ?? []) as Array<{ key: string; type: string }>) {
      if (!form.fields.includes(d.key)) continue;
      const v = body[d.key];
      if (v === undefined || v === null || v === "") continue;
      fieldValues[d.key] = d.type === "number" ? Number(v) : String(v).slice(0, 200);
    }

    const { data: found } = await supabase.rpc("find_contact_by_phone", { p_company_id: form.company_id, p_phone: phone });
    const existing = ((found ?? []) as Array<{ id: string; fields: Record<string, unknown>; tags: string[]; name: string; email: string | null; birth_date: string | null }>)[0];

    let contactId: string;
    let isNew = false;
    if (existing) {
      contactId = existing.id;
      const tags = new Set(existing.tags ?? []);
      if (form.tag) tags.add(form.tag);
      await supabase.from("contacts").update({
        ...(name && /^\d+$/.test(existing.name ?? "") ? { name } : {}),
        ...(email && !existing.email ? { email } : {}),
        ...(birth && !existing.birth_date ? { birth_date: birth } : {}),
        fields: { ...(existing.fields ?? {}), ...fieldValues },
        tags: [...tags],
      }).eq("id", contactId);
    } else {
      // user_id: o dono da empresa, como nas outras entradas automáticas.
      const { data: owner } = await supabase.from("company_members").select("user_id").eq("company_id", form.company_id).order("created_at").limit(1).maybeSingle();
      const { data: created, error } = await supabase.from("contacts").insert({
        user_id: (owner as { user_id?: string } | null)?.user_id,
        company_id: form.company_id,
        name: name || phone,
        phone,
        email: email || null,
        birth_date: birth,
        fields: fieldValues,
        tags: form.tag ? [form.tag] : [],
      }).select("id").maybeSingle();
      if (error || !created) return json({ error: "não foi possível cadastrar" }, 500);
      contactId = (created as { id: string }).id;
      isNew = true;
    }

    // Cupom de boas-vindas: um por contato por formulário.
    let couponCode: string | null = null;
    if (form.coupon_percent && form.coupon_percent > 0) {
      const { data: already } = await supabase.from("crm_coupons").select("code, status")
        .eq("company_id", form.company_id).eq("contact_id", contactId).eq("kind", "cupom").like("code", "BEMVINDO-%").limit(1).maybeSingle();
      if (already) {
        couponCode = (already as { code: string }).code;
      } else {
        for (let i = 0; i < 5 && !couponCode; i++) {
          const code = "BEMVINDO-" + Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[01OI]/g, "X");
          const { error } = await supabase.from("crm_coupons").insert({
            company_id: form.company_id, contact_id: contactId, code, kind: "cupom", discount_type: "percent",
            value: form.coupon_percent, expires_at: new Date(Date.now() + form.coupon_validity_days * 86_400_000).toISOString(),
          });
          if (!error) couponCode = code;
        }
      }
    }

    // WhatsApp com o cupom, se a empresa tiver número conectado.
    if (couponCode) {
      const { data: cfg } = await supabase.from("whatsapp_configs").select(OUTBOUND_COLUMNS).eq("company_id", form.company_id).eq("active", true).maybeSingle();
      if (cfg) {
        const first = name.split(/\s+/)[0] ?? "";
        const text = `${first ? `Oi ${first}! ` : "Oi! "}Seu cupom de ${form.coupon_percent}% de desconto é ${couponCode}, válido por ${form.coupon_validity_days} dias. É só apresentar na compra. 💜`;
        // O lead acabou de preencher o formulário, mas nunca escreveu no
        // WhatsApp: a janela está fechada e isto sai como template.
        const { messageId, error } = await sendAutomation(supabase, cfg as OutboundConfig, {
          phone,
          text,
          purpose: "boas_vindas",
          contactId,
          contactName: name || null,
          context: {
            codigo: couponCode,
            valor: `${form.coupon_percent}%`,
            validade: new Date(Date.now() + form.coupon_validity_days * 86_400_000).toLocaleDateString("pt-BR"),
          },
        });
        if (!error) {
          await supabase.from("conversations").insert({
            user_id: null, company_id: form.company_id, contact_id: contactId, sender: "ai", content: text,
            channel: "whatsapp", message_ref: messageId, metadata: { deliveryStatus: "sent", leadCapture: true },
          });
          await supabase.from("crm_coupons").update({ sent_at: new Date().toISOString() }).eq("company_id", form.company_id).eq("code", couponCode);
        }
      }
    }

    return json({ ok: true, new: isNew, coupon: couponCode });
  } catch (error) {
    console.error("lead-capture error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Erro interno" }, 500);
  }
});

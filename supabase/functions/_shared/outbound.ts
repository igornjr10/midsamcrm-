// Envio de automação: texto livre dentro da janela, template fora dela.
//
// A Cloud API da Meta recusa texto livre passadas 24h da última mensagem do
// cliente (erro 131047). Tudo que o CRM manda sozinho fala com quem está em
// silêncio, então quase sempre cai nesse caso.
//
// A decisão é tomada ANTES de chamar a Meta, olhando contacts.last_inbound_at:
// evita uma chamada perdida e um log de erro que não ajuda ninguém. Quando a
// janela está fechada, usa o template que a empresa mapeou para aquela
// automação (crm_automation_templates). Sem template mapeado, devolve um erro
// que diz o que fazer.
//
// Nos provedores de instância (Evolution, UAZAPI, OpenWA) não existe janela
// nem template: é sempre texto livre.

import { buildTemplatePayload, renderTemplateText, type VariableMap } from "./whatsapp-template.ts";
import { sendText, sendTemplate, type OutboundConfig } from "./whatsapp-out.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

/** 24h menos uma margem: mensagem que sai no limite chega depois dele. */
const WINDOW_MS = 24 * 3_600_000 - 5 * 60_000;

export type SendResult = {
  messageId: string | null;
  error: string | null;
  /** true quando saiu como template aprovado. */
  usedTemplate: boolean;
  /** O que o contato recebeu, para gravar no histórico do chat. */
  text: string;
};

export type AutomationContext = Record<string, string>;

const PURPOSE_LABEL: Record<string, string> = {
  giftback: "Giftback da venda",
  boas_vindas: "Cupom de boas-vindas",
  giftback_vencendo: "Giftback vencendo",
  aniversario: "Aniversário",
  reativacao: "Reativação",
  nps: "Pesquisa de satisfação",
  data: "Régua por data",
  agenda: "Lembrete de compromisso",
  pedido_status: "Status do pedido",
  chamado_status: "Status do chamado",
  vaga: "Vaga na agenda",
};

/** A empresa pode falar livremente com este contato agora? */
export async function windowOpen(supabase: Db, contactId: string | null): Promise<boolean> {
  if (!contactId) return false;
  const { data } = await supabase
    .from("contacts")
    .select("last_inbound_at")
    .eq("id", contactId)
    .maybeSingle();
  const last = (data as { last_inbound_at?: string | null } | null)?.last_inbound_at;
  if (!last) return false;
  return Date.now() - Date.parse(last) < WINDOW_MS;
}

/**
 * Manda a mensagem da automação pelo caminho que a Meta aceita agora.
 *
 * `text` é o texto livre já montado (com o nome do contato e os dados do
 * evento). `context` são esses mesmos dados avulsos, para preencher as
 * variáveis numeradas do template quando ele for necessário.
 */
export async function sendAutomation(
  supabase: Db,
  config: OutboundConfig,
  params: {
    phone: string;
    text: string;
    purpose: string;
    contactId: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    context?: AutomationContext;
  },
): Promise<SendResult> {
  const { phone, text, purpose, contactId, context } = params;

  // Fora da Meta não existe janela: texto livre sempre.
  if (config.provider !== "meta") {
    const r = await sendText(config, phone, text);
    return { ...r, usedTemplate: false, text };
  }

  if (await windowOpen(supabase, contactId)) {
    const r = await sendText(config, phone, text);
    return { ...r, usedTemplate: false, text };
  }

  const { data: mapped } = await supabase
    .from("crm_automation_templates")
    .select("template_name, template_language, variable_map, body_preview")
    .eq("company_id", config.company_id)
    .eq("purpose", purpose)
    .maybeSingle();
  const tpl = mapped as {
    template_name: string;
    template_language: string;
    variable_map: VariableMap;
    body_preview: string | null;
  } | null;

  if (!tpl?.template_name) {
    return {
      messageId: null,
      usedTemplate: false,
      text,
      error:
        `Fora da janela de 24h e sem template para "${PURPOSE_LABEL[purpose] ?? purpose}". ` +
        "Escolha um template aprovado em Configurações → Templates das automações.",
    };
  }

  const contact = {
    name: params.contactName ?? null,
    phone,
    email: params.contactEmail ?? null,
  };
  const { payload, bodyParams } = buildTemplatePayload(
    phone,
    tpl.template_name,
    tpl.template_language,
    tpl.variable_map ?? {},
    contact,
    context,
  );
  const r = await sendTemplate(config, payload);
  return {
    ...r,
    usedTemplate: true,
    // O histórico do chat mostra o que o contato leu, não o nome do template.
    text: tpl.body_preview ? renderTemplateText(tpl.body_preview, bodyParams) : text,
  };
}

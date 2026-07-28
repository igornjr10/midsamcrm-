// Montagem do payload de mensagem de template (Meta/Datafy Cloud API).
//
// Um template aprovado tem placeholders posicionais ({{1}}, {{2}}...) no HEADER
// de texto e no BODY. Cada posição é preenchida a partir de uma "fonte" — um
// campo do contato ou um texto fixo — configurada na campanha (variable_map).

export type VariableSource =
  | { source: "contact_name" }
  | { source: "contact_first_name" }
  | { source: "contact_phone" }
  | { source: "contact_email" }
  | { source: "text"; value?: string };

export interface VariableMap {
  header?: VariableSource[];
  body?: VariableSource[];
  header_media_url?: string | null;
  header_media_type?: "image" | "video" | "document" | null;
}

export interface TemplateContact {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * Resolve uma variável para o contato. A Meta rejeita parâmetro vazio, então
 * cai para "-" quando o campo do contato não está preenchido.
 */
export function resolveVariable(variable: VariableSource, contact: TemplateContact): string {
  let value = "";
  switch (variable.source) {
    case "contact_name":
      value = contact.name ?? "";
      break;
    case "contact_first_name":
      value = (contact.name ?? "").trim().split(/\s+/)[0] ?? "";
      break;
    case "contact_phone":
      value = contact.phone ?? "";
      break;
    case "contact_email":
      value = contact.email ?? "";
      break;
    case "text":
      value = variable.value ?? "";
      break;
  }
  // Quebra de linha e tab são rejeitadas pela API em parâmetros de template.
  return value.replace(/\s+/g, " ").trim() || "-";
}

export function resolveVariables(
  variables: VariableSource[] | undefined,
  contact: TemplateContact,
): string[] {
  return (variables ?? []).map((v) => resolveVariable(v, contact));
}

/** Substitui {{1}}, {{2}}... pelos valores resolvidos (para prévia e histórico). */
export function renderTemplateText(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, index) => {
    const value = params[Number(index) - 1];
    return value ?? match;
  });
}

export function buildTemplatePayload(
  to: string,
  templateName: string,
  languageCode: string,
  variableMap: VariableMap,
  contact: TemplateContact,
): { payload: Record<string, unknown>; bodyParams: string[] } {
  const components: Array<Record<string, unknown>> = [];

  const mediaUrl = variableMap.header_media_url?.trim();
  if (mediaUrl) {
    const mediaType = variableMap.header_media_type ?? "image";
    components.push({
      type: "header",
      parameters: [{ type: mediaType, [mediaType]: { link: mediaUrl } }],
    });
  } else {
    const headerParams = resolveVariables(variableMap.header, contact);
    if (headerParams.length > 0) {
      components.push({
        type: "header",
        parameters: headerParams.map((text) => ({ type: "text", text })),
      });
    }
  }

  const bodyParams = resolveVariables(variableMap.body, contact);
  if (bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: bodyParams.map((text) => ({ type: "text", text })),
    });
  }

  return {
    bodyParams,
    payload: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components.length > 0 ? { components } : {}),
      },
    },
  };
}

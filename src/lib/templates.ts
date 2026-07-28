// Leitura dos templates aprovados que a Meta devolve em /message_templates.
import type { Contact, VariableMap, VariableSource } from "@/lib/types";

export interface TemplateComponent {
  type: string; // HEADER | BODY | FOOTER | BUTTONS
  format?: string; // TEXT | IMAGE | VIDEO | DOCUMENT
  text?: string;
  buttons?: Array<{ type: string; text?: string }>;
}

export interface WhatsappTemplate {
  id?: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: TemplateComponent[];
}

function findComponent(template: WhatsappTemplate, type: string): TemplateComponent | undefined {
  return template.components?.find((c) => c.type?.toUpperCase() === type);
}

export function templateBody(template: WhatsappTemplate): string {
  return findComponent(template, "BODY")?.text ?? "";
}

export function templateFooter(template: WhatsappTemplate): string {
  return findComponent(template, "FOOTER")?.text ?? "";
}

export function templateHeader(template: WhatsappTemplate): TemplateComponent | undefined {
  return findComponent(template, "HEADER");
}

export function templateButtons(template: WhatsappTemplate): string[] {
  return (findComponent(template, "BUTTONS")?.buttons ?? [])
    .map((b) => b.text ?? "")
    .filter(Boolean);
}

/** Formato de mídia do cabeçalho, quando ele não é de texto. */
export function templateHeaderMediaType(
  template: WhatsappTemplate,
): "image" | "video" | "document" | null {
  const format = templateHeader(template)?.format?.toUpperCase();
  if (format === "IMAGE") return "image";
  if (format === "VIDEO") return "video";
  if (format === "DOCUMENT") return "document";
  return null;
}

/** Quantas variáveis posicionais o texto usa — {{1}}, {{2}}... */
export function countPlaceholders(text: string | undefined): number {
  if (!text) return 0;
  let max = 0;
  for (const match of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return max;
}

export function headerTextPlaceholders(template: WhatsappTemplate): number {
  const header = templateHeader(template);
  if (!header || header.format?.toUpperCase() !== "TEXT") return 0;
  return countPlaceholders(header.text);
}

export function bodyPlaceholders(template: WhatsappTemplate): number {
  return countPlaceholders(templateBody(template));
}

/**
 * Configuração inicial das variáveis de um template. O primeiro placeholder do
 * corpo quase sempre é a saudação ("Olá {{1}}"), então já vem com o nome.
 */
export function defaultVariables(count: number, firstIsName: boolean): VariableSource[] {
  return Array.from({ length: count }, (_, i) =>
    i === 0 && firstIsName ? { source: "contact_first_name" } : { source: "text", value: "" },
  );
}

export const VARIABLE_SOURCE_LABELS: Record<VariableSource["source"], string> = {
  contact_name: "Nome do contato",
  contact_first_name: "Primeiro nome",
  contact_phone: "Telefone",
  contact_email: "E-mail",
  text: "Texto fixo",
};

/** Mesma resolução do backend, usada só para a prévia. */
export function resolveVariable(
  variable: VariableSource,
  contact: Pick<Contact, "name" | "phone" | "email"> | null,
): string {
  let value = "";
  switch (variable.source) {
    case "contact_name":
      value = contact?.name ?? "";
      break;
    case "contact_first_name":
      value = (contact?.name ?? "").trim().split(/\s+/)[0] ?? "";
      break;
    case "contact_phone":
      value = contact?.phone ?? "";
      break;
    case "contact_email":
      value = contact?.email ?? "";
      break;
    case "text":
      value = variable.value ?? "";
      break;
  }
  return value.replace(/\s+/g, " ").trim() || "-";
}

export function renderTemplateText(text: string, params: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, index) => params[Number(index) - 1] ?? match);
}

/** Texto final do corpo para um contato, com as variáveis já substituídas. */
export function previewBody(
  template: WhatsappTemplate,
  variableMap: VariableMap,
  contact: Pick<Contact, "name" | "phone" | "email"> | null,
): string {
  const params = (variableMap.body ?? []).map((v) => resolveVariable(v, contact));
  return renderTemplateText(templateBody(template), params);
}

export function previewHeader(
  template: WhatsappTemplate,
  variableMap: VariableMap,
  contact: Pick<Contact, "name" | "phone" | "email"> | null,
): string {
  const header = templateHeader(template);
  if (!header?.text) return "";
  const params = (variableMap.header ?? []).map((v) => resolveVariable(v, contact));
  return renderTemplateText(header.text, params);
}

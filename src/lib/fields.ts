import type { Contact, ContactField, ContactFieldValue, FieldDef, RecordType } from "@/lib/types";

/**
 * Chave estável para um campo novo. Vai para contacts.fields de cada contato,
 * então nunca muda depois — renomear o campo mexe só no label.
 */
export function fieldKeyFromLabel(label: string): string {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  return slug || "campo";
}

const DAY = 86_400_000;

/** Dias entre hoje (local) e uma data YYYY-MM-DD. Negativo = já passou. */
export function daysUntil(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / DAY);
}

/** "12/10" para a data, mais "em 5 dias" quando ela está perto o bastante para importar. */
export function dateHint(iso: string): { label: string; relative: string | null; urgent: boolean } {
  const days = daysUntil(iso);
  const [y, m, d] = iso.split("-");
  const label = d && m ? `${d}/${m}${y && y !== String(new Date().getFullYear()) ? `/${y}` : ""}` : iso;
  if (days === null) return { label: iso, relative: null, urgent: false };
  if (days === 0) return { label, relative: "hoje", urgent: true };
  if (days === 1) return { label, relative: "amanhã", urgent: true };
  if (days < 0) return { label, relative: days === -1 ? "ontem" : `há ${-days} dias`, urgent: false };
  if (days <= 7) return { label, relative: `em ${days} dias`, urgent: true };
  if (days <= 30) return { label, relative: `em ${days} dias`, urgent: false };
  return { label, relative: null, urgent: false };
}

/** Texto pronto para mostrar. Null quando o contato não preencheu. */
export function formatFieldValue(field: FieldDef, value: ContactFieldValue | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (field.type === "date" && typeof value === "string") {
    const hint = dateHint(value);
    return hint.relative ? `${hint.label} · ${hint.relative}` : hint.label;
  }
  if (field.type === "number") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n.toLocaleString("pt-BR") : String(value);
  }
  return String(value);
}

export type CardField = { field: ContactField; text: string; urgent: boolean };

/** Os campos marcados para o card, já formatados, só os preenchidos. */
export function cardFields(fields: ContactField[], contact: Pick<Contact, "fields">): CardField[] {
  const values = contact.fields ?? {};
  const out: CardField[] = [];
  for (const field of fields) {
    if (!field.show_on_card) continue;
    const text = formatFieldValue(field, values[field.key]);
    if (!text) continue;
    const urgent =
      field.type === "date" && typeof values[field.key] === "string"
        ? dateHint(values[field.key] as string).urgent
        : false;
    out.push({ field, text, urgent });
  }
  return out;
}

/** Converte o que veio do input para o tipo gravado no jsonb. */
export function parseFieldInput(field: FieldDef, raw: string): ContactFieldValue {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (field.type === "number") {
    const n = Number(trimmed.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return trimmed;
}

/**
 * "Auto · Porto Seguro · vence 12/10" — os campos preenchidos de um registro
 * numa linha, sem repetir o que já está no título.
 */
export function recordSummary(
  type: Pick<RecordType, "fields" | "date_field_key">,
  values: Record<string, ContactFieldValue>,
  title?: string,
): string {
  const parts: string[] = [];
  for (const field of type.fields) {
    if (field.key === type.date_field_key) continue;
    const text = formatFieldValue(field, values[field.key]);
    if (!text || (title && title.includes(text))) continue;
    parts.push(text);
    if (parts.length === 3) break;
  }
  return parts.join(" · ");
}

// Tipos das entidades do banco. Depois que o projeto Supabase for criado e
// linkado, prefira regenerar via:
//   supabase gen types typescript --linked > src/integrations/supabase/types.ts
// e migrar estes tipos para Tables<"...">.

export interface Contact {
  id: string;
  user_id: string;
  company_id: string;
  name: string;
  phone: string | null;
  normalized_phone: string | null;
  email: string | null;
  stage: string;
  loss_reason: string | null;
  notes: string | null;
  ai_paused: boolean;
  /** Quando a IA foi pausada nesta conversa. */
  ai_paused_at: string | null;
  /**
   * "humano_respondeu" quando a pausa foi automática; "pediu_atendente" quando
   * a própria IA se calou para chamar gente; null quando foi manual.
   */
  ai_paused_reason: "humano_respondeu" | "pediu_atendente" | null;
  /** Atendente responsável. Null = ninguém pegou, a conversa é da fila. */
  assigned_to: string | null;
  assigned_at: string | null;
  /** Quando o lead pediu uma pessoa. Some assim que alguém responde. */
  needs_human_at: string | null;
  /** O que ele queria, na descrição da IA. */
  needs_human_reason: string | null;
  /** Última mensagem de qualquer lado. Mantida por trigger em conversations. */
  last_interaction_at: string | null;
  /** Última mensagem recebida do lead. */
  last_inbound_at: string | null;
  /** Última mensagem enviada por atendente ou IA. */
  last_outbound_at: string | null;
  /** Quando o contato deu sinal de que fechou (pix, comprovante, "pode emitir"...). */
  closing_signal_at: string | null;
  closing_signal_label: string | null;
  closing_signal_excerpt: string | null;
  /** "pagamento" quando o dinheiro apareceu na conversa; "intencao" quando só foi promessa. */
  closing_signal_type: "pagamento" | "intencao" | null;
  /** Só o dia e o mês importam: é o que a régua de aniversário usa. */
  birth_date: string | null;
  /** Nota de 0 a 10 que o cliente respondeu no WhatsApp. */
  nps_score: number | null;
  nps_asked_at: string | null;
  nps_answered_at: string | null;
  /** Campos personalizados (contact_fields), indexados pela chave. */
  fields: Record<string, ContactFieldValue>;
  /** Nomes das etiquetas (contact_tags). */
  tags: string[];
  created_at: string;
  updated_at: string;
}

/** O mínimo que um formulário de campos precisa (contact_fields ou record_types.fields). */
export type FieldDef = Pick<ContactField, "key" | "label" | "type" | "options">;

/**
 * Tipo de sub-registro do contato: Apólice, Pacote de sessões, Unidade.
 * Descreve os campos e diz qual é a data principal.
 */
export interface RecordType {
  id: string;
  company_id: string;
  key: string;
  label: string;
  label_plural: string;
  fields: FieldDef[];
  /** Campo (type = date) que vira main_date dos registros. */
  date_field_key: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

/** Um registro de um contato: uma apólice, um pacote, uma unidade. */
export interface ContactRecord {
  id: string;
  company_id: string;
  contact_id: string;
  type_key: string;
  title: string;
  fields: Record<string, ContactFieldValue>;
  /** Cópia de fields[date_field_key], mantida por trigger. */
  main_date: string | null;
  created_at: string;
  updated_at: string;
}

/** Etiqueta do catálogo da empresa: VIP, Atacado, Sinistro... */
export interface ContactTag {
  id: string;
  company_id: string;
  name: string;
  tone: StageTone;
  /** Aplicada pela IA, pausa a conversa e chama uma pessoa. */
  escalate: boolean;
  position: number;
  created_at: string;
}

/** Resposta pronta do chat: "/" + atalho. */
export interface QuickReply {
  id: string;
  company_id: string;
  shortcut: string;
  title: string;
  /** Aceita {{nome}} e {{primeiro_nome}}. */
  content: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export type ContactFieldValue = string | number | null;
export type ContactFieldType = "text" | "number" | "date" | "select";

/** Campo extra do contato, definido pela empresa (ou pelo modelo do nicho). */
export interface ContactField {
  id: string;
  company_id: string;
  /** Chave em contacts.fields. Imutável depois de criada. */
  key: string;
  label: string;
  type: ContactFieldType;
  /** Só para type = "select". */
  options: string[];
  /** Aparece no card do Pipeline e no painel do Chat. */
  show_on_card: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

/**
 * Telefone legível: 559984573986 -> (99) 98457-3986.
 *
 * Só formata o que parece telefone. Contato criado antes da tradução do @lid
 * tem 15 dígitos no lugar do número — enfeitar aquilo de parênteses faria um id
 * opaco passar por telefone de verdade.
 */
export function formatPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;

  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return raw ?? null;
}

/**
 * O que escrever como nome do contato.
 *
 * Quem chega pelo WhatsApp sem nome na agenda nasce com o próprio telefone no
 * lugar do nome — e a tela repetia o mesmo número duas vezes, como título e
 * como subtítulo. Aqui o número vira telefone formatado uma vez só.
 */
export function contactLabel(contact: Pick<Contact, "name" | "phone">): string {
  const name = contact.name?.trim() ?? "";
  const soDigitos = /^\d+$/.test(name);
  if (name && !soDigitos) return name;
  return formatPhone(contact.phone) ?? (name || "Sem nome");
}

/** O telefone, quando ele já não é o próprio título. */
export function contactSubtitle(contact: Pick<Contact, "name" | "phone">): string | null {
  const phone = formatPhone(contact.phone);
  if (!phone) return null;
  return contactLabel(contact) === phone ? null : phone;
}

/**
 * A letra do avatar.
 *
 * Com o telefone virando título, `charAt(0)` passou a devolver "(" — todo
 * contato sem nome ficava com um parêntese no círculo. Sem letra no nome, o
 * primeiro dígito do número serve melhor: distingue os contatos entre si.
 */
export function contactInitial(contact: Pick<Contact, "name" | "phone">): string {
  const letra = (contact.name ?? "").match(/\p{L}/u);
  if (letra) return letra[0].toUpperCase();
  const digito = (contact.phone ?? contact.name ?? "").replace(/\D/g, "");
  return digito ? digito.slice(-4, -3) || digito[0] : "?";
}

/** Recortes de contato que viram lista de disparo. */
export type ContactFilter = "all" | "closing" | "waiting" | "cold" | "no_reply";

export const CONTACT_FILTERS: Array<{ id: ContactFilter; label: string; hint: string }> = [
  { id: "all", label: "Todos os contatos", hint: "" },
  { id: "closing", label: "Deram sinal de fechamento", hint: "Falaram em pix, comprovante, entrada, pode emitir..." },
  { id: "waiting", label: "Aguardando nossa resposta", hint: "A última mensagem é do lead" },
  { id: "no_reply", label: "Sem resposta há 3+ dias", hint: "O lead falou, ninguém respondeu desde então" },
  { id: "cold", label: "Sem interação há 30+ dias", hint: "Candidatos a reativação" },
];

const DAY = 24 * 60 * 60 * 1000;

/** Mesma regra em Contatos e no disparo, para as duas listas nunca divergirem. */
export function matchesContactFilter(contact: Contact, filter: ContactFilter, now = Date.now()): boolean {
  const inbound = contact.last_inbound_at ? new Date(contact.last_inbound_at).getTime() : null;
  const outbound = contact.last_outbound_at ? new Date(contact.last_outbound_at).getTime() : null;
  const last = contact.last_interaction_at ? new Date(contact.last_interaction_at).getTime() : null;

  switch (filter) {
    case "closing":
      return !!contact.closing_signal_at;
    case "waiting":
      return inbound !== null && (outbound === null || inbound > outbound);
    case "no_reply":
      return inbound !== null && (outbound === null || inbound > outbound) && now - inbound >= 3 * DAY;
    case "cold":
      return last !== null && now - last >= 30 * DAY;
    default:
      return true;
  }
}

export interface Conversation {
  id: string;
  user_id: string;
  company_id: string;
  contact_id: string;
  sender: "user" | "contact" | "ai";
  content: string;
  channel: string;
  message_ref: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/**
 * Tipo do compromisso. Os cinco base são fixos; a empresa pode ter outros
 * (appointment_kinds), vindos do modelo do nicho — por isso é string.
 */
export type AppointmentKind = string;

/** Tipo de compromisso extra da empresa (degustação, consulta, assembleia...). */
export interface AppointmentKindDef {
  id: string;
  company_id: string;
  key: string;
  label: string;
  tone: StageTone;
  position: number;
  created_at: string;
}
/** pending = pedido do lead que o SDR IA registrou, aguardando confirmação. */
export type AppointmentStatus = "pending" | "scheduled" | "done" | "canceled";

export interface Appointment {
  id: string;
  user_id: string;
  company_id: string;
  contact_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  kind: AppointmentKind;
  /** Sempre preenchido: a agenda é desenhada sobre o início do compromisso. */
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  status: AppointmentStatus;
  /** Evento correspondente no Google Calendar. Nulo = só existe no CRM. */
  google_event_id: string | null;
  google_synced_at: string | null;
  /** Profissional, sala ou equipamento que o compromisso ocupa. */
  resource_id: string | null;
  /** Lembrete do dia anterior: quando saiu, e o que o cliente respondeu. */
  reminder_sent_at: string | null;
  confirmed_at: string | null;
  confirmation_reply: string | null;
  created_at: string;
  updated_at: string;
}

/** Quem ou o que atende: a profissional, a sala, o laser. */
export interface Resource {
  id: string;
  company_id: string;
  name: string;
  kind: "profissional" | "sala" | "equipamento" | "outro";
  active: boolean;
  position: number;
  created_at: string;
}

export const RESOURCE_KINDS: Array<{ id: Resource["kind"]; label: string }> = [
  { id: "profissional", label: "Profissional" },
  { id: "sala", label: "Sala" },
  { id: "equipamento", label: "Equipamento" },
  { id: "outro", label: "Outro" },
];

/** Quem espera um horário. */
export interface WaitlistEntry {
  id: string;
  company_id: string;
  contact_id: string;
  resource_id: string | null;
  notes: string | null;
  status: "aguardando" | "atendido" | "cancelado";
  created_at: string;
}

// ── Pedidos ─────────────────────────────────────────────────────────────────

export type OrderStatus = "recebido" | "preparo" | "saiu" | "entregue" | "cancelado";

export interface OrderItem {
  name: string;
  qty: number;
  /** Unitário. Null quando a IA registrou sem saber o preço. */
  price: number | null;
}

export interface Order {
  id: string;
  company_id: string;
  contact_id: string | null;
  number: number;
  items: OrderItem[];
  total: number | null;
  status: OrderStatus;
  delivery_address: string | null;
  notes: string | null;
  created_by: "user" | "ai";
  created_at: string;
  updated_at: string;
}

export const ORDER_STATUSES: Array<{ id: OrderStatus; label: string; badge: string }> = [
  { id: "recebido", label: "Recebido", badge: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  { id: "preparo", label: "Em preparo", badge: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  { id: "saiu", label: "Saiu para entrega", badge: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300" },
  { id: "entregue", label: "Entregue", badge: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  { id: "cancelado", label: "Cancelado", badge: "border-border text-muted-foreground" },
];

/** Soma dos itens com preço. Null quando nenhum item tem preço. */
export function orderTotal(items: OrderItem[]): number | null {
  let total = 0;
  let any = false;
  for (const i of items) {
    if (i.price === null || i.price === undefined) continue;
    total += i.price * (Number(i.qty) || 1);
    any = true;
  }
  return any ? Math.round(total * 100) / 100 : null;
}

// ── Chamados ────────────────────────────────────────────────────────────────

export type TicketStatus = "aberto" | "em_andamento" | "aguardando" | "resolvido" | "cancelado";
export type TicketPriority = "baixa" | "normal" | "alta" | "urgente";

export interface Ticket {
  id: string;
  company_id: string;
  contact_id: string | null;
  number: number;
  title: string;
  description: string | null;
  category: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_to: string | null;
  due_at: string | null;
  resolved_at: string | null;
  created_by: "user" | "ai";
  created_at: string;
  updated_at: string;
}

export const TICKET_STATUSES: Array<{ id: TicketStatus; label: string; badge: string }> = [
  { id: "aberto", label: "Aberto", badge: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  { id: "em_andamento", label: "Em andamento", badge: "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300" },
  { id: "aguardando", label: "Aguardando", badge: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  { id: "resolvido", label: "Resolvido", badge: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  { id: "cancelado", label: "Encerrado", badge: "border-border text-muted-foreground" },
];

export const TICKET_PRIORITIES: Array<{ id: TicketPriority; label: string; badge: string }> = [
  { id: "baixa", label: "Baixa", badge: "border-border text-muted-foreground" },
  { id: "normal", label: "Normal", badge: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  { id: "alta", label: "Alta", badge: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  { id: "urgente", label: "Urgente", badge: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300" },
];

/** Estado da conexão com o Google Agenda, vindo da edge function. */
export interface GoogleCalendarStatus {
  connected: boolean;
  /** false quando o acesso foi revogado na conta Google: precisa reconectar. */
  active?: boolean;
  google_email?: string | null;
  calendar_id?: string | null;
  last_sync_at?: string | null;
  last_error?: string | null;
}

export interface GoogleCalendarSyncResult {
  connected: boolean;
  /** Compromissos enviados ao Google. */
  pushed?: number;
  failed?: number;
  /** Mudanças que vieram do Google para a agenda. */
  applied?: number;
  needs_reconnect?: boolean;
  error?: string | null;
}

export type WhatsappProvider = "meta" | "evolution" | "uazapi" | "openwa";

export interface WhatsappConfig {
  id: string;
  user_id: string;
  company_id: string;
  provider: WhatsappProvider;
  /** Nulos quando o provider não é "meta". */
  phone_number_id: string | null;
  waba_id: string | null;
  access_token: string | null;
  /** Instância nos provedores não-oficiais (Evolution, UAZAPI). */
  instance_name: string | null;
  instance_id: string | null;
  instance_token: string | null;
  webhook_verify_token: string;
  app_id: string | null;
  active: boolean;
  label: string | null;
  phone_number: string | null;
  api_base_url: string;
  created_at: string;
  updated_at: string;
}

export interface AiConfig {
  id: string;
  company_id: string;
  enabled: boolean;
  system_prompt: string | null;
  model: string;
  openai_api_key: string | null;
  /** Pausa a IA no contato assim que um atendente humano responde a conversa. */
  pause_ai_on_human_reply: boolean;
  /** A IA não responde nem faz follow-up de contato em etapa de Ganho ou Perdido. */
  ai_only_open_stages: boolean;
  // Follow-up automático (cadência de cobrança de quem parou de responder).
  followup_enabled: boolean;
  followup_timezone: string;
  followup_window_start: number;
  followup_window_end: number;
  followup_skip_weekends: boolean;
  followup_only_open_stages: boolean;
  // Horário de atendimento da IA. Desligado = ela responde a qualquer hora.
  reply_window_enabled: boolean;
  reply_window_start: number;
  reply_window_end: number;
  reply_skip_weekends: boolean;
  /** Aviso mandado uma vez a cada 12h fora do horário. Null = silêncio total. */
  reply_offhours_message: string | null;
  created_at: string;
  updated_at: string;
}

/** Nicho de mercado da empresa — define o pacote de módulos que ela recebe. */
export interface Niche {
  key: string;
  name: string;
  description: string | null;
  position: number;
}

/** Um módulo do produto, já resolvido para uma empresa (ver company_feature_set). */
export interface CompanyFeature {
  feature_key: string;
  label: string;
  route: string | null;
  /** Core não pode ser desligado: é o produto (Pipeline, Contatos, Chat). */
  core: boolean;
  enabled: boolean;
}

/** Cota de envios da empresa. Sem linha = ilimitado (o consumo segue medido). */
export interface CompanyPlan {
  company_id: string;
  monthly_coins: number;
  /** true = passa do teto e vira pós-pago; false = bloqueia o envio. */
  allow_overage: boolean;
}

/** Consumo do mês corrente, já somado pelo banco. */
export interface CompanyUsage {
  used: number;
  /** Null quando a empresa não tem plano definido. */
  monthly_coins: number | null;
  allow_overage: boolean;
  remaining: number | null;
  period_start: string;
}

/** As três fixas mais "data", que dispara a partir de um campo de data do contato. */
export type RelationshipKind = "aniversario" | "reativacao" | "nps" | "data" | "agenda";

/**
 * Régua de relacionamento: falar com quem já é cliente sem ninguém lembrar.
 *
 * Diferente do follow-up, que cobra quem sumiu no meio da conversa: aqui o
 * gatilho é uma data, um tempo parado ou um negócio fechado.
 */
export interface RelationshipRule {
  id: string;
  company_id: string;
  kind: RelationshipKind;
  enabled: boolean;
  /** Aceita {{nome}} e {{primeiro_nome}}. */
  message: string;
  /** reativacao: dias parado que disparam a mensagem. */
  inactive_days: number;
  /** nps: dias depois de fechar até perguntar. */
  ask_after_days: number;
  /** Silêncio entre dois envios da mesma régua para o mesmo contato. */
  cooldown_days: number;
  /** data: nome que aparece na tela e nos envios. */
  title: string | null;
  /** data: chave do campo (contact_fields, type = date). */
  field_key: string | null;
  /** data: negativo = dias antes; positivo = depois; 0 = no dia. */
  offset_days: number;
  created_at: string;
  updated_at: string;
}

/** Membro da empresa que pode ser responsável por uma conversa. */
export interface CompanyTeamMember {
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
}

/** Nome curto de um atendente: o que cabe num seletor de 1 linha. */
export function teamLabel(member: CompanyTeamMember): string {
  return member.full_name?.trim() || member.email.split("@")[0];
}

/**
 * Passo da cadência de follow-up.
 * - text     -> envia `message` como está ({{nome}}, {{primeiro_nome}})
 * - ai       -> o agente escreve seguindo `message` como instrução
 * - template -> template aprovado, único que funciona fora das 24h
 */
export type FollowupKind = "text" | "ai" | "template";

export interface FollowupStep {
  id: string;
  company_id: string;
  step_order: number;
  delay_hours: number;
  kind: FollowupKind;
  message: string | null;
  template_name: string | null;
  template_language: string;
  template_body: string | null;
  variable_map: VariableMap;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** Passo em edição na tela (ainda sem id/company_id no banco). */
export type FollowupStepDraft = Pick<
  FollowupStep,
  | "delay_hours"
  | "kind"
  | "message"
  | "template_name"
  | "template_language"
  | "template_body"
  | "variable_map"
  | "active"
>;

export type FollowupLogStatus = "sent" | "failed" | "skipped";

export interface FollowupLog {
  id: string;
  company_id: string;
  contact_id: string;
  step_id: string | null;
  step_order: number;
  kind: FollowupKind;
  status: FollowupLogStatus;
  content: string | null;
  message_ref: string | null;
  error: string | null;
  created_at: string;
  contacts: { id: string; name: string; phone: string | null } | null;
}

// Fonte de cada variável ({{1}}, {{2}}...) de um template aprovado.
export type VariableSource =
  | { source: "contact_name" }
  | { source: "contact_first_name" }
  | { source: "contact_phone" }
  | { source: "contact_email" }
  | { source: "text"; value: string };

export interface VariableMap {
  header?: VariableSource[];
  body?: VariableSource[];
  header_media_url?: string | null;
  header_media_type?: "image" | "video" | "document" | null;
}

export type CampaignStatus = "draft" | "running" | "paused" | "done" | "canceled";

export interface Campaign {
  id: string;
  company_id: string;
  user_id: string;
  name: string;
  template_name: string;
  template_language: string;
  template_body: string | null;
  variable_map: VariableMap;
  status: CampaignStatus;
  total_count: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CampaignTarget {
  id: string;
  campaign_id: string;
  company_id: string;
  contact_id: string | null;
  phone: string;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  message_ref: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface Company {
  id: string;
  name: string;
  /** Nicho: define o pacote de módulos. Null = tudo liberado. */
  niche_key: string | null;
  created_at: string;
  updated_at: string;
}

export type LibraryKind = "cardapio" | "orcamento" | "outro";

/** Arquivo da biblioteca da empresa — o que a IA pode enviar pelo WhatsApp. */
export interface LibraryItem {
  id: string;
  company_id: string;
  user_id: string;
  kind: LibraryKind;
  title: string;
  /** É por aqui que a IA decide qual arquivo responde o pedido do lead. */
  description: string | null;
  file_path: string;
  file_url: string;
  mimetype: string;
  media_type: "image" | "document" | "video";
  size_bytes: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export const LIBRARY_KINDS: Array<{ id: LibraryKind; label: string; hint: string }> = [
  { id: "cardapio", label: "Cardápio", hint: "Fotos e PDFs do cardápio" },
  { id: "orcamento", label: "Orçamentos", hint: "Tabelas e propostas modelo" },
  { id: "outro", label: "Outros", hint: "Material de apoio" },
];

export type StageTone =
  | "slate" | "sky" | "indigo" | "violet" | "teal" | "amber" | "emerald" | "rose";
export type StageKind = "open" | "won" | "lost";

/** Etapa do funil. Cada empresa tem as suas (tabela pipeline_stages). */
export interface PipelineStage {
  id: string;
  company_id: string;
  /** Valor gravado em contacts.stage. Imutável depois de criada. */
  key: string;
  name: string;
  tone: StageTone;
  kind: StageKind;
  position: number;
  created_at: string;
  updated_at: string;
}

/**
 * Paleta das etapas, do frio (lead novo) ao quente (negociação), com verde e
 * vermelho reservados pro desfecho. Fica aqui pra coluna do Pipeline, o selo em
 * Contatos e a etiqueta do Chat nunca discordarem.
 */
export const STAGE_TONES: Record<StageTone, { label: string; dot: string; badge: string }> = {
  slate: { label: "Cinza", dot: "bg-slate-400", badge: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  sky: { label: "Azul", dot: "bg-sky-500", badge: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  indigo: { label: "Índigo", dot: "bg-indigo-500", badge: "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300" },
  violet: { label: "Roxo", dot: "bg-violet-500", badge: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300" },
  teal: { label: "Turquesa", dot: "bg-teal-500", badge: "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300" },
  amber: { label: "Âmbar", dot: "bg-amber-500", badge: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  emerald: { label: "Verde", dot: "bg-emerald-500", badge: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  rose: { label: "Vermelho", dot: "bg-rose-500", badge: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300" },
};

const FALLBACK_TONE = { label: "Cinza", dot: "bg-muted-foreground", badge: "border-border text-muted-foreground" };

export function getToneClasses(tone: string) {
  return STAGE_TONES[tone as StageTone] ?? FALLBACK_TONE;
}

/**
 * Etapa de um contato. O contato pode apontar para uma etapa que foi excluída
 * (ou estar renderizando antes das etapas carregarem), então nunca devolve
 * undefined: no pior caso mostra a própria chave em cinza.
 */
export function findStage(stages: PipelineStage[], key: string) {
  return stages.find((s) => s.key === key) ?? null;
}

export function getStageLabel(stages: PipelineStage[], key: string): string {
  return findStage(stages, key)?.name ?? key;
}

export function getStageTone(stages: PipelineStage[], key: string) {
  return getToneClasses(findStage(stages, key)?.tone ?? "");
}

import { useMemo } from "react";
import { BadgeCheck, CalendarDays, Clock, Hand, HandCoins, MessageSquareReply } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useContactsQuery, useAppointmentsQuery } from "@/hooks/queries";
import { matchesContactFilter, type Appointment, type Contact } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const DIA = 86_400_000;

function haQuantoTempo(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / DIA);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
}

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * O que ocupa a área da conversa quando nenhuma está aberta.
 *
 * Antes era um "Selecione um contato" — espaço nobre gasto com uma instrução
 * óbvia. Agora mostra o que decide o dia: quem pagou, quem prometeu, quem está
 * esperando resposta e o que está agendado. Tudo clicável, abrindo a conversa.
 */
export default function ChatOverview({ onSelect }: { onSelect: (contactId: string) => void }) {
  const { company } = useAuth();
  const { data: contacts = [] } = useContactsQuery(company?.id);

  const hoje = useMemo(() => {
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    return { from: inicio.toISOString(), to: new Date(inicio.getTime() + 7 * DIA).toISOString() };
  }, []);
  const { data: agenda = [] } = useAppointmentsQuery(company?.id, hoje);

  const pagaram = useMemo(
    () =>
      contacts
        .filter((c) => c.closing_signal_type === "pagamento")
        .sort((a, b) => (b.closing_signal_at ?? "").localeCompare(a.closing_signal_at ?? "")),
    [contacts],
  );

  const sinalizaram = useMemo(
    () =>
      contacts
        .filter((c) => !!c.closing_signal_at && c.closing_signal_type !== "pagamento")
        .sort((a, b) => (b.closing_signal_at ?? "").localeCompare(a.closing_signal_at ?? "")),
    [contacts],
  );

  // O lead pediu uma pessoa e a IA se calou esperando. Vem antes de tudo: é a
  // única fila em que alguém está parado esperando por gente.
  const pediramAtendente = useMemo(
    () =>
      contacts
        .filter((c) => !!c.needs_human_at)
        .sort((a, b) => (a.needs_human_at ?? "").localeCompare(b.needs_human_at ?? "")),
    [contacts],
  );

  // Mais antigo primeiro: quem espera há mais tempo é o mais urgente.
  const aguardando = useMemo(
    () =>
      contacts
        .filter((c) => matchesContactFilter(c, "waiting"))
        .sort((a, b) => (a.last_inbound_at ?? "").localeCompare(b.last_inbound_at ?? "")),
    [contacts],
  );

  const compromissosHoje = useMemo(() => {
    const fim = new Date();
    fim.setHours(23, 59, 59, 999);
    return agenda.filter(
      (a) => a.status === "scheduled" && new Date(a.starts_at).getTime() <= fim.getTime(),
    );
  }, [agenda]);

  const tiles = [
    { label: "Pediram atendente", valor: pediramAtendente.length, icon: Hand, tom: "text-rose-600 dark:text-rose-400" },
    { label: "Pagaram", valor: pagaram.length, icon: BadgeCheck, tom: "text-emerald-600 dark:text-emerald-400" },
    { label: "Sinalizaram", valor: sinalizaram.length, icon: HandCoins, tom: "text-amber-600 dark:text-amber-400" },
    { label: "Aguardando", valor: aguardando.length, icon: MessageSquareReply, tom: "text-sky-600 dark:text-sky-400" },
    { label: "Hoje na agenda", valor: compromissosHoje.length, icon: CalendarDays, tom: "text-primary" },
  ];

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map(({ label, valor, icon: Icon, tom }) => (
            <div key={label} className="rounded-xl border bg-card p-3.5">
              <Icon className={cn("h-4 w-4", tom)} />
              <p className="tabular mt-2 text-2xl font-bold leading-none">{valor}</p>
              <p className="mt-1 text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        {pediramAtendente.length > 0 && (
          <Secao
            titulo="Pediram atendente"
            descricao="A IA chamou você e parou de responder — os mais antigos primeiro"
            vazio=""
            itens={pediramAtendente.slice(0, 8)}
            onSelect={onSelect}
            tom="rose"
            modo="humano"
          />
        )}

        <Secao
          titulo="Pagamento identificado"
          descricao="Falaram em pix, comprovante ou entrada — já movidos para Ganho"
          vazio="Nenhum pagamento identificado ainda."
          itens={pagaram.slice(0, 6)}
          onSelect={onSelect}
          tom="emerald"
        />

        <Secao
          titulo="Sinalizaram fechamento"
          descricao="Disseram que vão fechar, mas o pagamento não apareceu"
          vazio="Ninguém com promessa em aberto."
          itens={sinalizaram.slice(0, 6)}
          onSelect={onSelect}
          tom="amber"
        />

        <Secao
          titulo="Aguardando sua resposta"
          descricao="A última mensagem é do lead — os mais antigos primeiro"
          vazio="Nenhuma conversa esperando resposta."
          itens={aguardando.slice(0, 8)}
          onSelect={onSelect}
          tom="sky"
          modo="espera"
        />

        {compromissosHoje.length > 0 && (
          <div>
            <p className="text-sm font-semibold">Hoje na agenda</p>
            <div className="mt-2 space-y-1.5">
              {compromissosHoje.map((a: Appointment) => (
                <div key={a.id} className="flex items-center gap-2 rounded-lg border p-2.5 text-sm">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="tabular shrink-0 text-xs text-muted-foreground">
                    {a.all_day ? "dia inteiro" : hora(a.starts_at)}
                  </span>
                  <span className="truncate">{a.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

const TONS = {
  emerald: "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/40",
  amber: "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/40",
  sky: "border-sky-300 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/40",
  rose: "border-rose-300 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/40",
} as const;

/** O que a linha mostra como data e como legenda muda com a fila. */
type Modo = "sinal" | "espera" | "humano";

function Secao({
  titulo,
  descricao,
  vazio,
  itens,
  onSelect,
  tom,
  modo = "sinal",
}: {
  titulo: string;
  descricao: string;
  vazio: string;
  itens: Contact[];
  onSelect: (contactId: string) => void;
  tom: keyof typeof TONS;
  modo?: Modo;
}) {
  return (
    <div>
      <p className="text-sm font-semibold">{titulo}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>

      {itens.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">{vazio}</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {itens.map((c) => {
            const quando =
              modo === "espera" ? c.last_inbound_at
              : modo === "humano" ? c.needs_human_at
              : c.closing_signal_at;
            const legenda =
              modo === "espera"
                ? c.phone ?? "sem telefone"
                : modo === "humano"
                  ? c.needs_human_reason ?? "Pediu para falar com uma pessoa"
                  : `${c.closing_signal_label ?? ""}${
                      c.closing_signal_excerpt ? ` · “${c.closing_signal_excerpt}”` : ""
                    }`;
            return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors hover:brightness-95 dark:hover:brightness-125",
                TONS[tom],
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background/70 text-xs font-semibold">
                {c.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <span className="tabular shrink-0 text-[11px] text-muted-foreground">
                    {quando && haQuantoTempo(quando)}
                  </span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">{legenda}</span>
              </span>
            </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

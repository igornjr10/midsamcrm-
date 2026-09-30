import { Bot, Check, CheckCheck, Kanban, LayoutDashboard, MessageSquare, Sparkles, Users } from "lucide-react";
import { LogoMark } from "@/components/layout/Logo";
import { cn } from "@/lib/utils";

/*
 * Telas ilustrativas do produto, desenhadas em HTML em vez de print: acompanham
 * o tema claro/escuro e não borram em tela retina. Os nomes e valores são de
 * exemplo — nada aqui vem de cliente real.
 */

const COLUMNS = [
  {
    title: "Novo lead",
    tone: "bg-sky-500",
    cards: [
      { name: "Clínica Bem Viver", value: "R$ 2.400", tag: "Site" },
      { name: "Ótica Visão Clara", value: "R$ 890", tag: "WhatsApp" },
    ],
  },
  {
    title: "Em conversa",
    tone: "bg-amber-500",
    cards: [
      { name: "Studio Forma Fit", value: "R$ 1.750", tag: "IA qualificou", ai: true },
      { name: "Doce Encanto", value: "R$ 620", tag: "Retorno hoje" },
    ],
  },
  {
    title: "Proposta",
    tone: "bg-violet-500",
    cards: [{ name: "Alfa Corretora", value: "R$ 5.200", tag: "Enviada" }],
  },
  {
    title: "Fechado",
    tone: "bg-emerald-500",
    cards: [{ name: "Pet Shop Amigo", value: "R$ 3.100", tag: "Ganho", won: true }],
  },
];

export function PipelineMock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/70 bg-card shadow-modal ring-1 ring-black/[0.02]",
        className,
      )}
    >
      {/* Barra da janela */}
      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <div className="mx-auto hidden rounded-md bg-background/80 px-3 py-0.5 text-[10px] text-muted-foreground sm:block">
          Midsam CRM · Funil de vendas
        </div>
      </div>

      <div className="flex">
        {/* Menu lateral reduzido */}
        <div className="hidden w-12 shrink-0 flex-col items-center gap-3 border-r border-border/70 py-4 sm:flex">
          <LogoMark className="h-6 w-6" />
          {[Kanban, MessageSquare, Users, Bot, LayoutDashboard].map((Icon, i) => (
            <span
              key={i}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground",
                i === 0 && "bg-primary/10 text-primary",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1 p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold">Funil de vendas</p>
              <p className="text-[10px] text-muted-foreground">6 negociações · R$ 13.960 em aberto</p>
            </div>
            <span className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground">
              + Negociação
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {COLUMNS.map((col, ci) => (
              <div
                key={col.title}
                className={cn("rounded-lg bg-muted/50 p-2", ci > 1 && "hidden md:block")}
              >
                <div className="mb-2 flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", col.tone)} />
                  <span className="text-[10px] font-medium">{col.title}</span>
                  <span className="ml-auto text-[9px] text-muted-foreground">{col.cards.length}</span>
                </div>
                <div className="space-y-1.5">
                  {col.cards.map((card) => (
                    <div
                      key={card.name}
                      className="rounded-md border border-border/60 bg-card p-2 shadow-card"
                    >
                      <p className="truncate text-[10px] font-medium">{card.name}</p>
                      <div className="mt-1 flex items-center justify-between gap-1">
                        <span className="tabular text-[10px] text-muted-foreground">{card.value}</span>
                        <span
                          className={cn(
                            "flex items-center gap-0.5 truncate rounded px-1 py-px text-[8px] font-medium",
                            "ai" in card && card.ai
                              ? "bg-primary/10 text-primary"
                              : "won" in card && card.won
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {"ai" in card && card.ai && <Sparkles className="h-2 w-2" />}
                          {card.tag}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Balão de notificação que flutua sobre o funil no hero. */
export function MessageToast({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex w-64 items-start gap-3 rounded-xl border border-border/70 bg-card/95 p-3 shadow-popover backdrop-blur",
        className,
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-semibold text-white">
        AL
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold">
          Ana Lima
          <span className="text-[9px] font-normal text-muted-foreground">agora · WhatsApp</span>
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          Oi! Vi o anúncio de vocês, qual o valor do plano mensal?
        </p>
      </div>
    </div>
  );
}

/** Cartão da IA que qualificou um lead, também flutuante no hero. */
export function AiToast({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "w-60 rounded-xl border border-primary/25 bg-card/95 p-3 shadow-popover backdrop-blur",
        className,
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
        <Sparkles className="h-3 w-3" />
        SDR com IA
      </p>
      <p className="mt-1 text-[11px] leading-snug">
        Lead qualificado: quer começar este mês, orçamento confirmado.
      </p>
      <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
        <Check className="h-3 w-3 text-emerald-500" />
        Movido para <span className="font-medium text-foreground">Em conversa</span>
      </p>
    </div>
  );
}

const CHAT: { from: "lead" | "ai"; text: string; time: string }[] = [
  { from: "lead", text: "Boa noite! Vocês atendem aos sábados?", time: "22:14" },
  {
    from: "ai",
    text: "Boa noite, Carla! Atendemos sim, das 8h às 13h. Você procura avaliação ou já é paciente?",
    time: "22:14",
  },
  { from: "lead", text: "Avaliação. Quanto custa?", time: "22:15" },
  {
    from: "ai",
    text: "A avaliação é gratuita 😊 Tenho horário sábado às 9h ou às 10h30. Qual fica melhor?",
    time: "22:15",
  },
  { from: "lead", text: "9h está ótimo!", time: "22:16" },
];

/** Conversa de exemplo do SDR atendendo fora do horário comercial. */
export function ChatMock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/70 bg-card shadow-modal",
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-500/90 text-xs font-semibold text-white">
          CS
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Carla Souza</p>
          <p className="text-[11px] text-muted-foreground">Veio do Instagram · novo lead</p>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
          <Bot className="h-3 w-3" />
          IA atendendo
        </span>
      </div>

      <div className="space-y-2.5 bg-muted/30 px-4 py-4">
        {CHAT.map((m, i) => (
          <div key={i} className={cn("flex", m.from === "ai" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[82%] rounded-2xl px-3 py-2 text-[12.5px] leading-snug shadow-card",
                m.from === "ai"
                  ? "rounded-br-md bg-primary text-primary-foreground"
                  : "rounded-bl-md bg-card",
              )}
            >
              {m.text}
              <span
                className={cn(
                  "ml-2 inline-flex items-center gap-0.5 align-bottom text-[9px]",
                  m.from === "ai" ? "text-primary-foreground/70" : "text-muted-foreground",
                )}
              >
                {m.time}
                {m.from === "ai" && <CheckCheck className="h-3 w-3" />}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-border/70 px-4 py-3 text-[11px] text-muted-foreground">
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <span>
          Avaliação agendada para sábado, 9h · lead movido para{" "}
          <span className="font-medium text-foreground">Agendado</span>
        </span>
      </div>
    </div>
  );
}

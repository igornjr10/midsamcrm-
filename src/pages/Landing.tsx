import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BarChart3, Bot, CalendarDays, Check, ChevronDown, Gift, Kanban, LifeBuoy, Megaphone,
  Menu, MessageCircle, MessagesSquare, Moon, MousePointerClick, QrCode, Repeat, Rocket, ShieldCheck,
  ShoppingBag, Sparkles, Sun, X,
} from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { AiToast, ChatMock, MessageToast, PipelineMock } from "@/components/landing/Mockups";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

/*
 * Página de apresentação: é o que vê quem abre o endereço do CRM sem estar
 * logado. Não existe cadastro público — as contas são criadas pela Midsam —,
 * então toda chamada leva para o WhatsApp da Midsam, e quem já é cliente
 * tem o "Entrar" no topo.
 */

/** WhatsApp comercial da Midsam, só dígitos com DDI. */
const MIDSAM_WHATSAPP = "559984573986";

function whatsappUrl(text = "Olá! Quero conhecer o Midsam CRM.") {
  return `https://wa.me/${MIDSAM_WHATSAPP}?text=${encodeURIComponent(text)}`;
}

/** Faz o bloco subir suavemente na primeira vez que entra na tela. */
function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Sem IntersectionObserver (navegador antigo, captura de tela): mostra direto.
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        "transition-all duration-700 ease-out motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none",
        visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

function WhatsappButton({
  children,
  className,
  size = "lg",
}: {
  children: React.ReactNode;
  className?: string;
  size?: "md" | "lg";
}) {
  return (
    <a
      href={whatsappUrl()}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group inline-flex items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground shadow-glow-md transition-all hover:-translate-y-0.5 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30",
        size === "lg" ? "h-12 px-6 text-[15px]" : "h-9 px-4 text-sm",
        className,
      )}
    >
      <MessageCircle className={size === "lg" ? "h-5 w-5" : "h-4 w-4"} />
      {children}
      <ArrowRight
        className={cn(
          "transition-transform group-hover:translate-x-0.5",
          size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5",
        )}
      />
    </a>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: string;
  className?: string;
}) {
  return (
    <Reveal className={cn("mx-auto max-w-2xl text-center", className)}>
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
      <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-[44px] md:leading-[1.1]">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          {description}
        </p>
      )}
    </Reveal>
  );
}

const NAV = [
  { href: "#recursos", label: "Recursos" },
  { href: "#ia", label: "SDR com IA" },
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#duvidas", label: "Dúvidas" },
];

const SEGMENTS = [
  "Comércio e varejo",
  "Clínicas e saúde",
  "Corretoras e seguros",
  "Restaurantes e delivery",
  "Serviços e agências",
  "Educação e cursos",
  "Academias e estúdios",
  "Beleza e estética",
];

const BEFORE = [
  "Lead esquecido no celular de um vendedor",
  "Ninguém sabe em que pé está cada negociação",
  "Follow-up que depende da memória de alguém",
  "Mensagem de fim de semana respondida na segunda",
  "Relatório de vendas montado na mão, em planilha",
];

const AFTER = [
  "Todas as conversas do WhatsApp num só lugar, com histórico",
  "Funil visual com valor e etapa de cada negociação",
  "Retorno automático quando o cliente para de responder",
  "IA atendendo na hora, inclusive à noite e no sábado",
  "Painéis de vendas por período, etapa e vendedor",
];

type Feature = {
  icon: typeof Kanban;
  title: string;
  description: string;
  wide?: boolean;
};

const FEATURES: Feature[] = [
  {
    icon: Kanban,
    title: "Funil de vendas visual",
    description:
      "Arraste cada negociação entre as etapas e veja na hora quanto dinheiro está em jogo e onde cada cliente parou.",
    wide: true,
  },
  {
    icon: MessagesSquare,
    title: "WhatsApp da equipe inteira",
    description:
      "Um número, vários atendentes. Conversas com fotos, áudios e documentos, direto no CRM.",
  },
  {
    icon: Bot,
    title: "SDR com inteligência artificial",
    description:
      "Responde novos contatos na hora, qualifica o interesse e avança o lead no funil — no horário que você definir.",
  },
  {
    icon: Megaphone,
    title: "Disparos em massa",
    description:
      "Campanhas para listas e segmentos, com a mensagem personalizada com o nome de cada cliente.",
  },
  {
    icon: Repeat,
    title: "Réguas de relacionamento",
    description:
      "Aniversário, reativação de cliente parado e pesquisa de satisfação enviados sozinhos, no dia certo.",
  },
  {
    icon: CalendarDays,
    title: "Agenda com Google",
    description: "Reuniões e tarefas do time sincronizadas com o Google Agenda de cada pessoa.",
  },
  {
    icon: MousePointerClick,
    title: "Captação no seu site",
    description: "Um pop-up no seu site que manda cada contato direto para a etapa certa do funil.",
  },
  {
    icon: ShoppingBag,
    title: "Pedidos e catálogo",
    description: "Receba e acompanhe pedidos com catálogo, fotos e endereço de entrega.",
  },
  {
    icon: Gift,
    title: "Cupons e cashback",
    description: "Cupom de boas-vindas e bônus por compra para o cliente voltar a comprar.",
  },
  {
    icon: BarChart3,
    title: "Painéis e metas",
    description: "Vendas por período, por etapa e por vendedor. Sem planilha, sem esperar o fim do mês.",
  },
  {
    icon: LifeBuoy,
    title: "Chamados e pós-venda",
    description: "Pedidos de suporte organizados por prioridade e prazo, para nenhum cliente ficar sem resposta.",
  },
];

/** Miniatura do funil dentro do card largo. Valores de exemplo. */
const PIPELINE_PREVIEW = [
  { name: "Novo lead", value: "R$ 18 mil", tone: "bg-sky-500", fill: "90%" },
  { name: "Em conversa", value: "R$ 12 mil", tone: "bg-amber-500", fill: "62%" },
  { name: "Proposta", value: "R$ 7 mil", tone: "bg-violet-500", fill: "38%" },
  { name: "Fechado", value: "R$ 9 mil", tone: "bg-emerald-500", fill: "48%" },
];

const AI_POINTS = [
  "Responde em segundos, inclusive fora do horário comercial",
  "Segue a personalidade e as regras que você escrever",
  "Faz as perguntas certas e qualifica cada contato",
  "Retoma a conversa quando o cliente some",
  "Registra tudo no CRM e move o lead no funil",
];

const STEPS = [
  {
    icon: MessageCircle,
    title: "Converse com a Midsam",
    description:
      "Conte pelo WhatsApp como sua empresa vende e atende hoje. Mostramos o CRM funcionando com o seu tipo de negócio.",
  },
  {
    icon: QrCode,
    title: "Conectamos tudo",
    description:
      "Criamos a conta da sua empresa, você conecta o WhatsApp que já usa lendo um QR code e montamos o seu funil.",
  },
  {
    icon: Rocket,
    title: "Sua equipe vende mais",
    description:
      "Cada atendente com o próprio login, cada conversa registrada e a IA cuidando dos leads que chegam fora de hora.",
  },
];

const FAQ = [
  {
    q: "Preciso trocar meu número de WhatsApp?",
    a: "Não. Você conecta o número que a empresa já usa lendo um QR code, do mesmo jeito que no WhatsApp Web. Os clientes continuam falando com o mesmo número de sempre.",
  },
  {
    q: "Vários atendentes podem usar o mesmo número?",
    a: "Sim. Toda a equipe atende pelo mesmo WhatsApp dentro do CRM, cada pessoa com o próprio login, e o histórico de cada conversa fica guardado para quem pegar o atendimento depois.",
  },
  {
    q: "A IA responde tudo sozinha?",
    a: "Você decide. O SDR com IA pode ser ligado ou desligado, atende no horário que você escolher e segue as instruções que você escrever sobre o seu negócio, seus preços e o seu jeito de falar.",
  },
  {
    q: "Funciona no celular?",
    a: "Funciona. O Midsam CRM roda no navegador, no computador e no celular, sem precisar instalar nada.",
  },
  {
    q: "Meus dados ficam separados dos de outras empresas?",
    a: "Sim. Cada empresa tem o próprio espaço no CRM e só enxerga os próprios contatos, conversas e vendas. Cada pessoa entra com e-mail e senha próprios.",
  },
  {
    q: "Como eu começo?",
    a: "Chame a Midsam no WhatsApp. A gente entende a sua operação, cria a sua conta e acompanha a implantação com você.",
  },
];

export default function Landing() {
  const { resolved, toggleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const previous = document.title;
    document.title = "Midsam CRM · Vendas e atendimento pelo WhatsApp com IA";
    // Os links do menu são âncoras da própria página: rolagem suave só aqui,
    // para não mudar o comportamento das telas do CRM.
    const html = document.documentElement;
    html.style.scrollBehavior = "smooth";
    return () => {
      document.title = previous;
      html.style.scrollBehavior = "";
    };
  }, []);

  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      {/* ── Topo ─────────────────────────────────────────────────────────── */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-300",
          scrolled || menuOpen
            ? "border-b border-border/60 bg-background/80 backdrop-blur-xl"
            : "border-b border-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <a href="#topo" aria-label="Midsam CRM, voltar ao topo">
            <Logo />
          </a>

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={toggleTheme}
              aria-label={resolved === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {resolved === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </button>
            <Link
              to="/login"
              className="hidden h-9 items-center rounded-lg px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted sm:flex"
            >
              Entrar
            </Link>
            <WhatsappButton size="md" className="hidden sm:inline-flex">
              Falar com a Midsam
            </WhatsappButton>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
              aria-expanded={menuOpen}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted md:hidden"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="border-t border-border/60 px-4 pb-4 pt-2 md:hidden">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Link
                to="/login"
                className="flex h-10 items-center justify-center rounded-xl border text-sm font-medium"
              >
                Entrar
              </Link>
              <WhatsappButton size="md" className="h-10">
                WhatsApp
              </WhatsappButton>
            </div>
          </div>
        )}
      </header>

      <main id="topo">
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section className="relative pt-32 sm:pt-40">
          <div
            aria-hidden
            className="bg-dot-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_65%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 h-[640px] w-[1100px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/25 blur-[120px] dark:bg-primary/20"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute right-[-10%] top-[30%] h-[380px] w-[380px] rounded-full bg-violet-500/15 blur-[100px]"
          />

          <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal className="mx-auto max-w-3xl text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" />
                CRM com WhatsApp e IA
                <span className="hidden sm:inline">para pequenas e médias empresas</span>
              </span>
              <h1 className="mt-6 text-balance text-[40px] font-bold leading-[1.05] tracking-tight sm:text-6xl md:text-[68px]">
                Transforme conversas do WhatsApp em{" "}
                <span className="bg-gradient-to-r from-primary via-blue-500 to-violet-500 bg-clip-text text-transparent">
                  vendas
                </span>
                .
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
                Funil de vendas, atendimento no WhatsApp e um SDR com inteligência artificial num só lugar.
                Sua equipe responde mais rápido, não perde nenhum lead e acompanha cada venda do primeiro
                “oi” ao fechamento.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <WhatsappButton>Falar com a Midsam</WhatsappButton>
                <a
                  href="#recursos"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card/60 px-6 text-[15px] font-semibold backdrop-blur transition-colors hover:bg-muted"
                >
                  Ver recursos
                </a>
              </div>
              <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {["Conexão por QR code", "Implantação acompanhada", "Suporte em português"].map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-primary" />
                    {t}
                  </li>
                ))}
              </ul>
            </Reveal>

            {/* Produto */}
            <Reveal delay={150} className="relative mx-auto mt-16 max-w-5xl sm:mt-20">
              <div
                aria-hidden
                className="absolute -inset-x-6 -inset-y-6 rounded-[32px] bg-gradient-to-b from-primary/20 via-primary/5 to-transparent blur-2xl"
              />
              <div className="relative [perspective:2000px]">
                <PipelineMock className="relative md:[transform:rotateX(6deg)] md:[transform-origin:top]" />
              </div>
              <MessageToast className="absolute -bottom-8 -left-6 hidden animate-float motion-reduce:animate-none lg:flex xl:-left-20" />
              <AiToast className="absolute -right-6 -top-10 hidden animate-float-delayed motion-reduce:animate-none lg:block xl:-right-20" />
            </Reveal>
          </div>
        </section>

        {/* ── Segmentos ──────────────────────────────────────────────────── */}
        <section className="py-16 sm:py-20">
          <Reveal className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-center text-sm font-medium text-muted-foreground">
              Feito para quem vende e atende pelo WhatsApp
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2.5">
              {SEGMENTS.map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-border/70 bg-card px-4 py-2 text-sm text-foreground/80 shadow-card"
                >
                  {s}
                </span>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ── Antes e depois ─────────────────────────────────────────────── */}
        <section className="py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="Por que um CRM"
              title="Venda que depende de memória escapa pelos dedos."
              description="Quando o atendimento vive espalhado em celulares, o cliente espera, o lead esfria e ninguém sabe quanto está para fechar."
            />
            <div className="mt-14 grid gap-5 md:grid-cols-2">
              <Reveal className="rounded-2xl border border-border/70 bg-card/60 p-7 sm:p-8">
                <p className="text-sm font-semibold text-muted-foreground">Sem o Midsam CRM</p>
                <ul className="mt-5 space-y-4">
                  {BEFORE.map((t) => (
                    <li key={t} className="flex items-start gap-3 text-[15px] text-muted-foreground">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                        <X className="h-3 w-3 text-destructive" />
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              </Reveal>
              <Reveal
                delay={120}
                className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card p-7 shadow-card-hover sm:p-8"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-primary/15 blur-3xl"
                />
                <p className="relative text-sm font-semibold text-primary">Com o Midsam CRM</p>
                <ul className="relative mt-5 space-y-4">
                  {AFTER.map((t) => (
                    <li key={t} className="flex items-start gap-3 text-[15px]">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15">
                        <Check className="h-3 w-3 text-primary" />
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Recursos ───────────────────────────────────────────────────── */}
        <section id="recursos" className="scroll-mt-20 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="Recursos"
              title="Tudo o que o seu time comercial precisa. Num lugar só."
              description="Do primeiro contato ao pós-venda, sem pular entre planilha, celular e bloco de notas."
            />
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <Reveal
                  key={f.title}
                  delay={(i % 3) * 80}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border border-border/70 bg-card p-6 shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-card-hover",
                    f.wide && "sm:col-span-2",
                  )}
                >
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/10 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
                  />
                  <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                    <f.icon className="h-5 w-5" />
                  </span>
                  <h3 className="relative mt-5 text-lg font-semibold">{f.title}</h3>
                  <p className="relative mt-2 text-[15px] leading-relaxed text-muted-foreground">
                    {f.description}
                  </p>
                  {f.wide && (
                    <div className="relative mt-6 hidden grid-cols-4 gap-2 sm:grid">
                      {PIPELINE_PREVIEW.map((stage) => (
                        <div key={stage.name} className="rounded-xl border border-border/60 bg-muted/40 p-3">
                          <div className="flex items-center gap-1.5">
                            <span className={cn("h-1.5 w-1.5 rounded-full", stage.tone)} />
                            <span className="truncate text-xs font-medium">{stage.name}</span>
                          </div>
                          <p className="tabular mt-2 text-lg font-semibold">{stage.value}</p>
                          <div className="mt-2 h-1 overflow-hidden rounded-full bg-border/70">
                            <div className={cn("h-full rounded-full", stage.tone)} style={{ width: stage.fill }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── SDR com IA ─────────────────────────────────────────────────── */}
        <section id="ia" className="relative scroll-mt-20 py-16 sm:py-24">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.08] blur-[110px]"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
            <Reveal>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">SDR com IA</p>
              <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-[44px] md:leading-[1.1]">
                Um pré-vendedor que atende às 22h de sábado.
              </h2>
              <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                O lead que chega fora de hora é o que mais escapa. O SDR com IA do Midsam responde na hora,
                entende o que a pessoa procura e deixa tudo pronto para o seu time fechar.
              </p>
              <ul className="mt-8 space-y-3.5">
                {AI_POINTS.map((t) => (
                  <li key={t} className="flex items-start gap-3 text-[15px]">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
              <WhatsappButton className="mt-9">Quero ver a IA funcionando</WhatsappButton>
            </Reveal>
            <Reveal delay={150} className="relative">
              <div
                aria-hidden
                className="absolute -inset-6 rounded-[32px] bg-gradient-to-tr from-primary/25 to-violet-500/20 blur-3xl"
              />
              <ChatMock className="relative" />
            </Reveal>
          </div>
        </section>

        {/* ── Como funciona ──────────────────────────────────────────────── */}
        <section id="como-funciona" className="scroll-mt-20 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="Como funciona"
              title="Do primeiro contato à equipe vendendo, com a gente do seu lado."
            />
            <div className="relative mt-14 grid gap-5 md:grid-cols-3">
              <div
                aria-hidden
                className="absolute left-[16%] right-[16%] top-[38px] hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block"
              />
              {STEPS.map((s, i) => (
                <Reveal
                  key={s.title}
                  delay={i * 120}
                  className="relative rounded-2xl border border-border/70 bg-card p-7 text-center shadow-card"
                >
                  <span className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-glow-md">
                    <s.icon className="h-5 w-5" />
                  </span>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Passo {i + 1}
                  </p>
                  <h3 className="mt-1.5 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{s.description}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Dúvidas ────────────────────────────────────────────────────── */}
        <section id="duvidas" className="scroll-mt-20 py-16 sm:py-24">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <SectionHeading eyebrow="Dúvidas" title="Perguntas frequentes" />
            <Reveal className="mt-12 divide-y divide-border/70 rounded-2xl border border-border/70 bg-card shadow-card">
              {FAQ.map((item) => (
                <details key={item.q} className="group px-6 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-[15px] font-semibold">
                    {item.q}
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <p className="-mt-1 pb-5 text-[15px] leading-relaxed text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </Reveal>
          </div>
        </section>

        {/* ── Chamada final ──────────────────────────────────────────────── */}
        <section className="px-4 py-16 sm:px-6 sm:py-24">
          <Reveal className="relative mx-auto max-w-6xl overflow-hidden rounded-[28px] bg-gradient-to-br from-[hsl(222_78%_40%)] via-[hsl(226_80%_48%)] to-[hsl(262_70%_52%)] px-6 py-16 text-center text-white shadow-modal sm:px-12 sm:py-20">
            <div
              aria-hidden
              className="bg-dot-grid pointer-events-none absolute inset-0 opacity-20 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/15 blur-3xl"
            />
            <div className="relative mx-auto max-w-2xl">
              <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-5xl sm:leading-[1.08]">
                Pronto para vender mais pelo WhatsApp?
              </h2>
              <p className="mt-5 text-pretty text-base text-white/80 sm:text-lg">
                Fale com a Midsam, conte como a sua empresa atende hoje e veja o CRM funcionando com o seu
                tipo de negócio.
              </p>
              <a
                href={whatsappUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="group mt-9 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-7 text-[15px] font-semibold text-[hsl(222_78%_40%)] shadow-lg transition-all hover:-translate-y-0.5 hover:bg-white/95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40"
              >
                <MessageCircle className="h-5 w-5" />
                Chamar no WhatsApp
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <p className="mt-5 flex items-center justify-center gap-1.5 text-sm text-white/70">
                <ShieldCheck className="h-4 w-4" />
                Sem compromisso: é só uma conversa.
              </p>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ── Rodapé ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 py-10 sm:flex-row sm:px-6">
          <div className="flex flex-col items-center gap-2 sm:items-start">
            <Logo />
            <p className="text-sm text-muted-foreground">Vendas, atendimento e relacionamento num só lugar.</p>
          </div>
          <div className="flex items-center gap-5 text-sm text-muted-foreground">
            <a href="#recursos" className="hover:text-foreground">
              Recursos
            </a>
            <a href={whatsappUrl()} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
              WhatsApp
            </a>
            <Link to="/privacidade" className="hover:text-foreground">
              Privacidade
            </Link>
            <Link to="/termos" className="hover:text-foreground">
              Termos
            </Link>
            <Link to="/login" className="font-medium text-foreground hover:text-primary">
              Entrar
            </Link>
          </div>
        </div>
        <p className="pb-8 text-center text-xs text-muted-foreground/70">
          © {new Date().getFullYear()} Midsam. Todos os direitos reservados.
        </p>
      </footer>

      {/* Atalho fixo para o WhatsApp no celular, onde o topo some ao rolar. */}
      <a
        href={whatsappUrl()}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Falar com a Midsam no WhatsApp"
        className={cn(
          "fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-modal transition-all hover:scale-105 sm:hidden",
          scrolled ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
        )}
      >
        <MessageCircle className="h-6 w-6" />
      </a>
    </div>
  );
}

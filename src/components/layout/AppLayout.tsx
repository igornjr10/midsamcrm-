import { useEffect, useState } from "react";
import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import {
  Kanban, Users, MessageSquare, CalendarDays, Settings, LogOut, Loader2, Bot, Library,
  Building2, Megaphone, Moon, Sun, Eye, Menu, X, ShoppingBag, LifeBuoy,
  LayoutDashboard, Receipt, ClipboardCheck, Filter, Gift, MousePointerClick,
  PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useContactsRealtime, useAtendimentoAlerts, useUnreadContacts, useFeatures,
} from "@/hooks/queries";
import { useTheme } from "@/hooks/useTheme";
import { Logo, LogoMark } from "@/components/layout/Logo";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_GROUPS = [
  {
    label: "Vendas",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/", label: "Pipeline", icon: Kanban },
      { to: "/contatos", label: "Contatos", icon: Users },
      { to: "/vendas", label: "Vendas", icon: Receipt },
      { to: "/agenda", label: "Agenda", icon: CalendarDays },
      { to: "/vendedor", label: "Painel do Vendedor", icon: ClipboardCheck },
    ],
  },
  {
    label: "Atendimento",
    items: [
      { to: "/chat", label: "Chat", icon: MessageSquare },
      { to: "/pedidos", label: "Pedidos", icon: ShoppingBag },
      { to: "/chamados", label: "Chamados", icon: LifeBuoy },
      { to: "/disparos", label: "Disparos", icon: Megaphone },
      { to: "/segmentos", label: "Segmentos", icon: Filter },
      { to: "/bonus", label: "Bônus", icon: Gift },
      { to: "/captacao", label: "Captação", icon: MousePointerClick },
      { to: "/sdr", label: "SDR IA", icon: Bot },
      { to: "/biblioteca", label: "Biblioteca", icon: Library },
    ],
  },
  {
    label: "Sistema",
    items: [{ to: "/configuracoes", label: "Configurações", icon: Settings }],
  },
];

const SUPER_ADMIN_GROUP = {
  label: "Administração",
  items: [{ to: "/empresas", label: "Empresas", icon: Building2 }],
};

const navLinkClass = (collapsed: boolean) =>
  ({ isActive }: { isActive: boolean }) =>
    cn(
      "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors duration-150",
      // Recolhida (só no desktop): o item vira um quadrado com o ícone no centro.
      collapsed && "lg:justify-center lg:px-0",
      isActive
        ? "bg-primary/10 text-primary dark:bg-primary/15"
        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
    );

// A preferência de sidebar recolhida vale só no desktop e sobrevive ao reload.
const SIDEBAR_COLLAPSED_KEY = "midsam.sidebar.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export default function AppLayout() {
  const { user, company, ownCompany, isSuperAdmin, isImpersonating, loading, leaveCompany, signOut } =
    useAuth();
  const { resolved, toggleTheme } = useTheme();

  // No mobile a navegação é uma gaveta sobre o conteúdo; a partir de lg ela
  // volta a ser coluna fixa e este estado deixa de ter efeito.
  const [navOpen, setNavOpen] = useState(false);
  // Desktop: sidebar recolhida em coluna de ícones. No mobile a gaveta ignora
  // este estado — ela já some por completo quando fechada.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { pathname } = useLocation();

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* armazenamento indisponível: a preferência dura só esta sessão */
    }
  }, [collapsed]);

  // Fecha ao navegar — senão a gaveta cobre a tela que o usuário acabou de abrir.
  useEffect(() => setNavOpen(false), [pathname]);

  // Trava o scroll do fundo enquanto a gaveta está aberta.
  useEffect(() => {
    if (!navOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  // Uma assinatura só para o app inteiro: o contato muda sozinho quando o
  // gatilho do banco identifica pagamento e move a etapa.
  useContactsRealtime(company?.id);
  // Som, título e notificação de mensagem nova valem em qualquer tela — por
  // isso moram aqui, e não no Chat.
  useAtendimentoAlerts(company?.id);
  const { count: unreadCount } = useUnreadContacts(company?.id, user?.id);
  // Módulos do pacote desta empresa. Esconder o item é UX — quem recusa de
  // verdade é a RLS e as edge functions; digitar a URL não pode dar acesso.
  const { routeEnabled } = useFeatures(company?.id);

  const groups = (isSuperAdmin ? [...NAV_GROUPS, SUPER_ADMIN_GROUP] : NAV_GROUPS)
    // Grupo sem nenhum item liberado não vira um título solto no menu.
    .filter((group) => group.items.some((item) => routeEnabled(item.to)));

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <LogoMark className="h-10 w-10 animate-pulse" />
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  const initials = (company?.name ?? user.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen bg-background">
      {/* Fundo escurecido: só existe no mobile, com a gaveta aberta. */}
      {navOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-foreground/40 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <aside
        className={cn(
          "z-40 flex w-64 flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar",
          // Mobile: gaveta deslizante fora do fluxo.
          "fixed inset-y-0 left-0 h-screen transition-[transform,width] duration-200",
          navOpen ? "translate-x-0" : "-translate-x-full",
          // lg: volta a ser coluna do layout, sempre visível. bottom/left
          // precisam ser desfeitos — `inset-y-0` deixaria o sticky com top e
          // bottom ao mesmo tempo, que não é o que a coluna fixa quer.
          "lg:sticky lg:bottom-auto lg:left-auto lg:top-0 lg:translate-x-0",
          collapsed && "lg:w-[68px]",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center justify-between border-b border-sidebar-border px-4",
            collapsed && "lg:flex-col lg:justify-center lg:gap-0.5 lg:px-0",
          )}
        >
          {collapsed ? (
            <>
              <Logo className="lg:hidden" />
              <LogoMark className="hidden h-7 w-7 lg:block" />
            </>
          ) : (
            <Logo />
          )}
          <button
            onClick={() => setNavOpen(false)}
            aria-label="Fechar menu"
            className="-mr-1 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
          {/* Só no desktop: recolhe para uma coluna de ícones e expande de volta. */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            aria-expanded={!collapsed}
            className={cn(
              "hidden rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground lg:block",
              collapsed ? "p-1" : "-mr-1 p-2",
            )}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
        </div>

        <nav
          className={cn(
            "scrollbar-slim flex-1 space-y-6 overflow-y-auto px-3 py-5",
            collapsed && "lg:space-y-3 lg:px-2.5",
          )}
        >
          {groups.map((group, index) => (
            <div key={group.label}>
              {/* Recolhida: o título do grupo vira uma linha divisória. */}
              <p
                className={cn(
                  "px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60",
                  collapsed && "lg:hidden",
                )}
              >
                {group.label}
              </p>
              {collapsed && index > 0 && (
                <div className="mx-2 mb-3 hidden border-t border-sidebar-border lg:block" />
              )}
              <div className="space-y-0.5">
                {group.items.filter((item) => routeEnabled(item.to)).map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={navLinkClass(collapsed)}
                    title={collapsed ? item.label : undefined}
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon
                          className={cn(
                            "h-[18px] w-[18px] shrink-0 transition-colors",
                            isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                          )}
                        />
                        <span className={cn("truncate", collapsed && "lg:hidden")}>{item.label}</span>
                        {/* Quantas conversas têm mensagem que este atendente
                            ainda não viu. Fica no menu porque o aviso precisa
                            existir mesmo com o Chat fechado. */}
                        {item.to === "/chat" && unreadCount > 0 && (
                          <span
                            className={cn(
                              "tabular ml-auto min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-primary-foreground",
                              // Recolhida: o contador sobe para o canto do ícone.
                              collapsed &&
                                "lg:absolute lg:right-1 lg:top-0.5 lg:ml-0 lg:min-w-4 lg:px-1 lg:text-[10px]",
                            )}
                          >
                            {unreadCount > 99 ? "99+" : unreadCount}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={cn("border-t border-sidebar-border p-3", collapsed && "lg:p-2")}>
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-xl border border-border/60 bg-muted/40 px-2.5 py-2",
              collapsed && "lg:justify-center lg:border-0 lg:bg-transparent lg:p-0",
            )}
            title={collapsed ? [company?.name, user.email].filter(Boolean).join(" · ") : undefined}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-sm font-semibold text-primary-foreground shadow-glow-sm">
              {initials}
            </span>
            <div className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
              {company?.name && (
                <p className="truncate text-sm font-medium leading-tight">{company.name}</p>
              )}
              <p className="truncate text-xs leading-tight text-muted-foreground">{user.email}</p>
            </div>
          </div>

          <div className={cn("mt-2 flex items-center gap-1", collapsed && "lg:flex-col lg:gap-0.5")}>
            <button
              onClick={toggleTheme}
              title={resolved === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
              aria-label={resolved === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
              className={cn(
                "flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground",
                collapsed && "lg:w-full lg:flex-none lg:justify-center lg:px-0",
              )}
            >
              {resolved === "dark" ? (
                <Sun className="h-[18px] w-[18px] shrink-0" />
              ) : (
                <Moon className="h-[18px] w-[18px] shrink-0" />
              )}
              <span className={cn(collapsed && "lg:hidden")}>Tema</span>
            </button>
            <button
              onClick={() => void signOut()}
              title="Sair da conta"
              aria-label="Sair da conta"
              className={cn(
                "flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
                collapsed && "lg:w-full lg:flex-none lg:justify-center lg:px-0",
              )}
            >
              <LogOut className="h-[18px] w-[18px] shrink-0" />
              <span className={cn(collapsed && "lg:hidden")}>Sair</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="scrollbar-slim min-w-0 flex-1 overflow-auto">
        {/* Barra do mobile: sem ela não há como abrir a navegação. */}
        <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border/70 bg-background/80 px-4 backdrop-blur-md lg:hidden">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Abrir menu"
            className="-ml-2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Logo />
          <span className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-sm font-semibold text-primary-foreground shadow-glow-sm">
            {initials}
          </span>
        </div>

        {/* Deixa explícito que tudo em tela é da conta do cliente, não da sua. */}
        {isImpersonating && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning/10 px-4 py-2.5 text-sm sm:px-6 lg:px-8">
            <Eye className="h-4 w-4 shrink-0 text-warning" />
            <span>
              Você está na conta de <strong>{company?.name}</strong>. Tudo que criar ou enviar vai para
              essa empresa.
            </span>
            <button
              onClick={leaveCompany}
              className="ml-auto font-medium text-warning underline-offset-4 hover:underline"
            >
              {ownCompany ? `Voltar para ${ownCompany.name}` : "Sair desta conta"}
            </button>
          </div>
        )}
        <div className="mx-auto max-w-[1600px] animate-fade-in-up p-4 sm:p-6 lg:p-8">
          {/* Sem empresa ativa não há o que carregar: toda query fica
              desabilitada e, no react-query, query desabilitada permanece
              "pendente" para sempre — a tela ficava girando sem fim. O super
              admin sem vínculo com empresa nenhuma caía exatamente aqui. */}
          {!company && pathname !== "/empresas" ? (
            <EmptyState
              icon={Building2}
              title="Escolha uma empresa"
              description={
                isSuperAdmin
                  ? "Sua conta administra a plataforma, mas não pertence a nenhuma empresa. Entre em uma para ver o CRM dela."
                  : "Sua conta ainda não está vinculada a nenhuma empresa. Fale com o suporte."
              }
              action={
                isSuperAdmin ? (
                  <NavLink to="/empresas" className={buttonVariants({ size: "sm" })}>
                    <Building2 className="h-4 w-4" />
                    Ver empresas
                  </NavLink>
                ) : null
              }
              className="mt-10"
            />
          ) : routeEnabled(pathname) ? (
            <Outlet />
          ) : (
            <Navigate to="/" replace />
          )}
        </div>
      </main>
    </div>
  );
}

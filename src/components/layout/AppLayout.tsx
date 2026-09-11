import { useEffect, useState } from "react";
import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import {
  Kanban, Users, MessageSquare, CalendarDays, Settings, LogOut, Loader2, Bot, Library,
  Building2, Megaphone, Moon, Sun, Eye, Menu, X, ShoppingBag, LifeBuoy,
  LayoutDashboard, Receipt, ClipboardCheck, Filter, Gift, MousePointerClick,
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

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors duration-150",
    isActive
      ? "bg-primary/10 text-primary dark:bg-primary/15"
      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
  );

export default function AppLayout() {
  const { user, company, ownCompany, isSuperAdmin, isImpersonating, loading, leaveCompany, signOut } =
    useAuth();
  const { resolved, toggleTheme } = useTheme();

  // No mobile a navegação é uma gaveta sobre o conteúdo; a partir de lg ela
  // volta a ser coluna fixa e este estado deixa de ter efeito.
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();

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
          "fixed inset-y-0 left-0 h-screen transition-transform duration-200",
          navOpen ? "translate-x-0" : "-translate-x-full",
          // lg: volta a ser coluna do layout, sempre visível. bottom/left
          // precisam ser desfeitos — `inset-y-0` deixaria o sticky com top e
          // bottom ao mesmo tempo, que não é o que a coluna fixa quer.
          "lg:sticky lg:bottom-auto lg:left-auto lg:top-0 lg:translate-x-0",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
          <Logo />
          <button
            onClick={() => setNavOpen(false)}
            aria-label="Fechar menu"
            className="-mr-1 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="scrollbar-slim flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.filter((item) => routeEnabled(item.to)).map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={navLinkClass}
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon
                          className={cn(
                            "h-[18px] w-[18px] shrink-0 transition-colors",
                            isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                          )}
                        />
                        {item.label}
                        {/* Quantas conversas têm mensagem que este atendente
                            ainda não viu. Fica no menu porque o aviso precisa
                            existir mesmo com o Chat fechado. */}
                        {item.to === "/chat" && unreadCount > 0 && (
                          <span className="tabular ml-auto min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-primary-foreground">
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

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-muted/40 px-2.5 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-sm font-semibold text-primary-foreground shadow-glow-sm">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              {company?.name && (
                <p className="truncate text-sm font-medium leading-tight">{company.name}</p>
              )}
              <p className="truncate text-xs leading-tight text-muted-foreground">{user.email}</p>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-1">
            <button
              onClick={toggleTheme}
              title={resolved === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
              aria-label={resolved === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
              className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              {resolved === "dark" ? (
                <Sun className="h-[18px] w-[18px] shrink-0" />
              ) : (
                <Moon className="h-[18px] w-[18px] shrink-0" />
              )}
              Tema
            </button>
            <button
              onClick={() => void signOut()}
              title="Sair da conta"
              aria-label="Sair da conta"
              className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="h-[18px] w-[18px] shrink-0" />
              Sair
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

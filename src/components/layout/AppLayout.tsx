import { NavLink, Outlet, Navigate } from "react-router-dom";
import {
  Kanban, Users, MessageSquare, CalendarDays, Settings, LogOut, Loader2, Bot, Library,
  Building2, Megaphone, Moon, Sun, Eye,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { Logo, LogoMark } from "@/components/layout/Logo";
import { cn } from "@/lib/utils";

const NAV_GROUPS = [
  {
    label: "Vendas",
    items: [
      { to: "/", label: "Pipeline", icon: Kanban },
      { to: "/contatos", label: "Contatos", icon: Users },
      { to: "/agenda", label: "Agenda", icon: CalendarDays },
    ],
  },
  {
    label: "Atendimento",
    items: [
      { to: "/chat", label: "Chat", icon: MessageSquare },
      { to: "/disparos", label: "Disparos", icon: Megaphone },
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
    "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
    isActive
      ? "bg-accent font-semibold text-accent-foreground"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  );

export default function AppLayout() {
  const { user, company, ownCompany, isSuperAdmin, isImpersonating, loading, leaveCompany, signOut } =
    useAuth();
  const { resolved, toggleTheme } = useTheme();

  const groups = isSuperAdmin ? [...NAV_GROUPS, SUPER_ADMIN_GROUP] : NAV_GROUPS;

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
      <aside className="sticky top-0 flex h-screen w-60 flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-16 items-center border-b border-sidebar-border px-4">
          <Logo />
        </div>

        <nav className="scrollbar-slim flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={navLinkClass}
                  >
                    {({ isActive }) => (
                      <>
                        {/* Marcador na borda esquerda: mostra a página ativa sem pintar o item inteiro */}
                        <span
                          className={cn(
                            "absolute -left-3 h-5 w-1 rounded-r-full bg-primary transition-opacity",
                            isActive ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <item.icon
                          className={cn(
                            "h-[18px] w-[18px] shrink-0 transition-colors",
                            isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                          )}
                        />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
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
              className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
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
        {/* Deixa explícito que tudo em tela é da conta do cliente, não da sua. */}
        {isImpersonating && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning/10 px-6 py-2.5 text-sm lg:px-8">
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
        <div className="mx-auto max-w-[1600px] animate-fade-in-up p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

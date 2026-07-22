import { NavLink, Outlet, Navigate } from "react-router-dom";
import { Kanban, Users, MessageSquare, CalendarCheck, Settings, LogOut, Loader2, Bot, Building2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/layout/Logo";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "Pipeline", icon: Kanban },
  { to: "/contatos", label: "Contatos", icon: Users },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/tarefas", label: "Tarefas", icon: CalendarCheck },
  { to: "/sdr", label: "SDR IA", icon: Bot },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

const SUPER_ADMIN_ITEMS = [
  { to: "/empresas", label: "Empresas", icon: Building2 },
];

export default function AppLayout() {
  const { user, isSuperAdmin, loading, signOut } = useAuth();
  const navItems = isSuperAdmin ? [...NAV_ITEMS, ...SUPER_ADMIN_ITEMS] : NAV_ITEMS;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r bg-card">
        <div className="border-b p-4">
          <Logo />
          <p className="mt-2 truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary font-medium text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => void signOut()}
          className="flex items-center gap-2 border-t p-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}

/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export interface CompanyInfo {
  id: string;
  name: string;
  role: string;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  /** Empresa em uso agora — pode ser a de um cliente, se o super admin trocou. */
  company: CompanyInfo | null;
  /** Empresa do próprio usuário (primeira membership). */
  ownCompany: CompanyInfo | null;
  /** Todas as empresas em que o usuário é membro. */
  memberships: CompanyInfo[];
  isSuperAdmin: boolean;
  /** true quando a empresa ativa não é uma membership do usuário. */
  isImpersonating: boolean;
  loading: boolean;
  enterCompany: (company: CompanyInfo) => void;
  leaveCompany: () => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, businessName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

// Empresa ativa sobrevive ao reload: o super admin não perde o contexto do
// cliente ao atualizar a página.
const ACTIVE_COMPANY_KEY = "mini-crm:active-company";

function readStoredCompany(): CompanyInfo | null {
  try {
    const raw = localStorage.getItem(ACTIVE_COMPANY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CompanyInfo>;
    return parsed?.id && parsed?.name
      ? { id: parsed.id, name: parsed.name, role: parsed.role ?? "super_admin" }
      : null;
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<CompanyInfo[]>([]);
  const [activeCompany, setActiveCompany] = useState<CompanyInfo | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const ownCompany = memberships[0] ?? null;
  const company = activeCompany ?? ownCompany;
  const isImpersonating = !!company && !memberships.some((m) => m.id === company.id);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (!nextSession?.user) {
        setMemberships([]);
        setActiveCompany(null);
        setIsSuperAdmin(false);
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (!data.session?.user) setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Carrega empresas + flag de super admin depois do login.
  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);

    void Promise.all([
      supabase
        .from("company_members")
        .select("role, company_id, companies(id, name)")
        .eq("user_id", user.id),
      supabase
        .from("profiles")
        .select("is_super_admin")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]).then(([memberRes, profileRes]) => {
      if (!active) return;

      // O embed vem como objeto ou array dependendo de como o PostgREST resolve
      // o relacionamento; normaliza os dois casos.
      const rows = (memberRes.data ?? []) as unknown as Array<{
        role: string;
        company_id: string;
        companies: { id: string; name: string } | { id: string; name: string }[] | null;
      }>;
      const list = rows.flatMap((r) => {
        const item = Array.isArray(r.companies) ? r.companies[0] : r.companies;
        return item ? [{ id: item.id, name: item.name, role: r.role }] : [];
      });
      const superAdmin = Boolean(profileRes.data?.is_super_admin);

      setMemberships(list);
      setIsSuperAdmin(superAdmin);

      // Restaura a empresa ativa; se não é membership nem o usuário é super
      // admin, o acesso não vale mais e volta para a empresa dele.
      const stored = readStoredCompany();
      const own = list.some((m) => m.id === stored?.id);
      if (stored && (own || superAdmin)) {
        setActiveCompany(list.find((m) => m.id === stored.id) ?? stored);
      } else {
        if (stored) localStorage.removeItem(ACTIVE_COMPANY_KEY);
        setActiveCompany(null);
      }

      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [user]);

  const enterCompany = (next: CompanyInfo) => {
    localStorage.setItem(ACTIVE_COMPANY_KEY, JSON.stringify(next));
    setActiveCompany(next);
  };

  const leaveCompany = () => {
    localStorage.removeItem(ACTIVE_COMPANY_KEY);
    setActiveCompany(null);
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string, businessName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { business_name: businessName } },
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    localStorage.removeItem(ACTIVE_COMPANY_KEY);
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        company,
        ownCompany,
        memberships,
        isSuperAdmin,
        isImpersonating,
        loading,
        enterCompany,
        leaveCompany,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}

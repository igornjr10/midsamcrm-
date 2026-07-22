/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface CompanyInfo {
  id: string;
  name: string;
  role: string;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  company: CompanyInfo | null;
  isSuperAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, businessName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (!nextSession?.user) {
        setCompany(null);
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

  // Carrega empresa + flag de super admin depois do login.
  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);

    void Promise.all([
      supabase
        .from("company_members")
        .select("role, company_id, companies(id, name)")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("is_super_admin")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]).then(([memberRes, profileRes]) => {
      if (!active) return;
      const member = memberRes.data as
        | { role: string; company_id: string; companies: { id: string; name: string } | null }
        | null;
      setCompany(
        member?.companies
          ? { id: member.companies.id, name: member.companies.name, role: member.role }
          : null,
      );
      setIsSuperAdmin(Boolean(profileRes.data?.is_super_admin));
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [user]);

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
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, company, isSuperAdmin, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}

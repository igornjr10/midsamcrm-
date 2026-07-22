import { createClient } from "@supabase/supabase-js";

// Preencha no .env.local depois de criar o projeto Supabase:
//   VITE_SUPABASE_URL=https://<ref>.supabase.co
//   VITE_SUPABASE_ANON_KEY=<anon key>
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || "";
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Placeholders evitam crash na inicialização enquanto o .env.local não foi
// preenchido; o App mostra um aviso de configuração pendente nesse caso.
export const supabase = createClient(
  SUPABASE_URL || "https://placeholder.supabase.co",
  SUPABASE_ANON_KEY || "placeholder-anon-key",
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);

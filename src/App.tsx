import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isSupabaseConfigured } from "@/integrations/supabase/client";
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "@/components/ui/sonner";
import AppLayout from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import Pipeline from "@/pages/Pipeline";
import Contacts from "@/pages/Contacts";
import Chat from "@/pages/Chat";
import Tasks from "@/pages/Tasks";
import Settings from "@/pages/Settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-lg border bg-card p-6 text-sm">
          <h1 className="mb-2 text-lg font-bold">Configuração pendente</h1>
          <p className="text-muted-foreground">
            Preencha <code className="rounded bg-muted px-1">VITE_SUPABASE_URL</code> e{" "}
            <code className="rounded bg-muted px-1">VITE_SUPABASE_ANON_KEY</code> no arquivo{" "}
            <code className="rounded bg-muted px-1">.env.local</code> com as credenciais do seu projeto
            Supabase e reinicie o servidor de desenvolvimento.
          </p>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Pipeline />} />
              <Route path="/contatos" element={<Contacts />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/tarefas" element={<Tasks />} />
              <Route path="/configuracoes" element={<Settings />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}

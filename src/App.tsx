import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isSupabaseConfigured } from "@/integrations/supabase/client";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { Toaster } from "@/components/ui/sonner";
import AppLayout from "@/components/layout/AppLayout";
import ErrorBoundary from "@/components/layout/ErrorBoundary";
import Login from "@/pages/Login";
import Pipeline from "@/pages/Pipeline";
import Contacts from "@/pages/Contacts";
import Chat from "@/pages/Chat";
import Agenda from "@/pages/Agenda";
import Biblioteca from "@/pages/Biblioteca";
import Campaigns from "@/pages/Campaigns";
import Settings from "@/pages/Settings";
import SdrIa from "@/pages/SdrIa";
import Companies from "@/pages/Companies";
import Pedidos from "@/pages/Pedidos";
import Chamados from "@/pages/Chamados";
import Dashboard from "@/pages/Dashboard";
import Vendas from "@/pages/Vendas";
import Bonus from "@/pages/Bonus";
import Segmentos from "@/pages/Segmentos";
import Vendedor from "@/pages/Vendedor";
import Captacao from "@/pages/Captacao";

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
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            {/* Erro numa tela vira mensagem, não tela preta. */}
            <ErrorBoundary>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route element={<AppLayout />}>
                  <Route path="/" element={<Pipeline />} />
                  <Route path="/contatos" element={<Contacts />} />
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/agenda" element={<Agenda />} />
                  {/* Link antigo de Tarefas continua funcionando (favoritos, histórico). */}
                  <Route path="/tarefas" element={<Navigate to="/agenda" replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/vendas" element={<Vendas />} />
                  <Route path="/vendedor" element={<Vendedor />} />
                  <Route path="/segmentos" element={<Segmentos />} />
                  <Route path="/bonus" element={<Bonus />} />
                  <Route path="/captacao" element={<Captacao />} />
                  <Route path="/pedidos" element={<Pedidos />} />
                  <Route path="/chamados" element={<Chamados />} />
                  <Route path="/disparos" element={<Campaigns />} />
                  <Route path="/biblioteca" element={<Biblioteca />} />
                  <Route path="/sdr" element={<SdrIa />} />
                  <Route path="/empresas" element={<Companies />} />
                  <Route path="/configuracoes" element={<Settings />} />
                </Route>
              </Routes>
            </ErrorBoundary>
          </BrowserRouter>
          <Toaster position="top-right" />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

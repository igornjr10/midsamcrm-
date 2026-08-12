import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { GoogleCalendarStatus, GoogleCalendarSyncResult } from "@/lib/types";

// Tudo passa pela edge function: a conexão guarda o refresh token da conta
// Google da empresa, e essa tabela não é legível do browser de propósito.
async function callGoogleCalendar<T>(
  action: "status" | "auth-url" | "disconnect" | "sync",
  companyId: string | undefined,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(`google-calendar?action=${action}`, {
    body: { company_id: companyId, ...extra },
  });
  if (error || data?.error) throw new Error(data?.error || error?.message);
  return data as T;
}

export function googleCalendarQueryKey(companyId: string | undefined) {
  return ["google-calendar", "status", companyId] as const;
}

export function useGoogleCalendarQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: googleCalendarQueryKey(companyId),
    queryFn: () => callGoogleCalendar<GoogleCalendarStatus>("status", companyId),
    enabled: !!companyId,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Manda o navegador para o consentimento do Google.
 *
 * Redirecionamento em vez de popup: o fluxo passa por telas do Google que
 * bloqueiam iframe, e popup morre em bloqueador. A volta cai em
 * /configuracoes?google=..., tratada na tela de Configurações.
 */
export function useGoogleCalendarConnectMutation() {
  return useMutation({
    mutationFn: async (companyId: string) => {
      const { url } = await callGoogleCalendar<{ url: string }>("auth-url", companyId, {
        redirect_to: `${window.location.origin}/configuracoes`,
      });
      window.location.assign(url);
    },
  });
}

export function useGoogleCalendarDisconnectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (companyId: string) => callGoogleCalendar<{ ok: boolean }>("disconnect", companyId),
    onSuccess: (_, companyId) => {
      void queryClient.invalidateQueries({ queryKey: googleCalendarQueryKey(companyId) });
      void queryClient.invalidateQueries({ queryKey: ["appointments", companyId] });
    },
  });
}

export function useGoogleCalendarSyncMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (companyId: string) => callGoogleCalendar<GoogleCalendarSyncResult>("sync", companyId),
    onSuccess: (_, companyId) => {
      void queryClient.invalidateQueries({ queryKey: googleCalendarQueryKey(companyId) });
      void queryClient.invalidateQueries({ queryKey: ["appointments", companyId] });
    },
  });
}

/**
 * Sincroniza ao abrir a Agenda, se a empresa tiver o Google conectado.
 *
 * É uma escrita disfarçada de query, e isso é o ponto: o react-query serve de
 * trava de frequência. Trocar de mês remonta a tela várias vezes por minuto, e
 * sem o staleTime cada uma dessas viraria uma volta completa na API do Google.
 */
export function useGoogleCalendarAutoSync(companyId: string | undefined) {
  const queryClient = useQueryClient();
  const { data: status } = useGoogleCalendarQuery(companyId);
  const connected = !!status?.connected && status.active !== false;

  return useQuery({
    queryKey: ["google-calendar", "sync", companyId] as const,
    queryFn: async () => {
      const result = await callGoogleCalendar<GoogleCalendarSyncResult>("sync", companyId);
      // Só recarrega a agenda quando o Google trouxe novidade; um sync que só
      // empurrou coisas daqui não mudou nada na tela.
      if ((result.applied ?? 0) > 0) {
        void queryClient.invalidateQueries({ queryKey: ["appointments", companyId] });
      }
      return result;
    },
    enabled: !!companyId && connected,
    staleTime: 120_000,
    gcTime: 120_000,
    retry: false,
  });
}

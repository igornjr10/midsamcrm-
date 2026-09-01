import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Contact, Conversation } from "@/lib/types";
import { contactsQueryKey } from "./useContactsQuery";
import { lastMessagesQueryKey } from "./useConversationsQuery";

/**
 * O aviso de mensagem nova.
 *
 * Antes disto o CRM só se mexia com a conversa daquele contato aberta: a
 * assinatura realtime vivia dentro de useConversationsQuery. Quem estivesse no
 * Pipeline, na Agenda, ou com o Chat aberto em outro contato não recebia nada —
 * nem lista atualizada, nem sinal nenhum. Na prática o lead esperava até alguém
 * lembrar de olhar.
 *
 * Aqui a assinatura é da empresa inteira e mora no AppLayout, então vale em
 * qualquer tela.
 */

const SOUND_KEY = "mini-crm:alert-sound";

export function isAlertSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAlertSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
  } catch {
    /* navegador sem storage: o padrão (ligado) continua valendo nesta sessão */
  }
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  return await Notification.requestPermission();
}

/**
 * Dois bipes curtos, sintetizados na hora.
 *
 * Sem arquivo de áudio de propósito: um mp3 no bundle é mais peso e mais uma
 * requisição para tocar 200ms de som. O contexto é criado no primeiro toque
 * porque o navegador não deixa criar antes de o usuário interagir com a página.
 */
let audioContext: AudioContext | null = null;

function playAlertSound(): void {
  if (!isAlertSoundEnabled()) return;
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") void audioContext.resume();

    const start = audioContext.currentTime;
    for (const [index, freq] of [880, 1174].entries()) {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // Envelope curto: sem ele o corte seco estala no alto-falante.
      const at = start + index * 0.12;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.18, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(at);
      osc.stop(at + 0.12);
    }
  } catch {
    /* aba sem permissão de áudio: o título e a notificação seguem valendo */
  }
}

// Título da aba: o contador vive fora do React porque o evento chega pelo
// canal do realtime, não por render.
let pendingCount = 0;
let baseTitle = "";

function bumpTitle(): void {
  if (typeof document === "undefined") return;
  baseTitle ||= document.title;
  pendingCount += 1;
  document.title = `(${pendingCount}) ${baseTitle}`;
}

function clearTitle(): void {
  if (typeof document === "undefined" || !baseTitle) return;
  pendingCount = 0;
  document.title = baseTitle;
}

/** O contato aberto agora, lido da URL: o callback do realtime nunca desatualiza. */
function openContactId(): string | null {
  if (typeof window === "undefined") return null;
  const { pathname, search } = window.location;
  if (!pathname.startsWith("/chat")) return null;
  return new URLSearchParams(search).get("contato");
}

export function useAtendimentoAlerts(companyId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!companyId) return;

    // Voltou para a aba: o contador de título já cumpriu o papel dele.
    const onVisible = () => {
      if (document.visibilityState === "visible") clearTitle();
    };
    document.addEventListener("visibilitychange", onVisible);

    const channel = supabase
      .channel(`atendimento-${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversations",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const message = payload.new as Conversation;

          // Vale para qualquer mensagem, inclusive as que saem daqui: é o que
          // mantém a prévia e a ordem da lista certas em toda tela aberta.
          void queryClient.invalidateQueries({ queryKey: lastMessagesQueryKey(companyId) });
          void queryClient.invalidateQueries({ queryKey: contactsQueryKey(companyId) });

          // Só o lead interrompe alguém. Mensagem da equipe ou da IA não.
          if (message.sender !== "contact") return;

          // Conversa aberta e aba na frente: a pessoa está lendo, não precisa
          // ser avisada do que acabou de aparecer na tela dela.
          const lendoAgora =
            document.visibilityState === "visible" && openContactId() === message.contact_id;
          if (lendoAgora) return;

          playAlertSound();
          bumpTitle();

          if (notificationPermission() !== "granted") return;

          const contacts = queryClient.getQueryData<Contact[]>(contactsQueryKey(companyId));
          const nome = contacts?.find((c) => c.id === message.contact_id)?.name ?? "Novo contato";
          try {
            const notification = new Notification(nome, {
              body: message.content?.slice(0, 120) || "Mandou uma mensagem",
              tag: message.contact_id,
              icon: "/favicon.ico",
            });
            notification.onclick = () => {
              window.focus();
              window.location.assign(`/chat?contato=${message.contact_id}`);
            };
          } catch {
            /* notificação bloqueada no sistema: som e título já avisaram */
          }
        },
      )
      .subscribe();

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);
}

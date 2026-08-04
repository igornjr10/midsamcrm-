import type { ContactFilter, FollowupStepDraft } from "@/lib/types";

/**
 * Fluxos prontos: um recorte de contatos + uma cadência de mensagens.
 *
 * Servem aos dois caminhos do CRM sem duplicar a régua:
 * - no SDR IA, os passos entram no editor da cadência (o usuário revisa e salva);
 * - em Disparos, o recorte vira o filtro da lista e o texto do primeiro passo
 *   vira a sugestão de mensagem.
 *
 * Ficam no código porque são ponto de partida, não configuração: depois de
 * aplicados, o que vale é o que a empresa salvou.
 */
export type FlowPreset = {
  id: string;
  name: string;
  description: string;
  /** Recorte da base que este fluxo ataca. */
  audience: ContactFilter;
  /** Só etapas em aberto (ignora ganho/perdido). */
  openOnly: boolean;
  steps: FollowupStepDraft[];
};

const step = (delay_hours: number, message: string): FollowupStepDraft => ({
  delay_hours,
  kind: "text",
  message,
  template_name: null,
  template_language: "pt_BR",
  template_body: null,
  variable_map: {},
  active: true,
});

export const FLOW_PRESETS: FlowPreset[] = [
  {
    id: "recuperacao",
    name: "Recuperação de vendas",
    description:
      "Para quem pediu orçamento e sumiu. Três toques em cinco dias, do lembrete leve à última chamada.",
    audience: "no_reply",
    openOnly: true,
    steps: [
      step(
        24,
        "Oi {{primeiro_nome}}! Passando para saber se ficou alguma dúvida sobre o orçamento que enviei. Posso ajustar alguma coisa?",
      ),
      step(
        48,
        "{{primeiro_nome}}, consegui segurar as condições que combinamos. Quer que eu reserve para você?",
      ),
      step(
        72,
        "{{primeiro_nome}}, vou encerrar seu atendimento por aqui para não ficar te incomodando. Se quiser retomar, é só me chamar que reabro na hora.",
      ),
    ],
  },
  {
    id: "followup_3_dias",
    name: "Follow-up após 3 dias sem resposta",
    description:
      "Um toque só, para quem falou com a gente e ficou sem retorno há três dias. O mais simples e o de maior retorno.",
    audience: "no_reply",
    openOnly: true,
    steps: [
      step(
        72,
        "Oi {{primeiro_nome}}, tudo bem? Vi que nossa conversa ficou parada. Ainda tem interesse? Consigo te responder agora.",
      ),
    ],
  },
  {
    id: "reativacao",
    name: "Reativação de leads antigos",
    description:
      "Para quem não fala com a gente há mais de 30 dias. Volta com novidade, não com cobrança.",
    audience: "cold",
    openOnly: false,
    steps: [
      step(
        720,
        "Oi {{primeiro_nome}}! Faz um tempo que a gente não se fala. Atualizamos nosso cardápio e as condições — quer que eu te mande?",
      ),
      step(
        168,
        "{{primeiro_nome}}, se fizer sentido para você, consigo montar uma proposta nova com os valores atuais. Quer ver?",
      ),
    ],
  },
];

export function findFlowPreset(id: string): FlowPreset | undefined {
  return FLOW_PRESETS.find((f) => f.id === id);
}

import type { SdrPromptFields } from "@/lib/types";

/**
 * Monta o prompt do SDR a partir do formulário da aba Comunicação.
 *
 * Só comunicação entra aqui. Tempo de resposta, quem atender e horário são
 * aplicados pelo webhook antes de a IA ser chamada — escrever isso no prompt não
 * teria efeito, e o webhook ainda avisa o modelo de que essas regras são dele.
 */
export function buildSdrPrompt(f: SdrPromptFields): string {
  const sdr = f.sdr_name?.trim() || "o assistente de atendimento";
  const empresa = f.company_name?.trim() || "a empresa";
  const blocks: string[] = [];

  blocks.push(
    `# Identidade\nVocê é ${sdr}, responsável pelo primeiro atendimento comercial de ${empresa} no WhatsApp. ` +
      "Responda sempre em português do Brasil, em mensagens curtas, uma ideia por mensagem, como uma pessoa " +
      "conversando — sem textos longos nem listas enormes.",
  );

  if (f.goal?.trim()) blocks.push(`# Objetivo do atendimento\n${f.goal.trim()}`);
  if (f.offer?.trim()) {
    blocks.push(
      `# Produtos, serviços e informações comerciais\n${f.offer.trim()}\n\n` +
        "Use só estas informações. Se o lead perguntar algo que não está aqui (preço, prazo, condição), " +
        "não invente: diga que vai confirmar com a equipe.",
    );
  }
  if (f.tone?.trim()) blocks.push(`# Tom de comunicação\n${f.tone.trim()}`);
  if (f.qualification?.trim()) {
    blocks.push(
      `# Perguntas de qualificação\nDescubra estas informações ao longo da conversa, uma pergunta por vez, ` +
        `sem parecer um formulário:\n${asList(f.qualification)}`,
    );
  }
  if (f.boundaries?.trim()) blocks.push(`# Assuntos permitidos e limites\n${f.boundaries.trim()}`);

  blocks.push(
    "# Quando passar para uma pessoa\n" +
      (f.handoff_when?.trim()
        ? `${f.handoff_when.trim()}\n\n`
        : "") +
      "Também passe sempre que o lead pedir para falar com alguém, reclamar ou perguntar algo que você não pode " +
      "responder com segurança. Nesses casos use a ferramenta de chamar a equipe, com um resumo do que já " +
      "foi coletado, e avise o lead que alguém da equipe continua a conversa.",
  );

  return blocks.join("\n\n");
}

/** Uma pergunta por linha vira lista; texto corrido fica como está. */
function asList(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return text.trim();
  return lines.map((l) => (/^[-*•\d]/.test(l) ? l : `- ${l}`)).join("\n");
}

/** O formulário tem algo preenchido além do nome? */
export function hasPromptContent(f: SdrPromptFields): boolean {
  return [f.goal, f.offer, f.tone, f.qualification, f.boundaries, f.handoff_when].some((v) => v?.trim());
}

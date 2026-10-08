// Markdown da IA -> formatação do WhatsApp.
//
// O modelo escreve Markdown (**negrito**, ## título, [texto](url)), e o
// WhatsApp não entende: o lead recebia os asteriscos crus. O WhatsApp tem a
// própria sintaxe — *negrito*, _itálico_, ~riscado~ — e é nela que o texto sai.

export function toWhatsappFormat(text: string): string {
  return text
    // Bloco de código: o WhatsApp usa as mesmas crases triplas; só tira a
    // linguagem que o Markdown põe logo depois delas.
    .replace(/```[a-zA-Z0-9_-]+\n/g, "```\n")
    // **negrito** e __negrito__ -> *negrito*
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "*$1*")
    // ~~riscado~~ -> ~riscado~
    .replace(/~~(.+?)~~/g, "~$1~")
    // # Título -> *Título* (linha inteira em negrito)
    .replace(/^#{1,6}\s+(.+?)\s*#*\s*$/gm, "*$1*")
    // [texto](url) -> texto: url (link com texto não existe no WhatsApp)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, url: string) =>
      label.trim() === url ? url : `${label}: ${url}`)
    // Marcador de lista com * vira •: senão o asterisco solto no começo da
    // linha pode casar com outro e deixar meia linha em negrito.
    .replace(/^(\s*)[*-]\s+/gm, "$1• ");
}

/**
 * Linha que é só um marcador de "mandei o anexo", sem mais nada.
 *
 * Casa "ENVIEI O ARQUIVO.", "[ARQUIVO ENVIADO]", "Segue o material:". Não casa
 * frase com conteúdo em volta — "enviei o arquivo errado, desculpe" fica, e
 * tem que ficar: ali a IA está se corrigindo, não prometendo anexo.
 */
const ANEXO = String.raw`(?:arquivo|anexo|material|documento|cardapio|cardápio)s?`;
const ARTIGO = String.raw`(?:o|a|os|as)?\s*`;
const LINHA_SO_MARCADOR = new RegExp(
  String.raw`^[\s[(*_~-]*(?:` +
    // "enviei o arquivo", "segue o material"
    String.raw`(?:enviei|enviado|enviada|enviando|segue|seguem)\s+${ARTIGO}${ANEXO}` +
    "|" +
    // ordem inversa: "[ARQUIVO ENVIADO]"
    String.raw`${ARTIGO}${ANEXO}\s+(?:enviado|enviada|enviados|enviadas)` +
  String.raw`)[\s.!,:;)\]*_~-]*$`,
  "i",
);

/**
 * Tira do texto da IA a afirmação de que um anexo foi enviado.
 *
 * O arquivo só sai quando o modelo chama enviar_arquivo. Escrever "ENVIEI O
 * ARQUIVO" no meio da resposta não envia nada — mas o lead lê aquilo como
 * promessa cumprida e fica esperando. Aconteceu em produção: o cliente
 * respondeu "o arquivo não chegou".
 *
 * Isto não é trabalho de instrução de prompt. O modelo desobedece, e o prompt
 * da própria empresa pode mandar justamente escrever o marcador — aí a regra
 * da plataforma briga com a do cliente e às vezes perde. Aqui é determinístico.
 *
 * Só vale para texto solto. A legenda que acompanha um envio de verdade não
 * passa por aqui: lá a afirmação é verdadeira.
 */
export function stripFalseFileClaims(text: string): string {
  return text
    .split("\n")
    .filter((line) => !LINHA_SO_MARCADOR.test(line))
    .join("\n")
    // Tirar a linha do meio deixa um buraco de duas quebras seguidas.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

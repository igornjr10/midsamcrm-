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

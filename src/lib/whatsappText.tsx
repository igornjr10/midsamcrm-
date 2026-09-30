import type { ReactNode } from "react";

/**
 * Formatação do WhatsApp dentro do balão do Chat: *negrito*, _itálico_,
 * ~riscado~ e ```monoespaçado```. Aceita também **negrito** do Markdown, que as
 * mensagens antigas da IA ainda trazem.
 *
 * Monta nós React em vez de HTML: o conteúdo vem do lead, e nada dele pode
 * virar marcação de verdade.
 *
 * Igual ao WhatsApp, o marcador só vale colado no texto (`*oi*` sim, `* oi *`
 * não) e fora de palavra — `arquivo_final_v2` continua sem itálico.
 */
const TOKEN =
  /(```[\s\S]+?```|\*\*(?=\S)[^*\n]+?(?<=\S)\*\*|(?<![\w*])\*(?=\S)[^*\n]+?(?<=\S)\*(?![\w*])|(?<!\w)_(?=\S)[^_\n]+?(?<=\S)_(?!\w)|(?<![\w~])~(?=\S)[^~\n]+?(?<=\S)~(?![\w~]))/g;

export function renderWhatsappText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));

    if (token.startsWith("```")) {
      out.push(
        <code key={key++} className="rounded bg-black/10 px-1 font-mono text-[0.92em] dark:bg-white/10">
          {token.slice(3, -3).replace(/^\n/, "")}
        </code>,
      );
    } else if (token.startsWith("**")) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      out.push(<strong key={key++}>{token.slice(1, -1)}</strong>);
    } else if (token.startsWith("_")) {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      out.push(<s key={key++}>{token.slice(1, -1)}</s>);
    }
    last = at + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Texto sem os marcadores, para prévias de uma linha. */
export function stripWhatsappFormat(text: string): string {
  return text
    .replace(/```([\s\S]+?)```/g, "$1")
    .replace(/\*\*(\S[^*\n]*?\S|\S)\*\*/g, "$1")
    .replace(/(?<![\w*])\*(\S[^*\n]*?\S|\S)\*(?![\w*])/g, "$1")
    .replace(/(?<!\w)_(\S[^_\n]*?\S|\S)_(?!\w)/g, "$1")
    .replace(/(?<![\w~])~(\S[^~\n]*?\S|\S)~(?![\w~])/g, "$1");
}

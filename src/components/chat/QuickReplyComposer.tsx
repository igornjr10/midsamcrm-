/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useRef, useState } from "react";
import { Zap } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useQuickRepliesQuery } from "@/hooks/queries";
import type { Contact, QuickReply } from "@/lib/types";
import { contactLabel } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  contact: Contact;
};

/** {{nome}} e {{primeiro_nome}} como nas réguas e nos disparos. */
export function renderQuickReply(content: string, contact: Contact): string {
  const name = contactLabel(contact);
  // Telefone no lugar do nome não vira "Oi (99) 98457-3986!".
  const safeName = /\d{4}/.test(name) ? "" : name;
  const first = safeName.split(/\s+/)[0] ?? "";
  return content
    .replace(/\{\{\s*nome\s*\}\}/gi, safeName)
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, first)
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * O campo de mensagem do chat com "/" abrindo as respostas rápidas.
 *
 * Digitar "/" no começo filtra pelo atalho ou pelo título; setas escolhem,
 * Enter insere (com o nome do contato já preenchido) e o segundo Enter envia.
 */
export default function QuickReplyComposer({ value, onChange, onSend, disabled, contact }: Props) {
  const { company } = useAuth();
  const { data: replies = [] } = useQuickRepliesQuery(company?.id);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = value.startsWith("/") ? value.slice(1).trim().toLowerCase() : null;
  const matches = useMemo(() => {
    if (query === null) return [] as QuickReply[];
    return replies
      .filter((r) => !query || r.shortcut.includes(query) || r.title.toLowerCase().includes(query))
      .slice(0, 8);
  }, [replies, query]);

  const open = query !== null && matches.length > 0;

  useEffect(() => setCursor(0), [query]);

  const pick = (reply: QuickReply) => {
    onChange(renderQuickReply(reply.content, contact));
    inputRef.current?.focus();
  };

  return (
    <div className="relative min-w-0 flex-1">
      {open && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md overflow-hidden rounded-xl border border-border/70 bg-popover text-popover-foreground shadow-popover"
        >
          <p className="flex items-center gap-1.5 border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Zap className="h-3 w-3" />
            Respostas rápidas
          </p>
          {matches.map((reply, index) => (
            <button
              key={reply.id}
              type="button"
              role="option"
              aria-selected={index === cursor}
              onMouseEnter={() => setCursor(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(reply)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors",
                index === cursor ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-primary">/{reply.shortcut}</span>
                <span className="font-medium">{reply.title}</span>
              </span>
              <span className="line-clamp-1 text-xs text-muted-foreground">{reply.content}</span>
            </button>
          ))}
        </div>
      )}
      <Input
        ref={inputRef}
        placeholder={replies.length > 0 ? "Digite uma mensagem ou / para respostas rápidas" : "Digite uma mensagem..."}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => (c + 1) % matches.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => (c - 1 + matches.length) % matches.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(matches[cursor]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onChange("");
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) onSend();
        }}
        disabled={disabled}
      />
    </div>
  );
}

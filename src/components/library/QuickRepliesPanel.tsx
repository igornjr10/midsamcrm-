import { useEffect, useState } from "react";
import { Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useQuickRepliesQuery,
  useSaveQuickReplyMutation,
  useDeleteQuickReplyMutation,
  shortcutFromText,
} from "@/hooks/queries";
import type { QuickReply } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Draft = { id: string | null; shortcut: string; title: string; content: string };

const VAZIO: Draft = { id: null, shortcut: "", title: "", content: "" };

/**
 * As respostas prontas da empresa. Vivem na Biblioteca porque é o mesmo
 * lugar do que a equipe e a IA enviam — só que texto em vez de arquivo.
 */
export default function QuickRepliesPanel({
  createSignal,
}: {
  /** Muda quando o botão do cabeçalho é clicado: abre o formulário vazio. */
  createSignal: number;
}) {
  const { company } = useAuth();
  const { data: replies = [] } = useQuickRepliesQuery(company?.id);
  const save = useSaveQuickReplyMutation();
  const remove = useDeleteQuickReplyMutation();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [shortcutTouched, setShortcutTouched] = useState(false);

  useEffect(() => {
    if (createSignal > 0) {
      setDraft({ ...VAZIO });
      setShortcutTouched(false);
    }
  }, [createSignal]);

  const edit = (r: QuickReply) => {
    setDraft({ id: r.id, shortcut: r.shortcut, title: r.title, content: r.content });
    setShortcutTouched(true);
  };

  const handleSave = async () => {
    if (!company || !draft) return;
    const shortcut = shortcutFromText(draft.shortcut || draft.title);
    if (!draft.title.trim() || !draft.content.trim() || !shortcut) {
      toast.error("Título, atalho e texto são obrigatórios.");
      return;
    }
    const last = replies.length > 0 ? replies[replies.length - 1].position : 0;
    try {
      await save.mutateAsync({
        id: draft.id,
        company_id: company.id,
        shortcut,
        title: draft.title.trim(),
        content: draft.content.trim(),
        position: draft.id ? replies.find((r) => r.id === draft.id)?.position ?? last : last + 1,
      });
      toast.success("Resposta salva.");
      setDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar resposta");
    }
  };

  const handleRemove = async (r: QuickReply) => {
    if (!company || !window.confirm(`Excluir "/${r.shortcut}"?`)) return;
    try {
      await remove.mutateAsync({ id: r.id, company_id: company.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    }
  };

  return (
    <>
      {replies.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="Nenhuma resposta rápida"
          description="Horário, endereço, formas de pagamento: o que a equipe digita todo dia. No chat, / abre a lista. A IA lê tudo isto como a informação oficial da empresa."
          action={
            <Button onClick={() => setDraft({ ...VAZIO })}>
              <Plus />
              Nova resposta
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {replies.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => edit(r)}
              className="group flex flex-col gap-1.5 rounded-xl border border-border/60 bg-card p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card-hover"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-primary">/{r.shortcut}</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Excluir resposta"
                  className="-mr-2 -mt-2 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRemove(r);
                  }}
                >
                  <Trash2 />
                </Button>
              </span>
              <span className="text-sm font-semibold">{r.title}</span>
              <span className="line-clamp-3 text-sm text-muted-foreground">{r.content}</span>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(v) => !v && setDraft(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Editar resposta" : "Nova resposta rápida"}</DialogTitle>
            <DialogDescription>
              No chat, digite / e o atalho. Use {"{{primeiro_nome}}"} ou {"{{nome}}"} no texto.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Título</Label>
                  <Input
                    placeholder="Horário de atendimento"
                    value={draft.title}
                    onChange={(e) =>
                      setDraft((d) =>
                        d && {
                          ...d,
                          title: e.target.value,
                          shortcut: shortcutTouched ? d.shortcut : shortcutFromText(e.target.value),
                        })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Atalho</Label>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-sm text-muted-foreground">/</span>
                    <Input
                      placeholder="horario"
                      className="font-mono"
                      value={draft.shortcut}
                      onChange={(e) => {
                        setShortcutTouched(true);
                        setDraft((d) => d && { ...d, shortcut: e.target.value });
                      }}
                      onBlur={() => setDraft((d) => d && { ...d, shortcut: shortcutFromText(d.shortcut) })}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Texto</Label>
                <Textarea
                  rows={4}
                  placeholder="Oi {{primeiro_nome}}! Nosso horário é..."
                  value={draft.content}
                  onChange={(e) => setDraft((d) => d && { ...d, content: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void handleSave()} disabled={save.isPending}>
              {save.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

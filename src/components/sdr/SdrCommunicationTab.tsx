import { useRef, useState } from "react";
import { Loader2, MessageSquareText, RotateCcw, Send, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { buildSdrPrompt, hasPromptContent } from "@/lib/sdrPrompt";
import { renderWhatsappText } from "@/lib/whatsappText";
import type { SdrPromptFields } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PasswordInput } from "@/components/ui/password-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SdrDraft, UpdateDraft } from "./sdrDraft";

const MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o mini (rápido e barato)" },
  { value: "gpt-4o", label: "GPT-4o (mais inteligente)" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini" },
];

const FIELDS: Array<{ key: keyof SdrPromptFields; label: string; placeholder: string; rows?: number }> = [
  { key: "goal", label: "Objetivo do atendimento", placeholder: "Entender o que o lead procura, apresentar os pacotes e agendar o ensaio.", rows: 2 },
  { key: "offer", label: "Produtos, serviços e informações comerciais", placeholder: "Ensaio gestante: pacote Essencial R$ 450 (20 fotos), Completo R$ 750 (40 fotos + vídeo). Estúdio em Imperatriz-MA. Pagamento: Pix ou cartão em até 3x.", rows: 5 },
  { key: "tone", label: "Tom de comunicação", placeholder: "Acolhedor, leve e próximo, com emojis moderados. Trate pelo primeiro nome.", rows: 2 },
  { key: "qualification", label: "Perguntas de qualificação (uma por linha)", placeholder: "Nome\nQuantas semanas de gestação\nData desejada para o ensaio\nSe prefere estúdio ou externo", rows: 4 },
  { key: "boundaries", label: "Assuntos permitidos e limites", placeholder: "Fale só sobre os ensaios e o estúdio. Não dê desconto. Não confirme data sem a equipe.", rows: 3 },
  { key: "handoff_when", label: "Quando passar para uma pessoa", placeholder: "Quando o lead quiser fechar, pedir desconto ou um pacote personalizado.", rows: 2 },
];

export default function SdrCommunicationTab({
  draft, update, hasSavedKey,
}: { draft: SdrDraft; update: UpdateDraft; hasSavedKey: boolean }) {
  const setField = (key: keyof SdrPromptFields, value: string) =>
    update({ promptFields: { ...draft.promptFields, [key]: value } });

  const generate = () => {
    if (!hasPromptContent(draft.promptFields)) {
      toast.error("Preencha pelo menos o objetivo ou os produtos antes de gerar.");
      return;
    }
    update({ prompt: buildSdrPrompt(draft.promptFields) });
    toast.success("Prompt gerado. Confira e ajuste o texto final abaixo antes de salvar.");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            Montar o prompt
          </CardTitle>
          <CardDescription>
            Preencha e clique em Gerar: a ferramenta organiza o prompt. Tempo de resposta, horário e quem atender
            ficam nas outras abas — não precisam estar aqui.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sdr-name">Nome do SDR</Label>
              <Input id="sdr-name" placeholder="Felipe" value={draft.promptFields.sdr_name ?? ""} onChange={(e) => setField("sdr_name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sdr-company">Empresa</Label>
              <Input id="sdr-company" placeholder="Studio Lopes" value={draft.promptFields.company_name ?? ""} onChange={(e) => setField("company_name", e.target.value)} />
            </div>
          </div>
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`sdr-${f.key}`}>{f.label}</Label>
              <Textarea
                id={`sdr-${f.key}`}
                rows={f.rows ?? 3}
                placeholder={f.placeholder}
                value={draft.promptFields[f.key] ?? ""}
                onChange={(e) => setField(f.key, e.target.value)}
              />
            </div>
          ))}
          <Button variant="outline" onClick={generate}>
            <Wand2 />
            Gerar prompt a partir dos campos
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prompt final</CardTitle>
          <CardDescription>
            É este texto que a IA segue. Pode editar à vontade — gerar de novo substitui o que estiver aqui.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea rows={12} value={draft.prompt} onChange={(e) => update({ prompt: e.target.value })} className="font-mono text-[13px]" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Modelo</Label>
              <Select value={draft.model} onValueChange={(v) => update({ model: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Chave da OpenAI</Label>
              <PasswordInput
                placeholder={hasSavedKey ? "•••••••• (chave salva; deixe em branco para manter)" : "sk-..."}
                value={draft.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Simulator prompt={draft.prompt} model={draft.model} />
    </div>
  );
}

type Turn = { role: "lead" | "sdr"; content: string };

/** Conversa de teste com o prompt da tela — nada é enviado nem gravado. */
function Simulator({ prompt, model }: { prompt: string; model: string }) {
  const { company } = useAuth();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    const next = [...turns, { role: "lead" as const, content: message }];
    setTurns(next);
    setText("");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("sdr-simulate", {
        body: { company_id: company?.id, prompt, model, messages: next },
      });
      if (data?.error) throw new Error(String(data.error));
      if (error) {
        const res = (error as { context?: unknown }).context;
        const parsed = res instanceof Response ? ((await res.clone().json().catch(() => null)) as { error?: string } | null) : null;
        throw new Error(parsed?.error ?? error.message);
      }
      setTurns([...next, { role: "sdr", content: String(data?.reply ?? "") }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na simulação");
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 50);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-primary" />
            Testar a conversa
          </CardTitle>
          <CardDescription className="mt-1.5">
            Escreva como se fosse o lead. Usa o prompt desta tela, mesmo antes de salvar. Nada é enviado: onde a IA
            mandaria um arquivo ou chamaria a equipe, ela mostra entre colchetes.
          </CardDescription>
        </div>
        {turns.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setTurns([])}>
            <RotateCcw />
            Recomeçar
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="scrollbar-slim max-h-96 min-h-32 space-y-1.5 overflow-y-auto rounded-lg bg-muted/30 p-3">
          {turns.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Mande a primeira mensagem do lead, ex.: "Oi, vi o anúncio dos ensaios"</p>
          )}
          {turns.map((t, i) => (
            <div key={i} className={cn("flex", t.role === "lead" ? "justify-start" : "justify-end")}>
              <div
                className={cn(
                  "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm shadow-card",
                  t.role === "lead" ? "rounded-bl-sm border border-border/70 bg-card" : "rounded-br-sm bg-primary text-primary-foreground",
                )}
              >
                {t.role === "sdr" && <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider opacity-70">SDR</p>}
                {renderWhatsappText(t.content)}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-end">
              <span className="flex items-center gap-1.5 rounded-2xl bg-primary/10 px-3 py-2 text-xs text-primary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                escrevendo...
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input placeholder="Mensagem do lead..." value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
          <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Enviar">
            <Send />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

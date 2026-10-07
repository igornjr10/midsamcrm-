import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SdrDraft, UpdateDraft } from "./sdrDraft";

// Os tetos batem com os checks da 0062: a espera roda dentro da edge function.
const DELAYS = [0, 5, 10, 15, 20, 30, 45, 60, 90];
const DEBOUNCES = [0, 5, 10, 15, 20, 30, 45, 60];
const HOURS = Array.from({ length: 25 }, (_, i) => i);

const secs = (n: number) => (n === 0 ? "Na hora" : n < 60 ? `${n} segundos` : n === 60 ? "1 minuto" : `${n / 60} min`.replace(".", ","));

function SecondsSelect({
  id, value, options, onChange,
}: { id: string; value: number; options: number[]; onChange: (v: number) => void }) {
  const list = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {list.map((n) => (
          <SelectItem key={n} value={String(n)}>{secs(n)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function SdrTimingTab({
  draft, update, timezone,
}: { draft: SdrDraft; update: UpdateDraft; timezone: string }) {
  const firstTotal = draft.debounce + draft.firstDelay;
  const nextTotal = draft.debounce + draft.nextDelay;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Tempo de resposta</CardTitle>
          <CardDescription>
            Controlado pela plataforma, não pelo prompt. Uma resposta um pouco mais lenta parece mais humana, e
            esperar o lead terminar de digitar evita responder pela metade.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sdr-first">Espera para a primeira resposta</Label>
              <SecondsSelect id="sdr-first" value={draft.firstDelay} options={DELAYS} onChange={(v) => update({ firstDelay: v })} />
              <p className="text-xs text-muted-foreground">Quando o SDR ainda não falou com aquele lead.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sdr-next">Espera entre as próximas respostas</Label>
              <SecondsSelect id="sdr-next" value={draft.nextDelay} options={DELAYS} onChange={(v) => update({ nextDelay: v })} />
              <p className="text-xs text-muted-foreground">Nas mensagens seguintes da mesma conversa.</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sdr-debounce">Aguardar novas mensagens do lead</Label>
            <div className="sm:w-1/2">
              <SecondsSelect id="sdr-debounce" value={draft.debounce} options={DEBOUNCES} onChange={(v) => update({ debounce: v })} />
            </div>
            <p className="text-xs text-muted-foreground">
              Se o lead mandar várias mensagens seguidas ("oi" · "tudo bem?" · "quero saber o preço"), o SDR espera
              esse tempo depois da última e responde tudo de uma vez, em vez de uma resposta para cada.
            </p>
          </div>

          <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            Na prática: a primeira resposta sai cerca de <strong>{secs(firstTotal)}</strong>
            {firstTotal ? " depois da última mensagem do lead" : ""}; as seguintes, cerca de{" "}
            <strong>{secs(nextTotal)}</strong>. Mais o tempo de a IA escrever (alguns segundos). Se alguém da equipe
            responder durante a espera, o SDR não responde.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Horário de atendimento</CardTitle>
          <CardDescription>
            Fora dele a IA fica calada e a mensagem do lead espera, não lida, para a equipe ver depois.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={draft.windowEnabled} onCheckedChange={(v) => update({ windowEnabled: v === true })} />
            Responder só em horário de atendimento
          </label>

          {draft.windowEnabled && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Atender a partir das</Label>
                  <Select value={String(draft.windowStart)} onValueChange={(v) => update({ windowStart: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HOURS.slice(0, 24).map((h) => (
                        <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Até</Label>
                  <Select value={String(draft.windowEnd)} onValueChange={(v) => update({ windowEnd: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HOURS.slice(1).map((h) => (
                        <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={draft.skipWeekends} onCheckedChange={(v) => update({ skipWeekends: v === true })} />
                Não atender aos sábados e domingos
              </label>
              <div className="space-y-1.5">
                <Label>Aviso fora do horário (opcional)</Label>
                <Textarea
                  rows={2}
                  placeholder="Oi! Nosso atendimento é das 8h às 20h. Sua mensagem já está aqui e respondemos logo cedo."
                  value={draft.offhoursMessage}
                  onChange={(e) => update({ offhoursMessage: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Mandado no máximo uma vez a cada 12h por contato. Em branco, a IA simplesmente não responde.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Fuso: {timezone.replace("America/", "").replace("_", " ")} (configurado na aba Follow-up).
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

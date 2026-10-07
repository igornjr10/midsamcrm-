import { Hand, PauseCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCompanyTeamQuery } from "@/hooks/queries";
import { teamLabel } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OptionCard } from "./SdrActivationTab";
import type { SdrDraft, UpdateDraft } from "./sdrDraft";

const LIMITS = [0, 1, 2, 3, 4, 5, 6, 8, 10];
const NONE = "__none__";

export default function SdrHandoffTab({ draft, update }: { draft: SdrDraft; update: UpdateDraft }) {
  const { company } = useAuth();
  const { data: team = [] } = useCompanyTeamQuery(company?.id);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hand className="h-4 w-4 text-primary" />
            Passar para uma pessoa
          </CardTitle>
          <CardDescription>
            Quando o lead pede alguém, reclama ou chega no momento definido na aba Comunicação, o SDR para de
            responder, avisa o lead e deixa a conversa marcada como "Pediu atendente" no Chat — com um resumo do que
            já coletou (nome, interesse, respostas da qualificação, objeções).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Responsável que recebe a conversa</Label>
            <Select value={draft.handoffUserId ?? NONE} onValueChange={(v) => update({ handoffUserId: v === NONE ? null : v })}>
              <SelectTrigger className="sm:w-80"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Ninguém fixo (fica na fila para quem pegar)</SelectItem>
                {team.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>{teamLabel(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Vira o responsável da conversa no Chat — se ela ainda não tiver um. Para cadastrar vendedores, use a tela
              Equipe.
            </p>
          </div>

          <OptionCard
            checked={draft.pauseOnHuman}
            onChange={(v) => update({ pauseOnHuman: v })}
            title="Pausar o SDR quando alguém da equipe entrar na conversa"
          >
            Assim que alguém do time responder — pelo Chat ou pelo celular — o SDR para naquela conversa e só volta
            quando alguém clicar em "Reativar IA".
          </OptionCard>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Não insistir com quem não responde</CardTitle>
          <CardDescription>
            Limite de mensagens seguidas sem resposta do lead — contando as do SDR, do follow-up e da equipe. Atingido o
            limite, o follow-up para até o lead voltar a falar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={String(draft.maxUnanswered)} onValueChange={(v) => update({ maxUnanswered: Number(v) })}>
            <SelectTrigger className="sm:w-80"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LIMITS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n === 0 ? "Sem limite (só a cadência do follow-up)" : `No máximo ${n} ${n === 1 ? "mensagem" : "mensagens"} sem resposta`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PauseCircle className="h-4 w-4 text-primary" />
            Pausar ou reativar por contato
          </CardTitle>
          <CardDescription>
            No Chat, cada conversa tem o botão <strong>Pausar IA</strong> / <strong>Reativar IA</strong> no topo. Use para
            assumir um lead específico ou devolvê-lo ao SDR. Para tirar grupos inteiros (clientes, equipe), use as
            etiquetas excluídas na aba Ativação.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

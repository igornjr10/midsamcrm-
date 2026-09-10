import { useEffect, useState } from "react";
import { Loader2, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  useCompanyUsageQuery,
  useCompanyPlanQuery,
  useSaveCompanyPlanMutation,
  useClearCompanyPlanMutation,
  useFeaturesQuery,
  useNichesQuery,
  useCompanyOverridesQuery,
  useSetCompanyNicheMutation,
  useSetCompanyFeatureMutation,
  useClearCompanyFeatureMutation,
} from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * O que esta empresa enxerga do produto.
 *
 * Duas camadas na mesma tela: o nicho define o pacote, e cada linha marcada à
 * mão vira exceção daquele cliente. A distinção aparece no rótulo porque ela
 * sobrevive à troca de pacote — mudar o nicho não desfaz o que foi vendido
 * separado.
 */
export default function ModulesDialog({
  company,
  open,
  onOpenChange,
}: {
  company: { id: string; name: string; niche_key?: string | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const companyId = company?.id;
  const { data: features = [], isPending } = useFeaturesQuery(open ? companyId : undefined);
  const { data: niches = [] } = useNichesQuery(open);
  const { data: overrides } = useCompanyOverridesQuery(companyId, open);

  const { data: usage } = useCompanyUsageQuery(companyId, open);
  const { data: plan } = useCompanyPlanQuery(companyId, open);
  const savePlan = useSaveCompanyPlanMutation();
  const clearPlan = useClearCompanyPlanMutation();

  const [coins, setCoins] = useState("2000");
  const [overage, setOverage] = useState(false);

  // O formulário espelha o plano gravado; sem plano, fica no padrão sugerido.
  useEffect(() => {
    setCoins(String(plan?.monthly_coins ?? 2000));
    setOverage(plan?.allow_overage ?? false);
  }, [plan]);

  const handleSavePlan = async () => {
    if (!companyId) return;
    const valor = Number(coins);
    if (!Number.isFinite(valor) || valor < 0) {
      toast.error("Informe um número de coins válido.");
      return;
    }
    try {
      await savePlan.mutateAsync({ companyId, monthlyCoins: valor, allowOverage: overage });
      toast.success("Cota atualizada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar a cota");
    }
  };

  const handleClearPlan = async () => {
    if (!companyId) return;
    try {
      await clearPlan.mutateAsync(companyId);
      toast.success("Empresa sem teto de envios — o consumo continua medido.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover a cota");
    }
  };

  const setNiche = useSetCompanyNicheMutation();
  const setFeature = useSetCompanyFeatureMutation();
  const clearFeature = useClearCompanyFeatureMutation();

  const handleNiche = async (value: string) => {
    if (!companyId) return;
    try {
      const result = await setNiche.mutateAsync({ companyId, nicheKey: value === "none" ? null : value });
      if (value === "none") {
        toast.success("Nicho removido — tudo liberado.");
        return;
      }
      // Diz o que o modelo trouxe: "Nicho atualizado" sozinho esconde que o
      // funil e os campos da empresa acabaram de mudar.
      const partes: string[] = [];
      if (result?.stages) partes.push(`${result.stages} ${result.stages === 1 ? "etapa" : "etapas"}`);
      if (result?.fields) partes.push(`${result.fields} ${result.fields === 1 ? "campo" : "campos"}`);
      if (result?.kinds) partes.push(`${result.kinds} ${result.kinds === 1 ? "tipo de compromisso" : "tipos de compromisso"}`);
      if (result?.rules) partes.push(`${result.rules} ${result.rules === 1 ? "régua sugerida" : "réguas sugeridas"}`);
      if (result?.tags) partes.push(`${result.tags} ${result.tags === 1 ? "etiqueta" : "etiquetas"}`);
      if (result?.replies) partes.push(`${result.replies} ${result.replies === 1 ? "resposta rápida" : "respostas rápidas"}`);
      toast.success(
        partes.length > 0
          ? `Nicho atualizado · ${partes.join(", ")} do modelo adicionados.`
          : "Nicho atualizado · a empresa já tinha tudo do modelo.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao mudar o nicho");
    }
  };

  const handleToggle = async (featureKey: string, enabled: boolean) => {
    if (!companyId) return;
    try {
      await setFeature.mutateAsync({ companyId, featureKey, enabled });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao mudar o módulo");
    }
  };

  const handleReset = async (featureKey: string) => {
    if (!companyId) return;
    try {
      await clearFeature.mutateAsync({ companyId, featureKey });
      toast.success("Módulo voltou ao padrão do nicho.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao restaurar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Plano · {company?.name}</DialogTitle>
          <DialogDescription>
            O nicho define o pacote de módulos; marcar ou desmarcar aqui cria uma exceção só para
            esta empresa, que continua valendo mesmo se o pacote mudar depois. A cota de envios fica
            no fim.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nicho</Label>
            <Select
              value={company?.niche_key ?? "none"}
              onValueChange={(v) => void handleNiche(v)}
              disabled={setNiche.isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem nicho — tudo liberado</SelectItem>
                {niches.map((n) => (
                  <SelectItem key={n.key} value={n.key}>
                    {n.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isPending ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-1">
              <Label>Módulos</Label>
              {/* Os core viram uma linha só: três cards dizendo "não dá para
                  mexer" empurravam para baixo justamente o que se decide. */}
              <p className="flex items-center gap-1.5 pb-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3 shrink-0" />
                {features.filter((f) => f.core).map((f) => f.label).join(", ")} sempre ativos
              </p>

              {features.filter((f) => !f.core).map((f) => {
                const override = overrides?.get(f.feature_key);
                const isException = override !== undefined;
                return (
                  <label
                    key={f.feature_key}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors hover:bg-accent/40"
                  >
                    <Checkbox
                      checked={f.enabled}
                      disabled={setFeature.isPending}
                      onCheckedChange={(v) => void handleToggle(f.feature_key, v === true)}
                    />
                    <span className="min-w-0 flex-1 text-sm font-medium">{f.label}</span>
                    {isException && (
                      <>
                        <Badge variant="secondary" className="shrink-0">
                          {override ? "liberado à parte" : "removido"}
                        </Badge>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Voltar ao padrão do nicho"
                          onClick={(e) => {
                            e.preventDefault();
                            void handleReset(f.feature_key);
                          }}
                          disabled={clearFeature.isPending}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          {/* ── Cota de envios ─────────────────────────────────────────── */}
          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Cota mensal de envios</p>
              <p className="text-xs text-muted-foreground">
                {usage?.monthly_coins == null
                  ? "Sem cota definida: ilimitado, e o consumo continua sendo medido."
                  : `${Number(usage.used).toLocaleString("pt-BR")} de ${usage.monthly_coins.toLocaleString("pt-BR")} coins usados neste mês.`}
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="cota">Coins por mês</Label>
                <Input
                  id="cota"
                  type="number"
                  min={0}
                  className="w-32"
                  value={coins}
                  onChange={(e) => setCoins(e.target.value)}
                />
              </div>
              <Button onClick={() => void handleSavePlan()} disabled={savePlan.isPending}>
                {savePlan.isPending ? "Salvando..." : "Salvar cota"}
              </Button>
              {usage?.monthly_coins != null && (
                <Button
                  variant="outline"
                  onClick={() => void handleClearPlan()}
                  disabled={clearPlan.isPending}
                >
                  Tornar ilimitado
                </Button>
              )}
            </div>

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={overage}
                onCheckedChange={(v) => setOverage(v === true)}
              />
              <span>
                Deixar passar do limite
                <span className="block text-xs text-muted-foreground">
                  Marcado, o excedente vira cobrança no fim do mês. Desmarcado, o envio é recusado —
                  inclusive a resposta da IA, que passa a esperar um humano.
                </span>
              </span>
            </label>
          </div>

          <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            Esconder um módulo tira ele do menu; quem recusa de verdade o acesso são as regras do
            banco e as edge functions.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

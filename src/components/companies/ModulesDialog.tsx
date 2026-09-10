import { Loader2, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  useFeaturesQuery,
  useNichesQuery,
  useCompanyOverridesQuery,
  useSetCompanyNicheMutation,
  useSetCompanyFeatureMutation,
  useClearCompanyFeatureMutation,
} from "@/hooks/queries";
import { Button } from "@/components/ui/button";
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

  const setNiche = useSetCompanyNicheMutation();
  const setFeature = useSetCompanyFeatureMutation();
  const clearFeature = useClearCompanyFeatureMutation();

  const handleNiche = async (value: string) => {
    if (!companyId) return;
    try {
      await setNiche.mutateAsync({ companyId, nicheKey: value === "none" ? null : value });
      toast.success(value === "none" ? "Nicho removido — tudo liberado." : "Nicho atualizado.");
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Módulos · {company?.name}</DialogTitle>
          <DialogDescription>
            O nicho define o pacote. Marcar ou desmarcar aqui cria uma exceção só para esta empresa,
            que continua valendo mesmo se o pacote do nicho mudar depois.
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
              {features.map((f) => {
                const override = overrides?.get(f.feature_key);
                const isException = override !== undefined;
                return (
                  <div
                    key={f.feature_key}
                    className="flex items-start gap-3 rounded-lg border p-3"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={f.enabled}
                      disabled={f.core || setFeature.isPending}
                      onCheckedChange={(v) => void handleToggle(f.feature_key, v === true)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {f.label}
                        {f.core && (
                          <Badge variant="outline" className="gap-1">
                            <Lock className="h-3 w-3" />
                            Sempre ativo
                          </Badge>
                        )}
                        {isException && !f.core && (
                          <Badge variant="secondary">
                            Exceção: {override ? "liberado" : "removido"}
                          </Badge>
                        )}
                      </p>
                      {f.route && (
                        <p className="text-xs text-muted-foreground">{f.route}</p>
                      )}
                    </div>
                    {isException && !f.core && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Voltar ao padrão do nicho"
                        onClick={() => void handleReset(f.feature_key)}
                        disabled={clearFeature.isPending}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            Pipeline, Contatos e Chat não podem ser desligados — são o produto. Esconder um módulo
            tira ele do menu; quem recusa de verdade o acesso são as regras do banco e as functions.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

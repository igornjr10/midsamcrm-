import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CompanyFeature, Niche } from "@/lib/types";

/**
 * Os módulos que esta empresa enxerga.
 *
 * A conta (core > exceção do cliente > pacote do nicho > tudo ligado) mora numa
 * function do banco, não aqui: as edge functions precisam da mesma resposta
 * para recusar o que o cliente não comprou, e duas implementações da mesma
 * regra divergem no primeiro caso de borda.
 */
export function featuresQueryKey(companyId: string | undefined) {
  return ["features", companyId] as const;
}

export function useFeaturesQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: featuresQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase.rpc("company_feature_set", {
        p_company_id: companyId,
      });
      if (error) throw error;
      return (data ?? []) as CompanyFeature[];
    },
    enabled: !!companyId,
    // Módulo é decisão comercial: muda quando alguém vende, não a cada minuto.
    staleTime: 5 * 60_000,
  });
}

/** Conjunto de chaves ligadas, para checagem direta: `has("disparos")`. */
export function useFeatures(companyId: string | undefined) {
  const { data: features = [], isPending } = useFeaturesQuery(companyId);

  return useMemo(() => {
    const enabled = new Set(features.filter((f) => f.enabled).map((f) => f.feature_key));
    return {
      features,
      // Enquanto carrega, nada é escondido: piscar o menu inteiro a cada
      // navegação é pior do que mostrar um item por meio segundo a mais.
      has: (key: string) => (isPending ? true : enabled.has(key)),
      routeEnabled: (route: string) => {
        if (isPending) return true;
        const match = features.find((f) => f.route === route);
        return !match || match.enabled;
      },
      isPending,
    };
  }, [features, isPending]);
}

// ── Catálogos (tela do super admin) ─────────────────────────────────────────

export function nichesQueryKey() {
  return ["niches"] as const;
}

export function useNichesQuery(enabled = true) {
  return useQuery({
    queryKey: nichesQueryKey(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("niches")
        .select("key, name, description, position")
        .order("position");
      if (error) throw error;
      return (data ?? []) as Niche[];
    },
    enabled,
    staleTime: 10 * 60_000,
  });
}

/**
 * As exceções gravadas para a empresa.
 *
 * O company_feature_set devolve o valor final, não a origem dele. A tela do
 * super admin precisa da origem: "desligado porque o nicho não inclui" e
 * "desligado porque eu tirei deste cliente" são decisões diferentes, e só a
 * segunda sobrevive a uma mudança no pacote.
 */
export function companyOverridesQueryKey(companyId: string | undefined) {
  return ["company-features", companyId] as const;
}

export function useCompanyOverridesQuery(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: companyOverridesQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return new Map<string, boolean>();
      const { data, error } = await supabase
        .from("company_features")
        .select("feature_key, enabled")
        .eq("company_id", companyId);
      if (error) throw error;
      const map = new Map<string, boolean>();
      for (const row of (data ?? []) as Array<{ feature_key: string; enabled: boolean }>) {
        map.set(row.feature_key, row.enabled);
      }
      return map;
    },
    enabled: enabled && !!companyId,
    staleTime: 60_000,
  });
}

export function useSetCompanyNicheMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ companyId, nicheKey }: { companyId: string; nicheKey: string | null }) => {
      const { error } = await supabase
        .from("companies")
        .update({ niche_key: nicheKey })
        .eq("id", companyId);
      if (error) throw error;
    },
    onSuccess: (_, { companyId }) => {
      void queryClient.invalidateQueries({ queryKey: featuresQueryKey(companyId) });
      void queryClient.invalidateQueries({ queryKey: ["all-companies"] });
    },
  });
}

/**
 * Liga ou desliga um módulo para uma empresa específica.
 *
 * Grava sempre a exceção, mesmo quando o valor coincide com o do nicho: o que
 * o super admin marcou na tela precisa continuar valendo se o pacote do nicho
 * mudar depois.
 */
export function useSetCompanyFeatureMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { companyId: string; featureKey: string; enabled: boolean }) => {
      const { error } = await supabase.from("company_features").upsert(
        {
          company_id: payload.companyId,
          feature_key: payload.featureKey,
          enabled: payload.enabled,
        },
        { onConflict: "company_id,feature_key" },
      );
      if (error) throw error;
    },
    onSuccess: (_, { companyId }) => {
      void queryClient.invalidateQueries({ queryKey: featuresQueryKey(companyId) });
      void queryClient.invalidateQueries({ queryKey: companyOverridesQueryKey(companyId) });
    },
  });
}

/** Devolve o módulo ao pacote do nicho (apaga a exceção). */
export function useClearCompanyFeatureMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { companyId: string; featureKey: string }) => {
      const { error } = await supabase
        .from("company_features")
        .delete()
        .eq("company_id", payload.companyId)
        .eq("feature_key", payload.featureKey);
      if (error) throw error;
    },
    onSuccess: (_, { companyId }) => {
      void queryClient.invalidateQueries({ queryKey: featuresQueryKey(companyId) });
      void queryClient.invalidateQueries({ queryKey: companyOverridesQueryKey(companyId) });
    },
  });
}

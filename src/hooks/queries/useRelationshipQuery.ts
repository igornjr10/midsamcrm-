import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { RelationshipKind, RelationshipRule } from "@/lib/types";

export function relationshipRulesQueryKey(companyId: string | undefined) {
  return ["relationship-rules", companyId] as const;
}

export function useRelationshipRulesQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: relationshipRulesQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return new Map<RelationshipKind, RelationshipRule>();
      const { data, error } = await supabase
        .from("relationship_rules")
        .select("*")
        .eq("company_id", companyId);
      if (error) throw error;
      const byKind = new Map<RelationshipKind, RelationshipRule>();
      for (const rule of (data ?? []) as RelationshipRule[]) byKind.set(rule.kind, rule);
      return byKind;
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

export function useSaveRelationshipRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      company_id: string;
      kind: RelationshipKind;
      enabled: boolean;
      message: string;
      inactive_days?: number;
      ask_after_days?: number;
      cooldown_days?: number;
    }) => {
      const { error } = await supabase
        .from("relationship_rules")
        .upsert(payload, { onConflict: "company_id,kind" });
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: relationshipRulesQueryKey(company_id) });
    },
  });
}

/** Últimos envios das réguas — a prova de que a automação está viva. */
export function useRelationshipLogsQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: ["relationship-logs", companyId] as const,
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("relationship_logs")
        .select("id, kind, status, content, error, created_at, contacts(name, phone)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        id: string;
        kind: RelationshipKind;
        status: string;
        content: string | null;
        error: string | null;
        created_at: string;
        contacts: { name: string | null; phone: string | null } | null;
      }>;
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });
}

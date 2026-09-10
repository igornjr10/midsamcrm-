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
        .eq("company_id", companyId)
        .neq("kind", "data");
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
      // Sem upsert por (company_id, kind): desde as réguas por data essa
      // unicidade é um índice parcial, que o upsert do PostgREST não enxerga.
      const { data: existing, error: findError } = await supabase
        .from("relationship_rules")
        .select("id")
        .eq("company_id", payload.company_id)
        .eq("kind", payload.kind)
        .maybeSingle();
      if (findError) throw findError;
      const { error } = existing
        ? await supabase.from("relationship_rules").update(payload).eq("id", (existing as { id: string }).id)
        : await supabase.from("relationship_rules").insert(payload);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: relationshipRulesQueryKey(company_id) });
    },
  });
}

// ── Réguas por data ─────────────────────────────────────────────────────────

export function dateRulesQueryKey(companyId: string | undefined) {
  return ["relationship-rules", "data", companyId] as const;
}

/** As réguas 'data' da empresa, na ordem do campo e do deslocamento. */
export function useDateRulesQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: dateRulesQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("relationship_rules")
        .select("*")
        .eq("company_id", companyId)
        .eq("kind", "data")
        .order("field_key")
        .order("offset_days");
      if (error) throw error;
      return (data ?? []) as RelationshipRule[];
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

export function useSaveDateRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: {
      id: string | null;
      company_id: string;
      title: string;
      field_key: string;
      offset_days: number;
      message: string;
      cooldown_days: number;
      enabled: boolean;
    }) => {
      const row = { ...payload, kind: "data" as const };
      const { error } = id
        ? await supabase.from("relationship_rules").update(row).eq("id", id).eq("company_id", payload.company_id)
        : await supabase.from("relationship_rules").insert(row);
      if (error) {
        if (error.code === "23505") throw new Error("Já existe uma régua para esse campo com esse prazo.");
        throw error;
      }
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: dateRulesQueryKey(company_id) });
    },
  });
}

export function useDeleteRelationshipRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase
        .from("relationship_rules")
        .delete()
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: dateRulesQueryKey(company_id) });
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
        .select("id, kind, status, content, error, created_at, contacts(name, phone), relationship_rules(title)")
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
        relationship_rules: { title: string | null } | null;
      }>;
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });
}

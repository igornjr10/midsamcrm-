import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PipelineStage } from "@/lib/types";

export function pipelineStagesQueryKey(companyId: string | undefined) {
  return ["pipeline-stages", companyId] as const;
}

export function usePipelineStagesQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: pipelineStagesQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("company_id", companyId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PipelineStage[];
    },
    enabled: !!companyId,
    // O funil muda raramente e é lido em quase toda tela.
    staleTime: 5 * 60_000,
  });
}

/**
 * Chave estável para uma etapa nova. É ela que vai para contacts.stage, então
 * nunca muda depois — renomear a etapa mexe só no name.
 */
export function stageKeyFromName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `${slug || "etapa"}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useCreateStageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      company_id: string;
      key: string;
      name: string;
      tone: PipelineStage["tone"];
      kind?: PipelineStage["kind"];
      position: number;
    }) => {
      const { error } = await supabase.from("pipeline_stages").insert(payload);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: pipelineStagesQueryKey(company_id) });
    },
  });
}

export function useUpdateStageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      company_id,
      ...patch
    }: { id: string; company_id: string } & Partial<PipelineStage>) => {
      const { error } = await supabase
        .from("pipeline_stages")
        .update(patch)
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: pipelineStagesQueryKey(company_id) });
    },
  });
}

export function useDeleteStageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase
        .from("pipeline_stages")
        .delete()
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: pipelineStagesQueryKey(company_id) });
    },
  });
}

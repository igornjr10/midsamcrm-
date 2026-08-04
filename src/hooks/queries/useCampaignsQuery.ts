import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WhatsappTemplate } from "@/lib/templates";
import type { Campaign, CampaignTarget, VariableMap } from "@/lib/types";
import { fetchAllPages } from "./paginate";

export function campaignsQueryKey(companyId: string | undefined) {
  return ["campaigns", companyId] as const;
}

export function campaignTargetsQueryKey(campaignId: string | undefined) {
  return ["campaign-targets", campaignId] as const;
}

export function whatsappTemplatesQueryKey(companyId: string | undefined) {
  return ["whatsapp-templates", companyId] as const;
}

/** Templates aprovados pela Meta, lidos da WABA configurada. */
export function useWhatsappTemplatesQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: whatsappTemplatesQueryKey(companyId),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("whatsapp-send?action=list-templates", {
        body: { company_id: companyId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error as string);
      return (data?.templates ?? []) as WhatsappTemplate[];
    },
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useCampaignsQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: campaignsQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      return fetchAllPages<Campaign>((from, to) =>
        supabase
          .from("campaigns")
          .select("*")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      );
    },
    enabled: !!companyId,
    staleTime: 10_000,
    // Enquanto houver disparo em andamento, atualiza sozinho para a barra de
    // progresso andar mesmo se o usuário sair e voltar para a página.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((c) => c.status === "running") ? 5_000 : false,
  });
}

export function useCampaignTargetsQuery(campaignId: string | undefined) {
  return useQuery({
    queryKey: campaignTargetsQueryKey(campaignId),
    queryFn: async () => {
      if (!campaignId) return [];
      return fetchAllPages<CampaignTarget>((from, to) =>
        supabase
          .from("campaign_targets")
          .select("*")
          .eq("campaign_id", campaignId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );
    },
    enabled: !!campaignId,
    staleTime: 10_000,
  });
}

export interface CreateCampaignInput {
  name: string;
  template_name: string;
  template_language: string;
  template_body: string;
  variable_map: VariableMap;
  contact_ids: string[];
  /** Empresa ativa: o super admin pode estar operando a conta de um cliente. */
  company_id?: string;
}

export function useCreateCampaignMutation() {
  return useMutation({
    mutationFn: async (input: CreateCampaignInput) => {
      const { data, error } = await supabase.functions.invoke("whatsapp-campaign?action=create", {
        body: input,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error as string);
      return data as { campaign: Campaign; skipped: number };
    },
  });
}

export interface DispatchResult {
  sent: number;
  failed: number;
  remaining: number;
  done: boolean;
}

/** Processa um lote de pendentes; a página chama em loop até done. */
export function useDispatchCampaignMutation() {
  return useMutation({
    mutationFn: async ({ campaignId, companyId }: { campaignId: string; companyId?: string }) => {
      const { data, error } = await supabase.functions.invoke("whatsapp-campaign?action=dispatch", {
        body: { campaign_id: campaignId, company_id: companyId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error as string);
      return data as DispatchResult;
    },
  });
}

export function useCancelCampaignMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ campaignId, companyId }: { campaignId: string; companyId: string }) => {
      const { data, error } = await supabase.functions.invoke("whatsapp-campaign?action=cancel", {
        body: { campaign_id: campaignId, company_id: companyId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error as string);
    },
    onSuccess: (_, { companyId }) => {
      void queryClient.invalidateQueries({ queryKey: campaignsQueryKey(companyId) });
    },
  });
}

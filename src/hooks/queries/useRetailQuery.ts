import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Coupon, GiftbackSettings, LeadForm, Sale, SaleItem, Segment, SegmentRules, SellerTask } from "@/lib/types";
import { fetchAllPages } from "./paginate";
import { contactsQueryKey } from "./useContactsQuery";

// ── Vendas ──────────────────────────────────────────────────────────────────

export function salesQueryKey(companyId: string | undefined) {
  return ["sales", companyId] as const;
}

/** Todas as vendas: o dashboard e o RFM precisam da base inteira. */
export function useSalesQuery(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: salesQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      return fetchAllPages<Sale>((from, to) =>
        supabase
          .from("crm_sales")
          .select("*")
          .eq("company_id", companyId)
          .order("sold_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      );
    },
    enabled: enabled && !!companyId,
    staleTime: 30_000,
  });
}

function invalidateSales(queryClient: ReturnType<typeof useQueryClient>, companyId: string) {
  void queryClient.invalidateQueries({ queryKey: salesQueryKey(companyId) });
  // A venda gera cupom e tarefa por trigger.
  void queryClient.invalidateQueries({ queryKey: couponsQueryKey(companyId) });
  void queryClient.invalidateQueries({ queryKey: tasksQueryKey(companyId) });
}

export function useCreateSaleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      company_id: string;
      contact_id: string | null;
      total: number;
      discount?: number;
      shipping?: number;
      items?: SaleItem[];
      seller_id?: string | null;
      store?: string | null;
      origin?: Sale["origin"];
      coupon_id?: string | null;
      coupon_code?: string | null;
      sold_at?: string;
      notes?: string | null;
    }) => {
      const { data, error } = await supabase.from("crm_sales").insert(payload).select("*").maybeSingle();
      if (error) throw error;
      return data as Sale | null;
    },
    onSuccess: (_, { company_id }) => invalidateSales(queryClient, company_id),
  });
}

/** Importação: insere em lotes, sem gerar giftback (origin = planilha). */
export function useImportSalesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ company_id, rows }: { company_id: string; rows: Array<Record<string, unknown>> }) => {
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200).map((r) => ({ ...r, company_id, origin: "planilha" }));
        const { error } = await supabase.from("crm_sales").insert(batch);
        if (error) throw error;
        inserted += batch.length;
      }
      return inserted;
    },
    onSuccess: (_, { company_id }) => invalidateSales(queryClient, company_id),
  });
}

export function useUpdateSaleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id, ...patch }: { id: string; company_id: string } & Partial<Pick<Sale, "status" | "seller_id" | "store" | "notes">>) => {
      const { error } = await supabase.from("crm_sales").update(patch).eq("id", id).eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => invalidateSales(queryClient, company_id),
  });
}

export function useDeleteSaleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase.from("crm_sales").delete().eq("id", id).eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => invalidateSales(queryClient, company_id),
  });
}

// ── Cupons e giftback ───────────────────────────────────────────────────────

export function couponsQueryKey(companyId: string | undefined) {
  return ["coupons", companyId] as const;
}

export function useCouponsQuery(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: couponsQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      return fetchAllPages<Coupon>((from, to) =>
        supabase
          .from("crm_coupons")
          .select("*")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      );
    },
    enabled: enabled && !!companyId,
    staleTime: 30_000,
  });
}

export function useCreateCouponMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      company_id: string;
      contact_id: string | null;
      code: string;
      kind: Coupon["kind"];
      discount_type: Coupon["discount_type"];
      value: number;
      min_purchase?: number | null;
      expires_at?: string | null;
    }) => {
      const { data, error } = await supabase.from("crm_coupons").insert(payload).select("*").maybeSingle();
      if (error) {
        if (error.code === "23505") throw new Error("Já existe um cupom com esse código.");
        throw error;
      }
      return data as Coupon | null;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: couponsQueryKey(company_id) });
    },
  });
}

export function useUpdateCouponMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id, ...patch }: { id: string; company_id: string } & Partial<Pick<Coupon, "status" | "expires_at" | "sent_at" | "value" | "min_purchase">>) => {
      const { error } = await supabase.from("crm_coupons").update(patch).eq("id", id).eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: couponsQueryKey(company_id) });
    },
  });
}

export function giftbackSettingsQueryKey(companyId: string | undefined) {
  return ["giftback-settings", companyId] as const;
}

export function useGiftbackSettingsQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: giftbackSettingsQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return null;
      const { data, error } = await supabase
        .from("crm_giftback_settings")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      return (data as GiftbackSettings | null) ?? null;
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

export function useSaveGiftbackSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<GiftbackSettings> & { company_id: string }) => {
      const { error } = await supabase
        .from("crm_giftback_settings")
        .upsert(payload, { onConflict: "company_id" });
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: giftbackSettingsQueryKey(company_id) });
    },
  });
}

// ── Segmentos ───────────────────────────────────────────────────────────────

export function segmentsQueryKey(companyId: string | undefined) {
  return ["segments", companyId] as const;
}

export function useSegmentsQuery(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: segmentsQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("crm_segments")
        .select("*")
        .eq("company_id", companyId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Segment[];
    },
    enabled: enabled && !!companyId,
    staleTime: 60_000,
  });
}

export function useSaveSegmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: string | null; company_id: string; name: string; description?: string | null; rules: SegmentRules; position?: number }) => {
      const { error } = id
        ? await supabase.from("crm_segments").update(payload).eq("id", id).eq("company_id", payload.company_id)
        : await supabase.from("crm_segments").insert(payload);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: segmentsQueryKey(company_id) });
    },
  });
}

export function useDeleteSegmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase.from("crm_segments").delete().eq("id", id).eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: segmentsQueryKey(company_id) });
    },
  });
}

// ── Painel do vendedor ──────────────────────────────────────────────────────

export function tasksQueryKey(companyId: string | undefined) {
  return ["seller-tasks", companyId] as const;
}

export function useTasksQuery(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: tasksQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("crm_tasks")
        .select("*")
        .eq("company_id", companyId)
        .order("due_at", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as SellerTask[];
    },
    enabled: enabled && !!companyId,
    staleTime: 15_000,
  });
}

export function useSaveTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: string | null; company_id: string } & Partial<Pick<SellerTask, "contact_id" | "assigned_to" | "title" | "kind" | "due_at" | "status" | "notes" | "done_at">>) => {
      const { error } = id
        ? await supabase.from("crm_tasks").update(payload).eq("id", id).eq("company_id", payload.company_id)
        : await supabase.from("crm_tasks").insert(payload);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: tasksQueryKey(company_id) });
    },
  });
}

export function useDeleteTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase.from("crm_tasks").delete().eq("id", id).eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: tasksQueryKey(company_id) });
    },
  });
}

// ── Pop-up de captação ──────────────────────────────────────────────────────

export function leadFormsQueryKey(companyId: string | undefined) {
  return ["lead-forms", companyId] as const;
}

export function useLeadFormsQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: leadFormsQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("crm_lead_forms")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LeadForm[];
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

export function useSaveLeadFormMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: string | null; company_id: string } & Partial<Omit<LeadForm, "id" | "company_id" | "token" | "created_at" | "updated_at">>) => {
      const { error } = id
        ? await supabase.from("crm_lead_forms").update(payload).eq("id", id).eq("company_id", payload.company_id)
        : await supabase.from("crm_lead_forms").insert(payload);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: leadFormsQueryKey(company_id) });
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey(company_id) });
    },
  });
}

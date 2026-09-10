import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Order, OrderItem, OrderStatus } from "@/lib/types";

export function ordersQueryKey(companyId: string | undefined) {
  return ["orders", companyId] as const;
}

/** Pedidos da empresa, mais recentes primeiro. */
export function useOrdersQuery(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ordersQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Order[];
    },
    enabled: enabled && !!companyId,
    staleTime: 15_000,
  });
}

export function useCreateOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      company_id: string;
      contact_id: string | null;
      items: OrderItem[];
      total: number | null;
      delivery_address?: string | null;
      notes?: string | null;
      status?: OrderStatus;
    }) => {
      const { data, error } = await supabase.from("orders").insert(payload).select("*").maybeSingle();
      if (error) throw error;
      return data as Order | null;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: ordersQueryKey(company_id) });
    },
  });
}

export function useUpdateOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      company_id,
      ...patch
    }: { id: string; company_id: string } & Partial<
      Pick<Order, "status" | "items" | "total" | "delivery_address" | "notes" | "contact_id">
    >) => {
      const { error } = await supabase.from("orders").update(patch).eq("id", id).eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: ordersQueryKey(company_id) });
    },
  });
}

export function useDeleteOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, company_id }: { id: string; company_id: string }) => {
      const { error } = await supabase.from("orders").delete().eq("id", id).eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: ordersQueryKey(company_id) });
    },
  });
}

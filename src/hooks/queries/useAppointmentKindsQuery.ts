import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppointmentKindDef } from "@/lib/types";

/**
 * Tipos de compromisso extras da empresa (degustação, consulta, assembleia...).
 * Vêm do modelo do nicho; os cinco tipos base continuam fixos no front.
 */
export function appointmentKindsQueryKey(companyId: string | undefined) {
  return ["appointment-kinds", companyId] as const;
}

export function useAppointmentKindsQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: appointmentKindsQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("appointment_kinds")
        .select("*")
        .eq("company_id", companyId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AppointmentKindDef[];
    },
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });
}

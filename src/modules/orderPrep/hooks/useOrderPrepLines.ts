/**
 * useOrderPrepLines — Fetches active (non-validated) order prep lines
 * for the current establishment.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import type { OrderPrepLine } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useOrderPrepLines() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useQuery<OrderPrepLine[]>({
    queryKey: ["order-prep-lines", estId],
    enabled: !!estId,
    queryFn: async () => {
      const { data, error } = await db
        .from("to_order_lines")
        .select("*")
        .eq("establishment_id", estId)
        .in("status", ["pending", "checked"])
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as OrderPrepLine[];
    },
  });
}

/**
 * Hook pour récupérer la liste des fournisseurs actifs (LECTURE SEULE)
 * Source: invoice_suppliers — scopé par establishment
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";

export interface SupplierOption {
  id: string;
  name: string;
  trade_name: string | null;
  logo_url: string | null;
}

export function useSuppliersList() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["products-v2-suppliers-list", establishmentId],
    queryFn: async (): Promise<SupplierOption[]> => {
      if (!establishmentId) return [];

      const { data, error } = await supabase
        .from("invoice_suppliers")
        .select("id, name, trade_name, logo_url")
        .eq("establishment_id", establishmentId)
        .eq("status", "active")
        .is("archived_at", null)
        .order("name");

      if (error) {
        if (import.meta.env.DEV) {
          console.warn("[useSuppliersList] error:", error.code, error.message, error);
        }
        throw error;
      }
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[useSuppliersList] loaded", data?.length ?? 0, "suppliers");
      }
      return data ?? [];
    },
    enabled: !!establishmentId,
    staleTime: 30_000,
  });
}

/**
 * Hook: Fetch B2B catalogue for a partnership + enrich with mapping status
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { supabase } from "@/integrations/supabase/client";
import { getB2BCatalogue, getImportedProducts } from "../services/b2bCatalogService";
import { enrichCatalogProducts } from "../services/b2bImportPipeline";
import type { EnrichedCatalogProduct, LocalUnit, LocalCategory } from "../services/b2bTypes";

interface UseB2BCatalogResult {
  products: EnrichedCatalogProduct[];
  localUnits: LocalUnit[];
  localCategories: LocalCategory[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  supplierEstablishmentId: string | null;
}

export function useB2BCatalog(partnershipId: string | null): UseB2BCatalogResult {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  const query = useQuery({
    queryKey: ["b2b-catalogue", partnershipId, estId],
    queryFn: async (): Promise<{
      products: EnrichedCatalogProduct[];
      supplierEstId: string | null;
      localUnits: LocalUnit[];
      localCategories: LocalCategory[];
    }> => {
      if (!partnershipId || !estId) return { products: [], supplierEstId: null, localUnits: [], localCategories: [] };

      const [catalogResult, localUnitsRes, localCatsRes, importedRes] = await Promise.all([
        getB2BCatalogue(partnershipId, estId),
        supabase
          .from("measurement_units")
          .select("id, name, abbreviation, family, category, is_reference, aliases")
          .eq("establishment_id", estId)
          .eq("is_active", true),
        supabase
          .from("product_categories")
          .select("id, name, name_normalized, is_archived")
          .eq("establishment_id", estId),
        getImportedProducts(estId),
      ]);

      if (!catalogResult.ok) {
        throw new Error(catalogResult.error ?? "Erreur catalogue");
      }

      const localUnits: LocalUnit[] = (localUnitsRes.data ?? []) as LocalUnit[];
      const localCategories: LocalCategory[] = (localCatsRes.data ?? []) as LocalCategory[];

      const alreadyImported = new Set(
        importedRes
          .filter((i) => i.source_establishment_id === catalogResult.supplier_establishment_id)
          .map((i) => i.source_product_id)
      );

      const enriched = enrichCatalogProducts(
        catalogResult.products ?? [],
        catalogResult.supplier_units ?? [],
        localUnits,
        localCategories,
        alreadyImported
      );

      return {
        products: enriched,
        supplierEstId: catalogResult.supplier_establishment_id ?? null,
        localUnits,
        localCategories,
      };
    },
    enabled: !!partnershipId && !!estId,
  });

  return {
    products: query.data?.products ?? [],
    localUnits: query.data?.localUnits ?? [],
    localCategories: query.data?.localCategories ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
    supplierEstablishmentId: query.data?.supplierEstId ?? null,
  };
}

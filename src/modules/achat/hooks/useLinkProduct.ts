/**
 * MODULE ACHAT — useLinkProduct Hook
 *
 * Recherche products_v2 par code/nom et lie une ligne achat (Non lié) à un produit.
 * SSOT: seul purchase_line_items.product_id est modifié.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SearchResult {
  id: string;
  nom_produit: string;
  code_produit: string | null;
  supplier_billing_unit_id: string | null;
  supplier_name: string | null;
  category: string | null;
}

interface LinkParams {
  establishmentId: string;
  yearMonth: string;
  supplierIdFilter: string;
  productNameSnapshot: string;
  targetProductId: string;
}

export function useLinkProduct(establishmentId: string | undefined) {
  const queryClient = useQueryClient();
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  /** Recherche live dans products_v2 par code ou nom */
  const searchProducts = async (query: string, supplierId?: string) => {
    if (!establishmentId || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      let req = supabase
        .from("products_v2")
        .select("id, nom_produit, code_produit, supplier_billing_unit_id, category, supplier_id, invoice_suppliers!supplier_id(name)")
        .eq("establishment_id", establishmentId)
        .is("archived_at", null)
        .limit(20);

      if (supplierId) {
        req = req.eq("supplier_id", supplierId);
      }

      // Recherche par code OU par nom
      const trimmed = query.trim();
      req = req.or(`code_produit.ilike.%${trimmed}%,nom_produit.ilike.%${trimmed}%`);

      const { data, error } = await req;
      if (error) {
        if (import.meta.env.DEV) console.error("[useLinkProduct] search error:", error);
        setSearchResults([]);
      } else {
        setSearchResults((data ?? []).map((d) => ({
          ...d,
          supplier_name: (d.invoice_suppliers as { name: string } | null)?.name ?? null,
        })));
      }
    } finally {
      setIsSearching(false);
    }
  };

  /** Mutation: UPDATE purchase_line_items SET product_id WHERE match */
  const linkMutation = useMutation({
    mutationFn: async (params: LinkParams) => {
      const { data, error } = await supabase
        .from("purchase_line_items")
        .update({ product_id: params.targetProductId })
        .eq("establishment_id", params.establishmentId)
        .eq("year_month", params.yearMonth)
        .eq("supplier_id", params.supplierIdFilter)
        .eq("product_name_snapshot", params.productNameSnapshot)
        .is("product_id", null)
        .select("id");

      if (error) throw error;
      return data;
    },
    onSuccess: (data, params) => {
      toast.success(`${data?.length ?? 0} ligne(s) liée(s) au produit`);
      queryClient.invalidateQueries({
        queryKey: ["purchases", params.establishmentId, params.yearMonth],
      });
    },
    onError: (err: Error) => {
      toast.error(`Erreur de liaison: ${err.message}`);
    },
  });

  return {
    searchProducts,
    searchResults,
    isSearching,
    linkMutation,
    clearResults: () => setSearchResults([]),
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SMART_MATCH — useSmartMatch hook
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Encapsulates SmartMatchDrawer state + request building.
 * Consumer modules call openSmartMatch() with line info,
 * hook manages drawer open/close + request.
 */

import { useState, useCallback } from "react";
import type { SmartMatchRequest } from "../types";
import { SMART_MATCH_ENABLED } from "@/config/featureFlags";

interface OpenParams {
  establishment_id: string;
  supplier_id: string;
  raw_label: string;
  code_produit?: string | null;
  code_barres?: string | null;
  unit_of_sale?: string | null;
  packaging?: string | null;
  category_suggestion?: string | null;
}

export function useSmartMatch() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [request, setRequest] = useState<SmartMatchRequest | null>(null);

  const openSmartMatch = useCallback(
    (params: OpenParams) => {
      if (!SMART_MATCH_ENABLED) return;
      setRequest({
        establishment_id: params.establishment_id,
        supplier_id: params.supplier_id,
        raw_label: params.raw_label,
        code_produit: params.code_produit ?? null,
        code_barres: params.code_barres ?? null,
        unit_of_sale: params.unit_of_sale ?? null,
        packaging: params.packaging ?? null,
        category_suggestion: params.category_suggestion ?? null,
      });
      setDrawerOpen(true);
    },
    []
  );

  const closeSmartMatch = useCallback(() => {
    setDrawerOpen(false);
    setRequest(null);
  }, []);

  return {
    isEnabled: SMART_MATCH_ENABLED,
    drawerOpen,
    request,
    openSmartMatch,
    closeSmartMatch,
    setDrawerOpen,
  };
}

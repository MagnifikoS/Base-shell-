/**
 * Hook for supplier matching in Vision AI context
 */

import { useMemo, useCallback } from "react";
import { useSuppliers } from "./useSuppliers";
import { computeSupplierMatch, type SupplierMatchResult } from "../utils/supplierMatcher";

interface UseSupplierMatch {
  isLoading: boolean;
  findMatch: (extractedName: string) => SupplierMatchResult;
  suppliers: Array<{ id: string; name: string; name_normalized: string | null }>;
}

export function useSupplierMatch(): UseSupplierMatch {
  const { suppliers, isLoading } = useSuppliers();

  const normalizedSuppliers = useMemo(() => {
    return suppliers.map(s => ({
      id: s.id,
      name: s.name,
      name_normalized: s.name_normalized,
    }));
  }, [suppliers]);

  const findMatch = useCallback(
    (extractedName: string): SupplierMatchResult => {
      return computeSupplierMatch(extractedName, normalizedSuppliers);
    },
    [normalizedSuppliers]
  );

  return {
    isLoading,
    findMatch,
    suppliers: normalizedSuppliers,
  };
}

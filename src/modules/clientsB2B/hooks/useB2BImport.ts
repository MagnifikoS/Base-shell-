/**
 * Hook: B2B import mutation (batch import with progress)
 */

import { useState, useCallback } from "react";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { importBatch, type ImportContext } from "../services/b2bImportPipeline";
import type { EnrichedCatalogProduct, ImportProductResult, LocalUnit } from "../services/b2bTypes";

export function useB2BImport() {
  const { activeEstablishment } = useEstablishment();
  const { user } = useAuth();
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<ImportProductResult[] | null>(null);

  const runImport = useCallback(
    async (
      products: EnrichedCatalogProduct[],
      supplierId: string,
      storageZoneId: string,
      sourceEstablishmentId: string,
      localUnits: LocalUnit[]
    ) => {
      if (!activeEstablishment?.id || !user?.id) return;

      const ctx: ImportContext = {
        establishmentId: activeEstablishment.id,
        userId: user.id,
        supplierId,
        storageZoneId,
        sourceEstablishmentId,
        localUnits,
      };

      setImporting(true);
      setProgress({ done: 0, total: products.filter((p) => p.importStatus === "ELIGIBLE").length });

      try {
        const importResults = await importBatch(products, ctx, (done, total) => {
          setProgress({ done, total });
        });
        setResults(importResults);
        return importResults;
      } finally {
        setImporting(false);
      }
    },
    [activeEstablishment?.id, user?.id]
  );

  const clearResults = useCallback(() => setResults(null), []);

  return { runImport, importing, progress, results, clearResults };
}

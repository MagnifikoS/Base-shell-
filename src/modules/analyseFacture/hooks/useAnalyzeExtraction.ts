import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import type { ExtractedProductLine } from "@/modules/shared";
import { analyzeExtraction } from "../engine/analyzeExtraction";
import { useExtractionSettings } from "./useExtractionSettings";
import { ExistingProduct, InvoiceRecord, AnalysisResult, AnalysisInput } from "../types";

interface UseAnalyzeExtractionOptions {
  items: ExtractedProductLine[];
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  invoiceTotal?: number | null;
  supplierId?: string | null;
  enabled?: boolean;
}

/**
 * Hook that analyzes extracted products against existing data
 *
 * This hook:
 * 1. Fetches existing products from SSOT
 * 2. Fetches existing invoices for duplicate detection
 * 3. Runs the analysis engine
 * 4. Returns alerts and filtered items
 */
export function useAnalyzeExtraction(options: UseAnalyzeExtractionOptions) {
  const { items, invoiceNumber, invoiceDate, invoiceTotal, supplierId, enabled = true } = options;

  const { activeEstablishment } = useEstablishment();
  const { settings, isLoading: settingsLoading } = useExtractionSettings();
  const establishmentId = activeEstablishment?.id;

  // Fetch existing products from SSOT (products_v2)
  const { data: existingProducts = [], isLoading: productsLoading } = useQuery({
    queryKey: ["products-v2-ssot", establishmentId],
    queryFn: async (): Promise<ExistingProduct[]> => {
      if (!establishmentId) return [];

      const { data, error } = await supabase
        .from("products_v2")
        .select(
          "id, code_produit, nom_produit, name_normalized, final_unit_price, conditionnement_resume"
        )
        .eq("establishment_id", establishmentId)
        .is("archived_at", null);

      if (error) throw error;
      // Map V2 columns to ExistingProduct interface
      return (data ?? []).map((row) => ({
        id: row.id,
        code_produit: row.code_produit,
        nom_produit: row.nom_produit,
        name_normalized: row.name_normalized,
        prix_unitaire: row.final_unit_price,
        conditionnement: row.conditionnement_resume,
      }));
    },
    enabled: !!establishmentId && enabled && items.length > 0,
  });

  // Fetch existing invoices for duplicate detection (last 60 days window around invoice date)
  const { data: existingInvoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ["invoices-history", establishmentId, supplierId],
    queryFn: async (): Promise<InvoiceRecord[]> => {
      if (!establishmentId) return [];

      // Base query - filter by establishment
      let query = supabase
        .from("invoices")
        .select("id, invoice_number, invoice_date, supplier_id, amount_eur")
        .eq("establishment_id", establishmentId)
        .order("invoice_date", { ascending: false })
        .limit(500);

      // If we have a supplier_id, filter by it for more relevant results
      if (supplierId) {
        query = query.eq("supplier_id", supplierId);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!establishmentId && enabled,
  });

  // Run analysis
  const analysisResult = useMemo((): AnalysisResult | null => {
    if (!settings || items.length === 0) return null;

    const input: AnalysisInput = {
      items,
      invoiceNumber: invoiceNumber ?? null,
      invoiceDate: invoiceDate ?? null,
      invoiceTotal: invoiceTotal ?? null,
      supplierId: supplierId ?? null,
      itemsCount: items.length,
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // FORCE: Désactiver le filtrage "produits existants" pour Vision AI
    // Achat doit enregistrer 100% des lignes facturées (cf. achat-exhaustiveness-requirement)
    // Le filtrage UX reste disponible via le toggle "showFilteredProducts" dans VisionAI.tsx
    // ═══════════════════════════════════════════════════════════════════════════
    return analyzeExtraction({
      input,
      settings: {
        ...settings,
        filter_existing_products: false, // FORCE: Afficher tous les produits
      },
      existingProducts,
      existingInvoices,
    });
  }, [
    items,
    settings,
    existingProducts,
    existingInvoices,
    invoiceNumber,
    invoiceDate,
    invoiceTotal,
    supplierId,
  ]);

  const isLoading = settingsLoading || productsLoading || invoicesLoading;

  return {
    result: analysisResult,
    isLoading,
    isBlocked: analysisResult?.isBlocked ?? false,
    blockingAlerts: analysisResult?.blockingAlerts ?? [],
    warnings: analysisResult?.warnings ?? [],
    infoAlerts: analysisResult?.infoAlerts ?? [],
    filteredItems: analysisResult?.filteredItems ?? items,
    filteredOutCount: analysisResult?.filteredOutCount ?? 0,
    duplicateResult: analysisResult?.duplicateResult ?? null,
  };
}

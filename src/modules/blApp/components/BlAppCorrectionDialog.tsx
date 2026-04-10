/**
 * ===============================================================================
 * BlAppCorrectionDialog -- "Corriger le BL"
 *
 * Phase 3: Inline inputs replaced by UniversalQuantityModal.
 * Each line shows a read-only effective qty + Pencil button to open popup.
 *
 * STK-BL-015: Shows cumulative corrected quantities as baseline, PLUS an
 *   expandable correction chain per product showing the full history.
 *
 * STK-BL-012: Allows adding new product lines from the supplier catalog.
 *
 * Delta = newQty - effectiveQty (deterministic, no estimated stock involved).
 * Creates RECEIPT_CORRECTION stock_document with signed delta lines.
 * ===============================================================================
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Loader2,
  Plus,
  Minus,
  AlertTriangle,
  AlertCircle,
  Search,
  PackagePlus,
  ChevronRight,
  History,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useBlAppLinesWithPrices } from "../hooks/useBlAppLinesWithPrices";
import { useCreateCorrection } from "../hooks/useCreateCorrection";
import { supabase } from "@/integrations/supabase/client";
import { buildCanonicalLine } from "@/modules/stockLedger";
import { QuantityModalWithResolver } from "@/components/stock/QuantityModalWithResolver";
import { type QuantityProduct } from "@/components/stock/UniversalQuantityModal";
import { useProductCurrentStock } from "@/hooks/useProductCurrentStock";
import type { BlAppDocument } from "../types";
import { displayProductName } from "@/utils/displayName";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blDocument: BlAppDocument;
  stockDocMeta: {
    establishment_id: string;
    organization_id: string;
    storage_zone_id: string;
    supplier_id: string | null;
  };
}

interface EditableLine {
  product_id: string;
  product_name: string;
  bl_quantity: number;
  cumulative_correction: number;
  effective_quantity: number;
  new_quantity: number;
  canonical_unit_id: string;
  unit_label: string;
  is_new_line: boolean;
}

const LARGE_DELTA_THRESHOLD = 50;

// ─── Re-export types from shared hook for backward compatibility ─────────
import {
  useCumulativeCorrectionDeltas,
  type CorrectionStep,
  type ProductCorrectionHistory,
} from "../hooks/useCumulativeCorrectionDeltas";

export type { CorrectionStep, ProductCorrectionHistory };

// ─── Hook: fetch supplier products for "add new line" ────────────────────

interface SupplierProduct {
  id: string;
  nom_produit: string;
  canonical_unit_id: string | null;
  unit_label: string;
}

function useSupplierProducts(supplierId: string | null, establishmentId: string, enabled: boolean) {
  return useQuery<SupplierProduct[]>({
    queryKey: ["supplier-products-for-correction", supplierId, establishmentId],
    queryFn: async () => {
      if (!supplierId) return [];

      const { data: products, error: prodErr } = await supabase
        .from("products_v2")
        .select("id, nom_produit, supplier_billing_unit_id")
        .eq("supplier_id", supplierId)
        .eq("establishment_id", establishmentId)
        .is("archived_at", null)
        .order("nom_produit");

      if (prodErr) throw prodErr;
      if (!products || products.length === 0) return [];

      const unitIds = [
        ...new Set(products.map((p) => p.supplier_billing_unit_id).filter(Boolean)),
      ] as string[];
      let unitMap = new Map<string, string>();
      if (unitIds.length > 0) {
        const { data: units } = await supabase
          .from("measurement_units")
          .select("id, abbreviation")
          .in("id", unitIds);
        unitMap = new Map((units ?? []).map((u) => [u.id, u.abbreviation]));
      }

      return products.map((p) => ({
        id: p.id,
        nom_produit: p.nom_produit,
        canonical_unit_id: p.supplier_billing_unit_id,
        unit_label: p.supplier_billing_unit_id
          ? (unitMap.get(p.supplier_billing_unit_id) ?? "u")
          : "u",
      }));
    },
    enabled: !!supplierId && enabled,
  });
}

// ─── Hook: fetch full product configs for popup ──────────────────────────

interface ProductConfig {
  id: string;
  nom_produit: string;
  stock_handling_unit_id: string | null;
  final_unit_id: string | null;
  delivery_unit_id: string | null;
  supplier_billing_unit_id: string | null;
  conditionnement_config: Record<string, unknown> | null;
  category: string | null;
}

function useProductConfigs(productIds: string[], enabled: boolean) {
  return useQuery<ProductConfig[]>({
    queryKey: ["product-configs-correction", productIds.sort().join(",")],
    queryFn: async () => {
      if (productIds.length === 0) return [];
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, nom_produit, stock_handling_unit_id, final_unit_id, delivery_unit_id, supplier_billing_unit_id, conditionnement_config, category")
        .in("id", productIds);
      if (error) throw error;
      return (data ?? []) as ProductConfig[];
    },
    enabled: enabled && productIds.length > 0,
  });
}

// ─── Main Component ──────────────────────────────────────────────────────

export function BlAppCorrectionDialog({ open, onOpenChange, blDocument, stockDocMeta }: Props) {
  const { data: linesData, isLoading } = useBlAppLinesWithPrices(blDocument.id);

  const blOriginalQuantities = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of linesData?.lines ?? []) {
      map[l.product_id] = l.quantity;
    }
    return map;
  }, [linesData?.lines]);

  const blOriginalProductIds = useMemo(
    () => new Set(Object.keys(blOriginalQuantities)),
    [blOriginalQuantities]
  );

  const { data: correctionData, isLoading: deltasLoading } = useCumulativeCorrectionDeltas(
    blDocument.stock_document_id,
    blOriginalProductIds,
    blOriginalQuantities,
    open
  );
  const cumulativeDeltas = useMemo(() => correctionData?.deltaMap ?? {}, [correctionData]);
  const correctionHistoryMap = useMemo(() => correctionData?.historyMap ?? {}, [correctionData]);

  const { data: supplierProducts = [] } = useSupplierProducts(
    stockDocMeta.supplier_id,
    stockDocMeta.establishment_id,
    open
  );

  // Fetch product configs for popup BFS
  const productIds = useMemo(
    () => (linesData?.lines ?? []).map((l) => l.product_id),
    [linesData?.lines]
  );
  const { data: productConfigs = [] } = useProductConfigs(productIds, open);
  const productConfigMap = useMemo(
    () => new Map(productConfigs.map((p) => [p.id, p])),
    [productConfigs]
  );

  // Fetch units for BFS
  const { data: allUnits = [] } = useQuery({
    queryKey: ["all-units-bl-correction", stockDocMeta.establishment_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("measurement_units")
        .select("id, name, abbreviation, category, family, is_reference, aliases")
        .eq("establishment_id", stockDocMeta.establishment_id)
        .eq("is_active", true);
      return data ?? [];
    },
    enabled: open,
  });

  // Fetch conversions for BFS
  const { data: allConversions = [] } = useQuery({
    queryKey: ["all-conversions-bl-correction", stockDocMeta.establishment_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("unit_conversions")
        .select("id, from_unit_id, to_unit_id, factor, establishment_id, is_active")
        .eq("establishment_id", stockDocMeta.establishment_id)
        .eq("is_active", true);
      return data ?? [];
    },
    enabled: open,
  });

  const createCorrection = useCreateCorrection();
  const [editLines, setEditLines] = useState<EditableLine[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const isSubmittingRef = useRef(false);

  // Phase 3: popup state
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const blAppCorrectionStock = useProductCurrentStock(editingProductId);

  // Initialize editable lines from fetched BL lines + cumulative corrections
  useEffect(() => {
    if (linesData?.lines && open && !deltasLoading) {
      setEditLines(
        linesData.lines.map((l) => {
          const cumCorrection = cumulativeDeltas[l.product_id] ?? 0;
          const effectiveQty = Math.round((l.quantity + cumCorrection) * 10000) / 10000;
          return {
            product_id: l.product_id,
            product_name: l.product_name,
            bl_quantity: l.quantity,
            cumulative_correction: cumCorrection,
            effective_quantity: effectiveQty,
            new_quantity: effectiveQty,
            canonical_unit_id: l.canonical_unit_id,
            unit_label: l.unit_label,
            is_new_line: false,
          };
        })
      );
    }
  }, [linesData?.lines, open, deltasLoading, cumulativeDeltas]);

  // Products available for adding
  const availableProducts = useMemo(() => {
    const existingIds = new Set(editLines.map((l) => l.product_id));
    return supplierProducts.filter((p) => !existingIds.has(p.id));
  }, [supplierProducts, editLines]);

  const handleAddProduct = useCallback((product: SupplierProduct) => {
    if (!product.canonical_unit_id) {
      toast.error("Ce produit n'a pas d'unité de facturation configurée.");
      return;
    }
    setEditLines((prev) => [
      ...prev,
      {
        product_id: product.id,
        product_name: product.nom_produit,
        bl_quantity: 0,
        cumulative_correction: 0,
        effective_quantity: 0,
        new_quantity: 0,
        canonical_unit_id: product.canonical_unit_id,
        unit_label: product.unit_label,
        is_new_line: true,
      },
    ]);
    setAddProductOpen(false);
  }, []);

  // Compute deltas
  const linesWithDelta = useMemo(
    () =>
      editLines
        .map((l) => ({
          ...l,
          delta: Math.round((l.new_quantity - l.effective_quantity) * 10000) / 10000,
        }))
        .filter((l) => Math.abs(l.delta) > 0.0001),
    [editLines]
  );

  const hasChanges = linesWithDelta.length > 0;
  const hasNegativeDelta = linesWithDelta.some((l) => l.delta < 0);
  const hasLargeDelta = linesWithDelta.some((l) => Math.abs(l.delta) >= LARGE_DELTA_THRESHOLD);

  // Phase 3: popup confirm handler
  const handlePopupConfirm = async (params: {
    productId: string;
    canonicalQuantity: number;
    canonicalUnitId: string;
  }) => {
    setEditLines((prev) =>
      prev.map((l) =>
        l.product_id === params.productId
          ? { ...l, new_quantity: params.canonicalQuantity }
          : l
      )
    );
  };

  // Build QuantityProduct for popup
  const editingProduct: QuantityProduct | null = useMemo(() => {
    if (!editingProductId) return null;
    const config = productConfigMap.get(editingProductId);
    if (config) {
      return {
        id: config.id,
        nom_produit: config.nom_produit,
        stock_handling_unit_id: config.stock_handling_unit_id,
        final_unit_id: config.final_unit_id,
        delivery_unit_id: config.delivery_unit_id,
        supplier_billing_unit_id: config.supplier_billing_unit_id,
        conditionnement_config: config.conditionnement_config,
        category: config.category,
      };
    }
    // Fallback: from editLines
    const line = editLines.find((l) => l.product_id === editingProductId);
    if (!line) return null;
    return {
      id: line.product_id,
      nom_produit: line.product_name,
      stock_handling_unit_id: null,
      final_unit_id: line.canonical_unit_id,
      delivery_unit_id: null,
      supplier_billing_unit_id: line.canonical_unit_id,
      conditionnement_config: null,
      category: null,
    };
  }, [editingProductId, productConfigMap, editLines]);

  const editingLineData = editLines.find((l) => l.product_id === editingProductId);

  const doSubmit = async () => {
    setConfirmOpen(false);
    if (!hasChanges) return;
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    try {
      const pIds = [...new Set(linesWithDelta.map((l) => l.product_id))];
      const { data: products, error: prodErr } = await supabase
        .from("products_v2")
        .select("id, supplier_billing_unit_id, conditionnement_config")
        .in("id", pIds);
      if (prodErr) throw prodErr;
      const productMap = new Map((products ?? []).map((p) => [p.id, p]));

      const unitIds = [...new Set(linesWithDelta.map((l) => l.canonical_unit_id))];
      const { data: units, error: unitErr } = await supabase
        .from("measurement_units")
        .select("id, family, abbreviation, name")
        .in("id", unitIds);
      if (unitErr) throw unitErr;

      const deltaLines = linesWithDelta.map((l) => {
        const product = productMap.get(l.product_id);

        const canonical = buildCanonicalLine({
          canonicalUnitId: l.canonical_unit_id,
          product: {
            supplier_billing_unit_id: product?.supplier_billing_unit_id ?? null,
            conditionnement_config: product?.conditionnement_config,
          },
          units: units ?? [],
        });

        return {
          product_id: l.product_id,
          delta_quantity_canonical: l.delta,
          canonical_unit_id: canonical.canonical_unit_id,
          canonical_family: canonical.canonical_family,
          canonical_label: l.unit_label,
          context_hash: canonical.context_hash,
        };
      });

      const result = await createCorrection.mutateAsync({
        originalStockDocumentId: blDocument.stock_document_id,
        blAppDocumentId: blDocument.id,
        establishmentId: stockDocMeta.establishment_id,
        organizationId: stockDocMeta.organization_id,
        storageZoneId: stockDocMeta.storage_zone_id,
        supplierId: stockDocMeta.supplier_id,
        lines: deltaLines,
      });

      if (result.ok) {
        toast.success(
          `Correction appliquée (${result.events_created ?? 0} mouvement${(result.events_created ?? 0) > 1 ? "s" : ""})`
        );
        onOpenChange(false);
      } else {
        toast.error(`Erreur : ${result.error ?? "inconnue"}`);
      }
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleSubmitClick = () => {
    if (hasLargeDelta) {
      setConfirmOpen(true);
    } else {
      doSubmit();
    }
  };

  const dataLoading = isLoading || deltasLoading;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            setEditLines([]);
            setAddProductOpen(false);
            setEditingProductId(null);
          }
          onOpenChange(o);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Corriger le BL</DialogTitle>
            <DialogDescription>
              Tu peux corriger les quantités reçues. Le stock sera ajusté automatiquement. Si tu
              passes de 10 à 8, on retire 2 du stock.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-auto space-y-3 py-2">
            {dataLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : editLines.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">Aucune ligne dans ce BL</p>
            ) : (
              editLines.map((line) => {
                const delta =
                  Math.round((line.new_quantity - line.effective_quantity) * 10000) / 10000;
                const hasDelta = Math.abs(delta) > 0.0001;
                const hasPreviousCorrections = Math.abs(line.cumulative_correction) > 0.0001;
                const productHistory = correctionHistoryMap[line.product_id];
                const hasSteps = productHistory && productHistory.steps.length > 0;

                return (
                  <div
                    key={line.product_id}
                    className={`p-3 rounded-lg border transition-colors ${
                      hasDelta
                        ? delta < 0
                          ? "border-destructive/50 bg-destructive/5"
                          : "border-primary/50 bg-primary/5"
                        : "border-border bg-background"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">{displayProductName(line.product_name)}</span>
                        {line.is_new_line && (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            Nouveau
                          </Badge>
                        )}
                        {hasSteps && (
                          <Badge variant="secondary" className="text-[10px] shrink-0 gap-0.5">
                            <History className="h-2.5 w-2.5" />
                            {productHistory.steps.length}
                          </Badge>
                        )}
                      </div>
                      {hasDelta && (
                        <Badge
                          variant={delta > 0 ? "default" : "destructive"}
                          className="text-xs shrink-0"
                        >
                          {delta > 0 ? "+" : ""}
                          {delta} {line.unit_label}
                        </Badge>
                      )}
                    </div>

                    {/* STK-BL-015: Correction chain display */}
                    {hasSteps && !line.is_new_line && (
                      <Collapsible>
                        <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-2 group">
                          <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
                          <span>Historique des corrections</span>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="ml-1 mb-2 pl-2 border-l-2 border-muted space-y-0.5">
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span className="font-mono w-16 text-right tabular-nums">
                                {line.bl_quantity}
                              </span>
                              <span className="text-muted-foreground/60">{line.unit_label}</span>
                              <span className="text-muted-foreground/80">-- BL original</span>
                            </div>

                            {productHistory.steps.map((step) => {
                              const stepDate = step.posted_at
                                ? new Date(step.posted_at).toLocaleDateString("fr-FR", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "";
                              return (
                                <div
                                  key={step.correction_number}
                                  className="flex items-center gap-1.5 text-[11px]"
                                >
                                  <span className="font-mono w-16 text-right tabular-nums">
                                    {step.running_total}
                                  </span>
                                  <span className="text-muted-foreground/60">
                                    {line.unit_label}
                                  </span>
                                  <span
                                    className={`font-mono text-[10px] ${
                                      step.delta > 0
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : "text-red-600 dark:text-red-400"
                                    }`}
                                  >
                                    ({step.delta > 0 ? "+" : ""}
                                    {step.delta})
                                  </span>
                                  <span className="text-muted-foreground/80">
                                    -- Correction #{step.correction_number}
                                    {stepDate ? ` (${stepDate})` : ""}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Phase 3: Read-only qty + pencil button to open popup */}
                    <div className="flex items-center gap-3">
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {line.is_new_line ? (
                          <span>Qté actuelle : 0</span>
                        ) : hasPreviousCorrections ? (
                          <span>
                            Qté effective : {line.effective_quantity} {line.unit_label}
                          </span>
                        ) : (
                          <span>
                            Qté BL : {line.bl_quantity} {line.unit_label}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-auto">
                        <span className="font-mono text-sm font-semibold">
                          {line.new_quantity} {line.unit_label}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Modifier la quantité"
                          onClick={() => setEditingProductId(line.product_id)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {/* STK-BL-012: Add new product line */}
            {!dataLoading && stockDocMeta.supplier_id && (
              <Popover open={addProductOpen} onOpenChange={setAddProductOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full gap-2 border-dashed" size="sm">
                    <PackagePlus className="h-4 w-4" />
                    Ajouter un produit
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Rechercher un produit..." />
                    <CommandList>
                      <CommandEmpty>Aucun produit trouvé</CommandEmpty>
                      <CommandGroup>
                        {availableProducts.map((product) => (
                          <CommandItem
                            key={product.id}
                            value={product.nom_produit}
                            onSelect={() => handleAddProduct(product)}
                          >
                            <Search className="h-3 w-3 mr-2 shrink-0" />
                            <span className="truncate uppercase">{product.nom_produit}</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {product.unit_label}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Negative delta warning */}
          {hasNegativeDelta && (
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 rounded">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Certaines quantités sont réduites -- du stock sera retiré. Si le stock est
                insuffisant, la correction sera refusée.
              </span>
            </div>
          )}

          <DialogFooter>
            <div className="flex items-center justify-between w-full">
              <span className="text-sm text-muted-foreground">
                {linesWithDelta.length} ligne{linesWithDelta.length !== 1 ? "s" : ""} modifiée
                {linesWithDelta.length !== 1 ? "s" : ""}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Annuler
                </Button>
                <Button
                  onClick={handleSubmitClick}
                  disabled={!hasChanges || createCorrection.isPending}
                >
                  {createCorrection.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Valider la correction
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 3: Universal popup for editing correction quantities */}
      <QuantityModalWithResolver
        open={!!editingProductId}
        onClose={() => setEditingProductId(null)}
        product={editingProduct}
        dbUnits={allUnits}
        dbConversions={allConversions}
        existingQuantity={editingLineData?.new_quantity}
        contextLabel="Correction BL"
        contextType="reception"
        currentStockCanonical={blAppCorrectionStock.currentStockCanonical}
        currentStockUnitLabel={blAppCorrectionStock.currentStockUnitLabel}
        currentStockLoading={blAppCorrectionStock.isLoading}
        onConfirm={handlePopupConfirm}
      />

      {/* Large delta confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500 dark:text-amber-400" />
              Ajustement important
            </AlertDialogTitle>
            <AlertDialogDescription>
              {linesWithDelta
                .filter((l) => Math.abs(l.delta) >= LARGE_DELTA_THRESHOLD)
                .map((l) => (
                  <span key={l.product_id} className="block">
                    {displayProductName(l.product_name)} : {l.delta > 0 ? "+" : ""}
                    {l.delta} {l.unit_label}
                  </span>
                ))}
              <span className="block mt-2">Es-tu sûr de vouloir appliquer cette correction ?</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={doSubmit}>Confirmer la correction</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

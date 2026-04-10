/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BlRetraitCorrectionDialog — "Corriger le BL Retrait"
 * 
 * Phase 3: Inline inputs replaced by UniversalQuantityModal.
 * Shows read-only qty + Pencil button per line.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { Loader2, Plus, Minus, AlertTriangle, Pencil } from "lucide-react";
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
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlRetraitLines } from "../hooks/useBlRetraitLines";
import { useCreateWithdrawalCorrection } from "../hooks/useCreateWithdrawalCorrection";
import { supabase } from "@/integrations/supabase/client";
import { buildCanonicalLine } from "@/modules/stockLedger";
import { QuantityModalWithResolver } from "@/components/stock/QuantityModalWithResolver";
import { type QuantityProduct } from "@/components/stock/UniversalQuantityModal";
import { useProductCurrentStock } from "@/hooks/useProductCurrentStock";
import type { BlRetraitDocument, BlRetraitLine } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blDocument: BlRetraitDocument;
}

interface EditableLine {
  product_id: string;
  product_name: string;
  effective_quantity: number;
  new_quantity: number;
  canonical_unit_id: string;
  unit_label: string;
}

const LARGE_DELTA_THRESHOLD = 50;

// ─── Hook: fetch cumulative correction deltas for this withdrawal ────────

function useCumulativeCorrectionDeltas(stockDocumentId: string | null, enabled: boolean) {
  return useQuery<Record<string, number>>({
    queryKey: ["bl-retrait-correction-deltas", stockDocumentId],
    queryFn: async () => {
      if (!stockDocumentId) return {};

      const { data: correctionDocs, error: docsErr } = await supabase
        .from("stock_documents")
        .select("id")
        .eq("corrects_document_id", stockDocumentId)
        .eq("status", "POSTED");

      if (docsErr) throw docsErr;
      if (!correctionDocs || correctionDocs.length === 0) return {};

      const docIds = correctionDocs.map((d) => d.id);
      const { data: lines, error: linesErr } = await supabase
        .from("stock_document_lines")
        .select("product_id, delta_quantity_canonical")
        .in("document_id", docIds);

      if (linesErr) throw linesErr;

      const deltaMap: Record<string, number> = {};
      for (const line of lines ?? []) {
        deltaMap[line.product_id] = (deltaMap[line.product_id] ?? 0) + line.delta_quantity_canonical;
      }

      const userDeltaMap: Record<string, number> = {};
      for (const [productId, stockDelta] of Object.entries(deltaMap)) {
        userDeltaMap[productId] = -stockDelta;
      }

      return userDeltaMap;
    },
    enabled: !!stockDocumentId && enabled,
  });
}

// ─── Hook: fetch product configs for popup ───────────────────────────────

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
    queryKey: ["product-configs-retrait-correction", productIds.sort().join(",")],
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

export function BlRetraitCorrectionDialog({ open, onOpenChange, blDocument }: Props) {
  const queryClient = useQueryClient();
  const { data: lines = [], isLoading } = useBlRetraitLines(blDocument.id);
  const { data: cumulativeDeltas = {}, isLoading: deltasLoading } = useCumulativeCorrectionDeltas(
    blDocument.stock_document_id,
    open
  );

  const createCorrection = useCreateWithdrawalCorrection();
  const [editLines, setEditLines] = useState<EditableLine[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isSubmittingRef = useRef(false);

  // Phase 3: popup state
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const blRetraitCorrectionStock = useProductCurrentStock(editingProductId);

  // Fetch unit abbreviations
  const unitIds = [...new Set(lines.map((l) => l.canonical_unit_id))];
  const { data: units = [] } = useQuery({
    queryKey: ["units-correction", unitIds.join(",")],
    queryFn: async () => {
      if (unitIds.length === 0) return [];
      const { data } = await supabase
        .from("measurement_units")
        .select("id, abbreviation, family, name")
        .in("id", unitIds);
      return data ?? [];
    },
    enabled: unitIds.length > 0 && open,
  });
  const unitMap = new Map(units.map((u) => [u.id, u.abbreviation]));

  // Fetch product configs for popup
  const productIds = useMemo(() => lines.map((l) => l.product_id), [lines]);
  const { data: productConfigs = [] } = useProductConfigs(productIds, open);
  const productConfigMap = useMemo(
    () => new Map(productConfigs.map((p) => [p.id, p])),
    [productConfigs]
  );

  // Fetch all units + conversions for BFS
  const { data: allUnits = [] } = useQuery({
    queryKey: ["all-units-retrait-correction", blDocument.establishment_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("measurement_units")
        .select("id, name, abbreviation, category, family, is_reference, aliases")
        .eq("establishment_id", blDocument.establishment_id)
        .eq("is_active", true);
      return data ?? [];
    },
    enabled: open,
  });

  const { data: allConversions = [] } = useQuery({
    queryKey: ["all-conversions-retrait-correction", blDocument.establishment_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("unit_conversions")
        .select("id, from_unit_id, to_unit_id, factor, establishment_id, is_active")
        .eq("establishment_id", blDocument.establishment_id)
        .eq("is_active", true);
      return data ?? [];
    },
    enabled: open,
  });

  // Initialize editable lines
  useEffect(() => {
    if (lines.length > 0 && open && !deltasLoading) {
      setEditLines(
        lines.map((l) => {
          const cumDelta = cumulativeDeltas[l.product_id] ?? 0;
          const effectiveQty = Math.round((l.quantity_canonical + cumDelta) * 10000) / 10000;
          return {
            product_id: l.product_id,
            product_name: l.product_name_snapshot,
            effective_quantity: effectiveQty,
            new_quantity: effectiveQty,
            canonical_unit_id: l.canonical_unit_id,
            unit_label: unitMap.get(l.canonical_unit_id) ?? "u",
          };
        })
      );
    }
  }, [lines, open, deltasLoading, cumulativeDeltas, unitMap.size]);

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

  // Fetch stock_document metadata for zone
  const { data: stockDocMeta } = useQuery({
    queryKey: ["stock-doc-meta", blDocument.stock_document_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("stock_documents")
        .select("storage_zone_id")
        .eq("id", blDocument.stock_document_id)
        .single();
      return data;
    },
    enabled: open,
  });

  const doSubmit = async () => {
    setConfirmOpen(false);
    if (!hasChanges || !stockDocMeta) return;
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

      const correctionLines = linesWithDelta.map((l) => {
        const product = productMap.get(l.product_id);
        const canonical = buildCanonicalLine({
          canonicalUnitId: l.canonical_unit_id,
          product: {
            supplier_billing_unit_id: product?.supplier_billing_unit_id ?? null,
            conditionnement_config: product?.conditionnement_config,
          },
          units: units,
        });

        return {
          product_id: l.product_id,
          user_delta: l.delta,
          canonical_unit_id: canonical.canonical_unit_id,
          canonical_family: canonical.canonical_family,
          canonical_label: l.unit_label,
          context_hash: canonical.context_hash,
        };
      });

      const result = await createCorrection.mutateAsync({
        originalStockDocumentId: blDocument.stock_document_id,
        blRetraitDocumentId: blDocument.id,
        establishmentId: blDocument.establishment_id,
        organizationId: blDocument.organization_id,
        storageZoneId: stockDocMeta.storage_zone_id,
        lines: correctionLines,
      });

      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: ["bl-retraits"] });
        await queryClient.invalidateQueries({ queryKey: ["bl-retrait-doc-detail", blDocument.id] });

        toast.success(
          `Correction appliquée (${result.events_created ?? 0} mouvement${(result.events_created ?? 0) > 1 ? "s" : ""})`
        );
        onOpenChange(false);
      } else {
        toast.error(`Erreur : ${result.error ?? "inconnue"}`);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Erreur inattendue");
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
            setEditingProductId(null);
          }
          onOpenChange(o);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Corriger le bon de sortie</DialogTitle>
            <DialogDescription>
              Modifie les quantités retirées. Le stock sera ajusté automatiquement.
              Si tu passes de 5 à 3, on remet 2 en stock.
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

                return (
                  <div
                    key={line.product_id}
                    className={`p-3 rounded-lg border ${
                      hasDelta
                        ? delta > 0
                          ? "border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30"
                          : "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30"
                        : "border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm truncate flex-1">
                        {line.product_name}
                      </span>
                      {hasDelta && (
                        <Badge
                          variant="outline"
                          className={`ml-2 text-xs ${
                            delta > 0
                              ? "text-orange-700 border-orange-300 dark:text-orange-400"
                              : "text-emerald-700 border-emerald-300 dark:text-emerald-400"
                          }`}
                        >
                          {delta > 0 ? (
                            <Plus className="h-3 w-3 mr-0.5" />
                          ) : (
                            <Minus className="h-3 w-3 mr-0.5" />
                          )}
                          {Math.abs(delta)} {line.unit_label}
                          {delta > 0 ? " (+ retiré)" : " (- retiré → stock ↑)"}
                        </Badge>
                      )}
                    </div>
                    {/* Phase 3: Read-only qty + pencil to open popup */}
                    <div className="flex items-center gap-3">
                      <div className="text-xs text-muted-foreground">
                        Actuel : <span className="font-mono">{line.effective_quantity}</span>{" "}
                        {line.unit_label}
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
          </div>

          <DialogFooter className="gap-2">
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
        contextLabel="Correction Retrait"
        contextType="correction"
        currentStockCanonical={blRetraitCorrectionStock.currentStockCanonical}
        currentStockUnitLabel={blRetraitCorrectionStock.currentStockUnitLabel}
        currentStockLoading={blRetraitCorrectionStock.isLoading}
        onConfirm={handlePopupConfirm}
      />

      {/* Large delta confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Correction importante
            </AlertDialogTitle>
            <AlertDialogDescription>
              Certaines lignes ont un écart supérieur à {LARGE_DELTA_THRESHOLD} unités.
              Confirmer cette correction ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={doSubmit}>Confirmer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

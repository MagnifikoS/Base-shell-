/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — ExtractedProductsModal (V2 STATUS SYSTEM)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Modal with extracted products showing automatic status.
 *
 * V1/V2 SUPPRESSES — V3 est le seul chemin (SSOT products_v2)
 * @see docs/SSOT-V3-ONLY.md
 *
 * Sub-components extracted to ./extracted/:
 * - ProductTable — scrollable table with status summary
 * - ProductRow — single row with code/name/risk display
 * - StatusActions — status cell with action buttons
 * - ModalFooter — cancel/accept/validate buttons
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Info } from "lucide-react";
import { ProductLineDrawer } from "./ProductLineDrawer";
import type { ExtractedProductLine } from "../types";
import type { EditableProductLine } from "../hooks/useBulkProductValidation";
import { useProductStatusV2 } from "@/modules/analyseFacture";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { toast } from "sonner";
import { ProductFormV3Modal } from "./ProductFormV3/ProductFormV3Modal";
import { ExistingProductSuggestions } from "./ExistingProductSuggestions";
import { SMART_MATCH_ENABLED } from "@/config/featureFlags";
import { SmartMatchDrawer, useSmartMatch } from "@/modules/smartMatch";
import {
  logProductMatchConfirmed,
  logProductMatchCorrected,
  logProductMatchConfirmedSupplierOnly,
} from "@/modules/theBrain";
import type { ResolvedProductLine } from "@/modules/achat";
import { ProductTable } from "./extracted/ProductTable";
import { StatusActions } from "./extracted/StatusActions";
import { ModalFooter } from "./extracted/ModalFooter";
import type { LineCorrection } from "./extracted/extractedTypes";

interface ExtractedProductsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ExtractedProductLine[];
  supplierName: string | null;
  /** THE BRAIN: Validated supplier ID for learning */
  supplierId: string | null;
  onAllValidated: () => void;
  /**
   * Callback when all products are resolved - triggers invoice auto-validation
   * @param resolvedLines - Array of resolved product lines with product_id for Achat module
   */
  onAllProductsResolved?: (resolvedLines?: ResolvedProductLine[]) => void;
}

// Generate unique ID for each item
function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export function ExtractedProductsModal({
  open,
  onOpenChange,
  items,
  supplierName,
  supplierId,
  onAllValidated,
  onAllProductsResolved,
}: ExtractedProductsModalProps) {
  const { activeEstablishment } = useEstablishment();

  // ── STATE ──
  const [editableItems, setEditableItems] = useState<EditableProductLine[]>([]);
  const [v3SelectedItem, setV3SelectedItem] = useState<EditableProductLine | null>(null);
  const [v3ModalOpen, setV3ModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItemId, setDrawerItemId] = useState<string | null>(null);
  const [resolvedPriceDecisions, setResolvedPriceDecisions] = useState<Set<string>>(new Set());
  const [suggestionsItem, setSuggestionsItem] = useState<EditableProductLine | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsSkipCategory, setSuggestionsSkipCategory] = useState(false);
  const [confirmedMatches, setConfirmedMatches] = useState<
    Record<string, { productId: string; confirmedAt: number }>
  >({});
  const [lineCorrections, setLineCorrections] = useState<Record<string, LineCorrection>>({});

  // SmartMatch hook (feature-flagged)
  const {
    isEnabled: smartMatchEnabled,
    drawerOpen: smartMatchDrawerOpen,
    request: smartMatchRequest,
    openSmartMatch,
    setDrawerOpen: setSmartMatchDrawerOpen,
  } = useSmartMatch();

  // ── INITIALIZE ──
  useEffect(() => {
    if (open && items.length > 0) {
      setEditableItems(
        items.map((item) => ({
          ...item,
          _id: generateId(),
          _error: undefined,
          _validated: false,
        }))
      );
      setResolvedPriceDecisions(new Set());
      setConfirmedMatches({});
      setLineCorrections({});
    }
  }, [open, items]);

  // ── CORRECTED ITEMS ──
  const correctedItems = useMemo(() => {
    return editableItems.map((item) => {
      const correction = lineCorrections[item._id];
      if (correction) {
        const correctedPrix = correction.isFreeLine
          ? 0
          : correction.montant !== undefined
            ? correction.montant
            : item.prix_total_ligne;

        return {
          ...item,
          code_produit: correction.code,
          nom_produit_complet: correction.name,
          quantite_commandee:
            correction.quantite !== undefined ? correction.quantite : item.quantite_commandee,
          prix_total_ligne: correctedPrix,
          price_missing: correction.isFreeLine ? true : item.price_missing,
        };
      }
      return item;
    });
  }, [editableItems, lineCorrections]);

  // ── V2 STATUS SYSTEM ──
  const {
    statuses,
    counts,
    isLoading: isLoadingStatuses,
    resolveItem,
    updateProductPrice: _updateProductPrice,
    refetch: refetchStatuses,
    productsV2,
  } = useProductStatusV2({
    items: correctedItems,
    enabled: open && editableItems.length > 0,
    confirmedMatches,
  });

  // ── PENDING COUNT ──
  const pendingCount = useMemo(() => {
    return editableItems.filter((item, index) => {
      if (item._validated) return false;
      const status = statuses.get(index);
      if (status?.status === "validated") return false;
      if (status?.status === "needs_action" && confirmedMatches[item._id]) return false;
      return true;
    }).length;
  }, [editableItems, statuses, confirmedMatches]);

  // ── COLLECT RESOLVED LINES ──
  const collectResolvedLines = useCallback((): ResolvedProductLine[] => {
    return correctedItems.map((item, index) => {
      const status = statuses.get(index);
      const productId =
        confirmedMatches[item._id]?.productId ?? status?.matchResult?.match?.product?.id ?? null;
      return {
        sourceLineId: item._id,
        productId,
        quantiteCommandee: item.quantite_commandee,
        lineTotalPrice: item.prix_total_ligne,
        productCodeSnapshot: item.code_produit,
        productNameSnapshot: item.nom_produit_complet,
        unitSnapshot: item.contenu_facture,
      };
    });
  }, [correctedItems, statuses, confirmedMatches]);

  // ── HANDLERS ──

  const handleAcceptAsIs = useCallback((itemId: string, _index: number) => {
    setEditableItems((prev) =>
      prev.map((item) =>
        item._id === itemId ? { ...item, _validated: true, _error: undefined } : item
      )
    );
    toast.success("Produit accept\u00e9 tel quel");
  }, []);

  const deleteItem = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setEditableItems((prev) => prev.filter((item) => item._id !== id));
  }, []);

  const handleOpenSuggestions = useCallback((item: EditableProductLine, skipCategory = false) => {
    setSuggestionsItem(item);
    setSuggestionsSkipCategory(skipCategory);
    setSuggestionsOpen(true);
  }, []);

  // SmartMatch: open drawer for a specific line
  const handleOpenSmartMatch = useCallback(
    (item: EditableProductLine) => {
      if (!activeEstablishment?.id || !supplierId) return;
      openSmartMatch({
        establishment_id: activeEstablishment.id,
        supplier_id: supplierId,
        raw_label: item.nom_produit_complet ?? "",
        code_produit: item.code_produit,
        category_suggestion: item.category_suggestion?.label ?? null,
      });
      // Store the item for callback
      setSuggestionsItem(item);
    },
    [activeEstablishment?.id, supplierId, openSmartMatch]
  );

  // SmartMatch: handle product selection from drawer (defined after handleSelectSuggestion)
  // We use a ref-stable pattern to avoid circular deps
  const handleSmartMatchSelect = useCallback(
    (productId: string, _productName: string) => {
      if (!suggestionsItem) return;
      const index = editableItems.findIndex((i) => i._id === suggestionsItem._id);
      if (index === -1) return;
      setConfirmedMatches((prev) => ({
        ...prev,
        [suggestionsItem._id]: { productId, confirmedAt: Date.now() },
      }));
      setResolvedPriceDecisions((prev) => new Set(prev).add(suggestionsItem._id));
      resolveItem(index);
      setSuggestionsItem(null);
    },
    [suggestionsItem, editableItems, resolveItem]
  );

  const handleApplyLineCorrection = useCallback(
    (
      itemId: string,
      correctedCode: string | null,
      correctedName: string,
      isFreeLine: boolean,
      correctedQuantite?: number | null,
      correctedMontant?: number | null
    ) => {
      setLineCorrections((prev) => ({
        ...prev,
        [itemId]: {
          code: correctedCode,
          name: correctedName,
          isFreeLine,
          quantite: correctedQuantite,
          montant: correctedMontant,
        },
      }));
      setResolvedPriceDecisions((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      setConfirmedMatches((prev) => {
        const { [itemId]: _, ...rest } = prev;
        return rest;
      });
      if (isFreeLine) {
        setResolvedPriceDecisions((prev) => new Set(prev).add(itemId));
        toast.success("Ligne marqu\u00e9e comme offerte (prix = 0 \u20ac)");
      } else {
        toast.success("Correction appliqu\u00e9e \u2014 recalcul du matching en cours");
      }
    },
    []
  );

  const handleSelectSuggestion = useCallback(
    (productId: string, selectedProductName?: string) => {
      if (!suggestionsItem) return;
      const index = editableItems.findIndex((i) => i._id === suggestionsItem._id);
      if (index === -1) return;

      const previousProductId = confirmedMatches[suggestionsItem._id]?.productId;
      const isReplacement = previousProductId && previousProductId !== productId;

      setConfirmedMatches((prev) => ({
        ...prev,
        [suggestionsItem._id]: { productId, confirmedAt: Date.now() },
      }));
      setResolvedPriceDecisions((prev) => new Set(prev).add(suggestionsItem._id));
      resolveItem(index);

      // THE BRAIN: Log human action
      if (activeEstablishment?.id) {
        if (isReplacement) {
          logProductMatchCorrected({
            establishmentId: activeEstablishment.id,
            supplierId,
            lineId: suggestionsItem._id,
            extracted: {
              code_produit: suggestionsItem.code_produit,
              nom_produit: suggestionsItem.nom_produit_complet,
              category: suggestionsItem.category_suggestion?.label ?? null,
            },
            previous: { product_id: previousProductId, product_code: null },
            selected: { product_id: productId, product_code: suggestionsItem.code_produit ?? null },
          });
        } else if (suggestionsSkipCategory) {
          logProductMatchConfirmedSupplierOnly({
            establishmentId: activeEstablishment.id,
            supplierId,
            supplierName,
            lineId: suggestionsItem._id,
            extracted: {
              code_produit: suggestionsItem.code_produit,
              nom_produit: suggestionsItem.nom_produit_complet,
              category: suggestionsItem.category_suggestion?.label ?? null,
            },
            selected: {
              product_id: productId,
              product_code: suggestionsItem.code_produit ?? null,
              product_name: selectedProductName ?? null,
            },
          });
        } else {
          logProductMatchConfirmed({
            establishmentId: activeEstablishment.id,
            supplierId,
            lineId: suggestionsItem._id,
            extracted: {
              code_produit: suggestionsItem.code_produit,
              nom_produit: suggestionsItem.nom_produit_complet,
              category: suggestionsItem.category_suggestion?.label ?? null,
            },
            selected: { product_id: productId, product_code: suggestionsItem.code_produit ?? null },
            strategy: "manual_select",
          });
        }
      }

      setSuggestionsOpen(false);
      setSuggestionsItem(null);
      setSuggestionsSkipCategory(false);
      toast.success(
        isReplacement
          ? "Produit remplac\u00e9 \u2014 recalcul du statut en cours"
          : "Produit s\u00e9lectionn\u00e9 \u2014 recalcul du statut en cours"
      );
    },
    [
      suggestionsItem,
      editableItems,
      resolveItem,
      activeEstablishment?.id,
      confirmedMatches,
      suggestionsSkipCategory,
      supplierName,
      supplierId,
    ]
  );

  const handleV3ModalClose = useCallback((open: boolean) => {
    setV3ModalOpen(open);
    if (!open) setV3SelectedItem(null);
  }, []);

  const handleV3Success = useCallback(() => {
    if (v3SelectedItem) {
      setEditableItems((prev) => {
        const updated = prev.map((item) =>
          item._id === v3SelectedItem._id ? { ...item, _validated: true, _error: undefined } : item
        );
        const pendingAfterUpdate = updated.filter((item) => !item._validated).length;
        if (pendingAfterUpdate === 0 && updated.length > 0) {
          setTimeout(() => {
            onAllValidated();
            onOpenChange(false);
          }, 100);
        }
        return updated;
      });
      refetchStatuses();
    }
    setV3ModalOpen(false);
    setV3SelectedItem(null);
  }, [v3SelectedItem, onAllValidated, onOpenChange, refetchStatuses]);

  const handleValidateAll = async () => {
    if (onAllProductsResolved) {
      onAllProductsResolved(collectResolvedLines());
    } else {
      onAllValidated();
    }
    onOpenChange(false);
  };

  const handleCancel = () => {
    if (editableItems.some((item) => !item._validated)) {
      toast.info("Vous devez valider les produits pour continuer.", {
        description: "Cliquez sur 'Voir les produits' pour les valider.",
      });
    }
    onOpenChange(false);
  };

  const handleAcceptAll = () => {
    setEditableItems((prev) =>
      prev.map((item) => ({ ...item, _validated: true, _error: undefined }))
    );
    toast.success("Tous les produits accept\u00e9s tels quels");
  };

  const getV3InitialData = (item: EditableProductLine) => {
    const corrected = correctedItems.find((c) => c._id === item._id) ?? item;
    return {
      nom_produit: corrected.nom_produit_complet ?? "",
      quantite_commandee: corrected.quantite_commandee,
      prix_total_ligne: corrected.prix_total_ligne,
      unite_facturee: null,
      code_produit: corrected.code_produit,
      info_produit: corrected.info_produit,
      vai_category: item.category_suggestion?.label ?? null,
    };
  };

  // Render status cell via extracted StatusActions component
  const renderStatusCell = useCallback(
    (item: EditableProductLine, index: number) => {
      const status = statuses.get(index);
      const isResolved = resolvedPriceDecisions.has(item._id);
      return (
        <StatusActions
          item={item}
          index={index}
          status={status}
          isLoadingStatuses={isLoadingStatuses}
          isResolved={isResolved}
          confirmedMatches={confirmedMatches}
          editableItems={editableItems}
          onAcceptAsIs={handleAcceptAsIs}
          onOpenSuggestions={handleOpenSuggestions}
          onOpenSmartMatch={smartMatchEnabled ? handleOpenSmartMatch : undefined}
        />
      );
    },
    [
      statuses,
      resolvedPriceDecisions,
      isLoadingStatuses,
      confirmedMatches,
      editableItems,
      handleAcceptAsIs,
      handleOpenSuggestions,
      smartMatchEnabled,
      handleOpenSmartMatch,
    ]
  );

  const isValidationBlocked = pendingCount > 0;

  // ── RENDER ──
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-7xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Produits extraits ({editableItems.length} ligne{editableItems.length > 1 ? "s" : ""})
            </DialogTitle>
            <DialogDescription>
              V\u00e9rifiez les produits et leurs statuts. Les produits reconnus avec un prix
              coh\u00e9rent sont valid\u00e9s automatiquement.
            </DialogDescription>
          </DialogHeader>

          {/* Blocking alert */}
          {isValidationBlocked && (
            <div className="flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-muted/50 border border-border text-sm text-muted-foreground">
              <Info className="h-4 w-4 flex-shrink-0" />
              <span>
                Certains produits n\u00e9cessitent une action avant de valider l'ensemble.
              </span>
            </div>
          )}

          {/* Product table with status summary */}
          <ProductTable
            correctedItems={correctedItems}
            editableItems={editableItems}
            statuses={statuses}
            isLoadingStatuses={isLoadingStatuses}
            resolvedPriceDecisions={resolvedPriceDecisions}
            lineCorrections={lineCorrections}
            confirmedMatches={confirmedMatches}
            counts={counts}
            onDelete={deleteItem}
            onOpenDrawer={(itemId) => {
              setDrawerItemId(itemId);
              setDrawerOpen(true);
            }}
            onOpenSuggestions={handleOpenSuggestions}
            renderStatusCell={renderStatusCell}
          />

          <ModalFooter
            pendingCount={pendingCount}
            totalCount={editableItems.length}
            onCancel={handleCancel}
            onAcceptAll={handleAcceptAll}
            onValidateAll={handleValidateAll}
          />
        </DialogContent>
      </Dialog>

      {/* V3 - WIZARD ProductFormV3Modal */}
      <ProductFormV3Modal
        open={v3ModalOpen}
        onOpenChange={handleV3ModalClose}
        initialData={v3SelectedItem ? getV3InitialData(v3SelectedItem) : null}
        supplierName={supplierName}
        supplierId={supplierId}
        onValidated={handleV3Success}
      />

      {/* PRODUCT LINE DRAWER */}
      {(() => {
        const drawerIndex = drawerItemId
          ? editableItems.findIndex((i) => i._id === drawerItemId)
          : -1;
        const drawerItem = drawerIndex >= 0 ? correctedItems[drawerIndex] : null;
        const drawerRawItem = drawerIndex >= 0 ? editableItems[drawerIndex] : null;
        const drawerStatus = drawerIndex >= 0 ? statuses.get(drawerIndex) : null;
        const drawerMatchedProductId =
          (drawerItemId && confirmedMatches[drawerItemId]?.productId) ??
          drawerStatus?.matchedProduct?.id ??
          null;

        return (
          <ProductLineDrawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            matchedProductId={drawerMatchedProductId}
            extractedName={drawerItem?.nom_produit_complet ?? ""}
            extractedCode={drawerRawItem?.code_produit ?? null}
            supplierId={supplierId}
            supplierName={supplierName}
            currentQuantite={drawerItem?.quantite_commandee ?? null}
            currentMontant={drawerItem?.prix_total_ligne ?? null}
            isFreeLine={drawerItemId ? (lineCorrections[drawerItemId]?.isFreeLine ?? false) : false}
            onApplyInvoiceCorrection={(quantite, montant, isFreeLine) => {
              if (!drawerItemId || !drawerRawItem) return;
              const existingCorrection = lineCorrections[drawerItemId];
              handleApplyLineCorrection(
                drawerItemId,
                existingCorrection?.code ?? drawerRawItem.code_produit,
                existingCorrection?.name ?? drawerRawItem.nom_produit_complet,
                isFreeLine,
                quantite,
                montant
              );
            }}
            onProductSaved={async (createdProductId?: string) => {
              await refetchStatuses();
              if (createdProductId && drawerItemId) {
                setConfirmedMatches((prev) => ({
                  ...prev,
                  [drawerItemId]: { productId: createdProductId, confirmedAt: Date.now() },
                }));
              }
            }}
            onOpenSuggestions={
              drawerItem
                ? () => {
                    setDrawerOpen(false);
                    handleOpenSuggestions(drawerRawItem!, false);
                  }
                : undefined
            }
          />
        );
      })()}

      {/* Suggestions panel */}
      <ExistingProductSuggestions
        open={suggestionsOpen}
        onOpenChange={(open) => {
          setSuggestionsOpen(open);
          if (!open) setSuggestionsSkipCategory(false);
        }}
        searchedProductName={suggestionsItem?.nom_produit_complet ?? null}
        supplierName={supplierName}
        category={suggestionsItem?.category_suggestion?.label ?? null}
        productsV2={productsV2}
        onSelectProduct={handleSelectSuggestion}
        onCreateNew={() => {
          setSuggestionsOpen(false);
          setSuggestionsSkipCategory(false);
          if (suggestionsItem) {
            setV3SelectedItem(suggestionsItem);
            setV3ModalOpen(true);
          }
        }}
        disabled={false}
        establishmentId={activeEstablishment?.id}
        supplierId={supplierId}
        skipCategoryFilter={suggestionsSkipCategory}
      />

      {/* SmartMatch Drawer (feature-flagged) */}
      {smartMatchEnabled && (
        <SmartMatchDrawer
          open={smartMatchDrawerOpen}
          onOpenChange={setSmartMatchDrawerOpen}
          request={smartMatchRequest}
          onSelectProduct={handleSmartMatchSelect}
          onCreateNew={suggestionsItem ? () => {
            setSmartMatchDrawerOpen(false);
            setV3SelectedItem(suggestionsItem);
            setV3ModalOpen(true);
          } : undefined}
        />
      )}
    </>
  );
}

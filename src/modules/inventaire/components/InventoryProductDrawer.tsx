/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE — Product Detail Drawer ("Centre de contrôle")
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 4 blocs:
 * 1. Stock (inventaire actuel) — MultiUnitEntryPopover
 * 2. Structure (arbre complet + cohérence BFS)
 * 3. Unités du produit (5 lignes, éditable where safe)
 * 4. Prix (base + display unit BFS-driven)
 *
 * RULES:
 * - Stock block never modifies product fields
 * - Structure edits → Wizard only
 * - UUID-only, zero hardcode, zero text fallback
 */

import { useState, useEffect, useMemo } from "react";
import type { EstimatedStockOutcome } from "@/modules/stockLedger";
import { displayProductName } from "@/utils/displayName";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  Package,
  AlertTriangle,
  Settings2,
  TreePine,
  DollarSign,
  Pencil,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { useProductV2 } from "@/modules/produitsV2";
import { useProductV2Mutations } from "@/modules/produitsV2";
import { useUnits } from "@/hooks/useUnits";
import { useUnitConversions } from "@/core/unitConversion";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import {
  resolveProductUnitContext,
  type ProductUnitInput,
} from "@/core/unitConversion/resolveProductUnitContext";
import { resolveDisplayPrice, type PriceDisplayProduct } from "@/modules/produitsV2";
import { buildStructureSummary } from "@/core/unitConversion/buildStructureSummary";
import { QuantityModalWithResolver } from "@/components/stock/QuantityModalWithResolver";
import { type QuantityProduct } from "@/components/stock/UniversalQuantityModal";
import { computeDisplayBreakdown } from "../utils/computeDisplayBreakdown";
import { formatQuantityForContext } from "@/lib/units/formatQuantityForContext";
import { useProductInputConfigs } from "@/modules/inputConfig";
import type { DesktopProductStock } from "../hooks/useDesktopStock";
import { ProductDetailModal } from "./ProductDetailModal";
import { useQueryClient } from "@tanstack/react-query";
import { useQuickAdjustment } from "../hooks/useQuickAdjustment";
// useInitializeProductStock removed — initialization now handled by Wizard

interface InventoryProductDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stockItem: DesktopProductStock | null;
  onStockUpdate: (
    product: DesktopProductStock,
    quantity: number,
    unitId: string | null,
    unitLabel?: string
  ) => void;
  onOpenWizard?: (productId: string) => void;
  /** Estimated stock map from StockEngine (SSOT) */
  estimatedStock?: Map<string, EstimatedStockOutcome>;
}

export function InventoryProductDrawer({
  open,
  onOpenChange,
  stockItem,
  onStockUpdate,
  onOpenWizard,
  estimatedStock,
}: InventoryProductDrawerProps) {
  const productId = stockItem?.product_id ?? null;
  const { product, isLoading } = useProductV2(open ? productId : null);
  const { update: _update } = useProductV2Mutations();
  const queryClient = useQueryClient();
  const { adjust, isAdjusting } = useQuickAdjustment();
  // initialization hook removed — handled by Wizard
  const { activeEstablishment } = useEstablishment();
  const _estId = activeEstablishment?.id;
  const { units: allUnits, kitchenUnits: _kitchenUnits } = useUnits();
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();
  const [ficheOpen, setFicheOpen] = useState(false);
  const inputConfigs = useProductInputConfigs();

  // Stock local state
  const [stockQty, setStockQty] = useState("");
  const [stockUnitId, setStockUnitId] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Inventory display unit — pending state (read-only, initialized from preferred_display_unit_id)
  const [pendingDisplayUnitId, setPendingDisplayUnitId] = useState<string | null>(null);

  // Kitchen unit local state (explicit save)
  const [localKitchenUnitId, setLocalKitchenUnitId] = useState<string | null>(null);
  const [_kitchenDirty, setKitchenDirty] = useState(false);

  // Stock handling unit local state (explicit save)
  const [localStockUnitId, setLocalStockUnitId] = useState<string | null>(null);
  const [_stockUnitDirty, setStockUnitDirty] = useState(false);

  // Price display unit local state
  const [localPriceDisplayUnitId, setLocalPriceDisplayUnitId] = useState<string | null>(null);
  const [_priceDisplayDirty, setPriceDisplayDirty] = useState(false);

  // Init from product
  useEffect(() => {
    if (product && open) {
      setLocalKitchenUnitId(product.kitchen_unit_id ?? null);
      setKitchenDirty(false);
      setLocalStockUnitId(product.stock_handling_unit_id ?? null);
      setStockUnitDirty(false);
      setLocalPriceDisplayUnitId(product.price_display_unit_id ?? null);
      setPriceDisplayDirty(false);
    }
  }, [product, open]);

  // Init stock fields + display unit from stockItem
  // Use estimated stock (StockEngine SSOT) if available, fall back to snapshot
  useEffect(() => {
    if (stockItem && open) {
      const outcome = productId ? estimatedStock?.get(productId) : undefined;
      if (outcome?.ok) {
        setStockQty(outcome.data.estimated_quantity.toString());
        setStockUnitId(outcome.data.canonical_unit_id);
      } else {
        setStockQty(stockItem.last_quantity?.toString() ?? "");
        setStockUnitId(stockItem.last_unit_id ?? null);
      }
      setPendingDisplayUnitId(stockItem.preferred_display_unit_id ?? null);
    }
  }, [stockItem, open, estimatedStock, productId]);

  // ── Unit resolution helper ──
  const getUnitLabel = (id: string | null): string | null => {
    if (!id) return null;
    const u = allUnits.find((unit) => unit.id === id);
    return u ? `${u.name} (${u.abbreviation})` : null;
  };

  // ── Product shape for SSOT context service ──
  const productForGraph: ProductUnitInput | null = useMemo(() => {
    if (!product) return null;
    return {
      stock_handling_unit_id: product.stock_handling_unit_id ?? null,
      final_unit_id: product.final_unit_id ?? null,
      delivery_unit_id: product.delivery_unit_id ?? null,
      supplier_billing_unit_id: product.supplier_billing_unit_id ?? null,
      conditionnement_config: product.conditionnement_config ?? null,
    };
  }, [product]);

  // ── Structure summary ──
  const structureSummary = useMemo(() => {
    if (!product?.conditionnement_config) return null;
    const config = product.conditionnement_config;
    return buildStructureSummary(
      config.packagingLevels ?? [],
      config.equivalence ?? null,
      config.finalUnit ?? null,
      config.final_unit_id ?? null,
      dbUnits,
      dbConversions
    );
  }, [product, dbUnits, dbConversions]);

  // ── Unit context via centralized SSOT service ──
  const unitContext = useMemo(() => {
    if (!productForGraph) return null;
    return resolveProductUnitContext(productForGraph, dbUnits, dbConversions);
  }, [productForGraph, dbUnits, dbConversions]);

  // ── Backward-compatible inventoryOpts shape ──
  const inventoryOpts = useMemo(() => {
    if (!unitContext) return null;
    return {
      targetUnitId: unitContext.canonicalInventoryUnitId,
      targetUnitLabel: unitContext.canonicalLabel,
      options: unitContext.allowedInventoryEntryUnits.map((u) => ({
        unitId: u.id,
        name: u.name,
        abbreviation: u.abbreviation,
        kind: u.kind,
        factorToTarget: u.factorToTarget,
      })),
      needsConfiguration: unitContext.needsConfiguration,
    };
  }, [unitContext]);

  // ── Price display ──
  const priceDisplay = useMemo(() => {
    if (!product) return null;
    const priceProduct: PriceDisplayProduct = {
      final_unit_price: product.final_unit_price ?? null,
      final_unit_id: product.final_unit_id ?? null,
      supplier_billing_unit_id: product.supplier_billing_unit_id ?? null,
      price_display_unit_id: localPriceDisplayUnitId,
      conditionnement_config: product.conditionnement_config ?? null,
    };
    return resolveDisplayPrice(priceProduct, dbUnits, dbConversions);
  }, [product, localPriceDisplayUnitId, dbUnits, dbConversions]);

  // ── Save handlers ──
  const _handleSaveStock = () => {
    if (!stockItem) return;
    const qty = parseFloat(stockQty);
    if (isNaN(qty) || qty < 0) return;
    const selectedUnit = dbUnits.find((u) => u.id === stockUnitId);
    const unitLabel = selectedUnit?.name || selectedUnit?.abbreviation;
    onStockUpdate(stockItem, qty, stockUnitId, unitLabel);
    toast.success("Stock mis à jour");
  };

  // P0-4 FIX: All unit saves invalidate desktop-stock + inventory-lines
  const _invalidateAllProductCaches = (pid: string) => {
    queryClient.invalidateQueries({ queryKey: ["product-v2", pid] });
    queryClient.invalidateQueries({ queryKey: ["products-v2"] });
    queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
    queryClient.invalidateQueries({ queryKey: ["inventory-lines"] });
  };

  // PHASE 1: Structural unit writes REMOVED from Drawer — Wizard only
  // handleSaveKitchenUnit, handleSaveStockUnit, handleSavePriceDisplayUnit DELETED
  // These fields are now read-only in the Drawer.

  // "Afficher en" handlers removed — display unit controlled at table level only

  // ── Breakdown display (memoized) ──
  const breakdownDisplay = useMemo(() => {
    if (!inventoryOpts || inventoryOpts.needsConfiguration) return null;
    const canonicalQty = parseFloat(stockQty) || 0;
    if (canonicalQty === 0) return null;
    const displayUnitId = pendingDisplayUnitId ?? inventoryOpts.targetUnitId;
    if (!displayUnitId) return null;
    return computeDisplayBreakdown(
      canonicalQty,
      displayUnitId,
      inventoryOpts.options.map((o) => ({
        id: o.unitId,
        name: o.name,
        abbreviation: o.abbreviation,
        kind: o.kind,
        factorToTarget: o.factorToTarget,
      }))
    );
  }, [stockQty, pendingDisplayUnitId, inventoryOpts]);

  // ── 5 unit rows data ──
  const unitRows = useMemo(() => {
    if (!product) return [];
    return [
      {
        label: "Livraison",
        unitId: product.delivery_unit_id ?? null,
        source: "Wizard",
        editable: false,
      },
      {
        label: "Facture",
        unitId: product.supplier_billing_unit_id ?? null,
        source: "Wizard",
        editable: false,
      },
      {
        label: "Stock / Inventaire",
        unitId: localStockUnitId,
        source: "Paramètre",
        editable: true,
        kind: "stock" as const,
      },
      {
        label: "Référence interne",
        unitId: product.final_unit_id ?? null,
        source: "Wizard",
        editable: false,
      },
      {
        label: "Cuisine / Recette",
        unitId: localKitchenUnitId,
        source: "Paramètre",
        editable: true,
        kind: "kitchen" as const,
      },
    ];
  }, [product, localStockUnitId, localKitchenUnitId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-lg font-semibold uppercase truncate flex-1">
              {displayProductName(product?.nom_produit || "Produit")}
            </SheetTitle>
            {productId && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setFicheOpen(true)}
                      aria-label="Ouvrir la fiche produit"
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Ouvrir la fiche produit</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <SheetDescription className="text-xs">
            {product?.code_produit && `Code: ${product.code_produit}`}
            {product?.supplier_id && ` · Fournisseur: ${product.supplier_id.slice(0, 8)}…`}
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">Chargement…</div>
        ) : (
          <div className="space-y-4 pb-24">
            {/* ════════════════════════════════════════════════════════════ */}
            {/* BLOC 1 — Stock estimé (StockEngine SSOT)                     */}
            {/* ════════════════════════════════════════════════════════════ */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Package className="h-4 w-4 text-primary" />
                Stock estimé
              </div>

              {/* Zone info — always show */}
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>
                  <span className="font-medium">Zone :</span>{" "}
                  {stockItem?.storage_zone_name ? (
                    stockItem.storage_zone_name
                  ) : stockItem?.storage_zone_id ? (
                    stockItem.storage_zone_id.slice(0, 8) + "…"
                  ) : (
                    <span className="text-destructive">Non assigné</span>
                  )}
                </p>
              </div>

              {(() => {
                if (!productForGraph || !inventoryOpts) return null;

                const hasActiveSession = !!stockItem?.active_session_id;
                const hasActiveCount =
                  stockItem?.active_quantity !== null && stockItem?.active_quantity !== undefined;

                if (!stockItem?.storage_zone_id) {
                  return (
                    <div className="text-xs text-destructive italic">
                      Ce produit n'est assigné à aucune zone de stockage. Il ne peut pas être
                      inventorié.
                    </div>
                  );
                }

                if (!stockItem?.latest_zone_session_id) {
                  if (hasActiveSession && hasActiveCount) {
                    const activeUnitLabel = stockItem.active_unit_id
                      ? (dbUnits.find((u) => u.id === stockItem.active_unit_id)?.abbreviation ??
                        "?")
                      : "?";
                    return (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                          <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                          <span className="text-xs text-amber-700 dark:text-amber-400">
                            Inventaire en cours (démarré le{" "}
                            {stockItem.active_session_started_at
                              ? new Date(stockItem.active_session_started_at).toLocaleDateString(
                                  "fr-FR",
                                  {
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )
                              : "?"}
                            )
                          </span>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-2xl font-bold font-mono">
                            {stockItem.active_quantity}
                          </span>
                          <span className="text-sm text-muted-foreground">{activeUnitLabel}</span>
                          <Badge
                            variant="outline"
                            className="ml-2 text-[10px] text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30"
                          >
                            En cours
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground/60 font-mono">
                          Source : session {stockItem.active_session_id?.slice(0, 8)}… — en cours
                        </p>
                        <p className="text-xs text-muted-foreground italic">
                          Aucun inventaire terminé. Cette valeur sera confirmée une fois
                          l'inventaire terminé sur mobile.
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground italic">
                        Aucun inventaire terminé pour cette zone.
                      </p>
                      {hasActiveSession && (
                        <div className="flex items-center gap-2 p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                          <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                          <span className="text-xs text-amber-700 dark:text-amber-400">
                            Inventaire en cours (démarré le{" "}
                            {stockItem.active_session_started_at
                              ? new Date(stockItem.active_session_started_at).toLocaleDateString(
                                  "fr-FR",
                                  {
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )
                              : "?"}
                            ) — aucun produit encore compté
                          </span>
                        </div>
                      )}
                    </div>
                  );
                }

                // ── NO_SNAPSHOT_LINE or FAMILY_MISMATCH: needs (re-)initialization ──
                // Compare snapshot's unit family with the product's CURRENT canonical unit family.
                // Old events with wrong family (IGNORED_EVENTS_FAMILY_MISMATCH warning) are normal
                // after reinitialization and must NOT trigger the reinitialize prompt.
                const stockOutcome = productId ? estimatedStock?.get(productId) : undefined;
                const stockErrCode = stockOutcome && !stockOutcome.ok 
                  ? (stockOutcome as { ok: false; error: { code: string } }).error?.code 
                  : null;

                // Detect real family drift: snapshot family ≠ product's current canonical family
                const currentTargetUnitId = inventoryOpts?.targetUnitId ?? null;
                const currentTargetFamily = currentTargetUnitId
                  ? (dbUnits.find((u) => u.id === currentTargetUnitId)?.family ?? null)
                  : null;
                const snapshotFamily = stockOutcome?.ok
                  ? stockOutcome.data.canonical_family
                  : null;
                const hasRealFamilyDrift =
                  stockOutcome?.ok === true &&
                  currentTargetFamily !== null &&
                  snapshotFamily !== null &&
                  currentTargetFamily !== snapshotFamily;

                const isNotInitialized =
                  stockErrCode === "NO_SNAPSHOT_LINE" ||
                  stockErrCode === "FAMILY_MISMATCH" ||
                  hasRealFamilyDrift;
                const displayErrCode = hasRealFamilyDrift ? "FAMILY_MISMATCH" : stockErrCode;

                if (isNotInitialized && productId) {
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30">
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                            {displayErrCode === "FAMILY_MISMATCH" ? "Conflit d'unité" : "Non initialisé"}
                          </p>
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            {displayErrCode === "FAMILY_MISMATCH" 
                              ? "L'unité du produit a changé. Éditez le produit via le Wizard pour corriger."
                              : "Ce produit n'a pas de stock de référence. Éditez-le via le Wizard pour l'initialiser."}
                          </p>
                        </div>
                      </div>
                      {onOpenWizard && (
                        <Button
                          variant="default"
                          size="sm"
                          className="w-full"
                          onClick={() => onOpenWizard(productId)}
                        >
                          <Settings2 className="h-4 w-4 mr-2" />
                          Corriger via Wizard
                        </Button>
                      )}
                    </div>
                  );
                }

                if (inventoryOpts.needsConfiguration) {
                  return (
                    <div className="text-xs text-destructive space-y-1">
                      <p>Unité cible manquante — configurez via le Wizard.</p>
                      {onOpenWizard && productId && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => onOpenWizard(productId)}
                        >
                          <Settings2 className="h-3 w-3 mr-1" /> Configurer
                        </Button>
                      )}
                    </div>
                  );
                }

                // ── Main stock display: breakdown + Modifier + Afficher en ──
                const canonicalQty = parseFloat(stockQty) || 0;
                const canonicalAbbr =
                  inventoryOpts.options.find((o) => o.kind === "target")?.abbreviation ?? "?";

                return (
                  <div className="space-y-3">
                    {/* Breakdown display + Modifier button */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {(() => {
                          // Use contextual projection (internal) as primary display
                          const contextualLabel = product ? formatQuantityForContext(
                            canonicalQty,
                            product,
                            "internal",
                            inputConfigs.get(product.id) ?? null,
                            dbUnits,
                            dbConversions,
                          ) : null;

                          if (contextualLabel && canonicalQty > 0) {
                            return (
                              <>
                                <p className="text-xl font-bold font-mono text-foreground">
                                  {contextualLabel}
                                </p>
                                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                  = {canonicalQty} {canonicalAbbr}
                                </p>
                              </>
                            );
                          }

                          // Fallback: raw canonical
                          return (
                            <p className="text-xl font-bold font-mono text-foreground">
                              {stockQty || "—"}{" "}
                              <span className="text-sm font-normal text-muted-foreground">
                                {canonicalAbbr}
                              </span>
                            </p>
                          );
                        })()}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0"
                        disabled={isAdjusting}
                        onClick={() => setPopoverOpen(true)}
                      >
                        <Pencil className="h-3 w-3 mr-1" /> {isAdjusting ? "En cours…" : "Modifier"}
                      </Button>
                    </div>

                    {/* "Afficher en" removed — display unit is controlled at table level only */}

                    {/* HARDENING P3: Stale stock_handling_unit_id warning */}
                    {unitContext?.hasStaleStockHandlingUnit && (
                      <div className="flex items-start gap-2 p-2 rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700">
                        <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <div className="text-xs text-amber-700 dark:text-amber-300">
                          <p className="font-medium">Configuration à re-valider</p>
                          <p className="mt-0.5">
                            L'unité de gestion diverge du canonical calculé. Repassez par le Wizard
                            (Étape 4).
                          </p>
                          {onOpenWizard && productId && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[10px] mt-1.5 border-amber-400 dark:border-amber-600"
                              onClick={() => onOpenWizard(productId)}
                            >
                              <Settings2 className="h-3 w-3 mr-1" /> Ouvrir Wizard
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                    {/* Source metadata */}
                    <p className="text-[10px] text-muted-foreground/60 font-mono">
                      Source : session {stockItem.latest_zone_session_id?.slice(0, 8)}… — terminé —{" "}
                      {stockItem.last_session_date
                        ? new Date(stockItem.last_session_date).toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "date inconnue"}
                    </p>

                    {/* Active session warning */}
                    {hasActiveSession && (
                      <div className="flex items-center gap-2 p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                        <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                        <span className="text-xs text-amber-700 dark:text-amber-400">
                          ⚠️ Un inventaire est en cours pour cette zone (démarré le{" "}
                          {stockItem.active_session_started_at
                            ? new Date(stockItem.active_session_started_at).toLocaleDateString(
                                "fr-FR",
                                {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }
                              )
                            : "?"}
                          ). La valeur affichée ci-dessus provient du dernier inventaire terminé et
                          peut différer du comptage mobile en cours.
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* ════════════════════════════════════════════════════════════ */}
            {/* BLOC 2 — Structure (arbre + cohérence BFS)                 */}
            {/* ════════════════════════════════════════════════════════════ */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <TreePine className="h-4 w-4 text-primary" />
                  Structure
                </div>
                {/* PATCH 2: Legacy conditioning badge */}
                {unitContext?.diagnostic?.some((d) => d.includes("legacy")) ? (
                  <Badge variant="destructive" className="text-xs">
                    À mettre à jour
                  </Badge>
                ) : structureSummary ? (
                  <Badge
                    variant={structureSummary.isCoherent ? "default" : "secondary"}
                    className={
                      structureSummary.isCoherent
                        ? "bg-green-600 dark:bg-green-700 text-xs"
                        : "bg-amber-600 dark:bg-amber-700 text-xs"
                    }
                  >
                    {structureSummary.isCoherent ? "Cohérent" : "Incohérent"}
                  </Badge>
                ) : null}
              </div>

              {structureSummary && structureSummary.lines.length > 0 ? (
                <pre className="text-sm whitespace-pre-wrap font-mono text-foreground/80">
                  {structureSummary.lines.map((l) => l.label).join("\n")}
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Aucun conditionnement configuré
                </p>
              )}

              {structureSummary?.diagnosticMessage && (
                <div className="flex items-center gap-2 p-1.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                  <span className="text-xs text-amber-700 dark:text-amber-400">
                    {structureSummary.diagnosticMessage}
                  </span>
                </div>
              )}

              {onOpenWizard && productId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onOpenWizard(productId)}
                >
                  <Settings2 className="h-3 w-3 mr-1" /> Modifier la structure
                </Button>
              )}
            </div>

            <Separator />

            {/* ════════════════════════════════════════════════════════════ */}
            {/* BLOC 3 — Unités du produit (5 lignes)                      */}
            {/* ════════════════════════════════════════════════════════════ */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Settings2 className="h-4 w-4 text-primary" />
                Unités du produit
              </div>

              <div className="space-y-1">
                {unitRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between py-1.5 border-b last:border-b-0"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">{row.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">({row.source})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* PHASE 1: All units are read-only — Wizard only */}
                      <span className="text-xs">
                        {getUnitLabel(row.unitId) || (
                          <span className="text-muted-foreground italic">Non configuré</span>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* ════════════════════════════════════════════════════════════ */}
            {/* BLOC 4 — Prix                                              */}
            {/* ════════════════════════════════════════════════════════════ */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <DollarSign className="h-4 w-4 text-primary" />
                Prix
              </div>

              {priceDisplay && priceDisplay.basePrice !== null ? (
                <div className="space-y-3">
                  <div className="text-sm">
                    <span className="text-muted-foreground text-xs">Prix de base : </span>
                    <span className="font-semibold">
                      {parseFloat(priceDisplay.basePrice.toFixed(4))} € /{" "}
                      {priceDisplay.baseUnitAbbr ?? "—"}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Afficher en :</span>
                    <Select
                      value={localPriceDisplayUnitId ?? priceDisplay.baseUnitId ?? "__default__"}
                      disabled
                    >
                      <SelectTrigger className="h-7 w-40 text-xs opacity-60">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background z-50">
                        {priceDisplay.displayOptions.map((o) => (
                          <SelectItem key={o.unitId} value={o.unitId}>
                            {o.name} ({o.abbreviation})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* PHASE 1: price_display_unit_id is read-only — Wizard only */}
                    <span className="text-[10px] text-muted-foreground italic">
                      Modifier via Wizard
                    </span>
                  </div>

                  {priceDisplay.convertedPrice !== null && priceDisplay.displayUnitAbbr && (
                    <div className="p-2 rounded bg-primary/5 border">
                      <span className="text-lg font-bold">
                        {parseFloat(priceDisplay.convertedPrice.toFixed(4))} €
                      </span>
                      <span className="text-sm text-muted-foreground ml-1">
                        / {priceDisplay.displayUnitAbbr}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Prix non configuré — passez par le Wizard.
                </p>
              )}
            </div>
          </div>
        )}
      </SheetContent>

      {/* Product Detail Modal */}
      {productId && (
        <ProductDetailModal open={ficheOpen} onOpenChange={setFicheOpen} productId={productId} />
      )}

      {/* Universal Quantity Modal for stock adjustment */}
      <QuantityModalWithResolver
        open={popoverOpen}
        onClose={() => setPopoverOpen(false)}
        product={product ? {
          id: product.id,
          nom_produit: product.nom_produit,
          stock_handling_unit_id: product.stock_handling_unit_id ?? null,
          final_unit_id: product.final_unit_id ?? null,
          delivery_unit_id: product.delivery_unit_id ?? null,
          supplier_billing_unit_id: product.supplier_billing_unit_id ?? null,
          conditionnement_config: product.conditionnement_config as unknown as Record<string, unknown> | null,
        } : null}
        dbUnits={dbUnits}
        dbConversions={dbConversions}
        existingQuantity={parseFloat(stockQty) || null}
        contextLabel="Ajustement stock"
        contextType="adjustment"
        currentStockCanonical={parseFloat(stockQty) || null}
        currentStockUnitLabel={(() => {
          const o = inventoryOpts?.options.find((o) => o.kind === "target");
          return o ? (o.name || o.abbreviation) : null;
        })()}
        onConfirm={async (params) => {
          if (stockItem?.storage_zone_id) {
            const outcome = productId ? estimatedStock?.get(productId) : undefined;
            const currentEstimated = outcome?.ok
              ? outcome.data.estimated_quantity
              : (parseFloat(stockQty) || 0);
            const currentUnitId = outcome?.ok
              ? outcome.data.canonical_unit_id
              : (stockUnitId ?? "");
            const family =
              dbUnits.find((u) => u.id === currentUnitId)?.family ?? "count";
            const result = await adjust({
              productId: stockItem.product_id,
              storageZoneId: stockItem.storage_zone_id,
              estimatedQty: currentEstimated,
              canonicalUnitId: currentUnitId,
              canonicalFamily: family,
              canonicalLabel: params.canonicalLabel,
              targetQty: params.canonicalQuantity,
            });
            if (!result.ok) {
              toast.error(result.error ?? "Erreur lors de la correction");
            } else {
              toast.success("Stock corrigé");
            }
          }
        }}
      />
    </Sheet>
  );
}

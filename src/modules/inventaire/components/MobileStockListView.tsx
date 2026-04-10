/**
 * MobileStockListView — Mobile stock consultation + quick edit
 * 
 * Tap product line → single dialog: Stock + Seuil + Zone
 * 
 * SSOT paths (0 new):
 * - Stock correction: useQuickAdjustment → fn_quick_adjustment RPC
 * - Seuil: useMinStockSave → updateProductV2
 * - Zone: useTransferProductZone → fn_transfer_product_zone RPC
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { normalizeSearch } from "@/utils/normalizeSearch";
import { useTapGuard } from "@/hooks/useTapGuard";

import { displayProductName } from "@/utils/displayName";
import { ArrowLeft, Search, Loader2, Package, Gauge, MapPin, ChevronRight, X, ShoppingCart, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useDesktopStock, type DesktopProductStock } from "../hooks/useDesktopStock";
import { useEstimatedStock } from "../hooks/useEstimatedStock";
import { useUnitConversions } from "@/core/unitConversion";
import { useStorageZones, useMinStockSave } from "@/modules/produitsV2";
import { useTransferProductZone } from "../hooks/useTransferProductZone";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useSuppliersList } from "@/modules/produitsV2/hooks/useSuppliersList";
import { useQuickAdjustment } from "../hooks/useQuickAdjustment";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrderPrepForProduct, useUpsertOrderPrep } from "@/modules/orderPrep";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  type ProductUnitInput,
} from "@/core/unitConversion/resolveProductUnitContext";
import { displayUnitName } from "@/lib/units/displayUnitName";
import { resolveStockDisplay, getProductEntryUnits } from "../utils/resolveStockDisplay";
import { useProductInputConfigs, resolveInputUnitForContext } from "@/modules/inputConfig";
import type { ProductForResolution } from "@/modules/inputConfig";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  onBack: () => void;
}

function getProductUnitInput(product: DesktopProductStock): ProductUnitInput {
  return {
    stock_handling_unit_id: product.stock_handling_unit_id,
    final_unit_id: product.final_unit_id,
    delivery_unit_id: product.delivery_unit_id,
    supplier_billing_unit_id: product.supplier_billing_unit_id,
    conditionnement_config: product.conditionnement_config,
  };
}

export function MobileStockListView({ onBack }: Props) {
  const { activeEstablishment } = useEstablishment();
  const isFournisseur = activeEstablishment?.establishment_type === "fournisseur";
  const { stock, isLoading } = useDesktopStock();
  const { onTouchStart, onTouchMove, guardedClick } = useTapGuard();
  const { estimatedStock, isError: isEstimatedStockError } = useEstimatedStock();
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();
  const inputConfigMap = useProductInputConfigs();
  const { zones: storageZones } = useStorageZones();
  const { saveMinStock, isSaving: isSavingSeuil } = useMinStockSave();
  const { adjust, isAdjusting } = useQuickAdjustment();
  const { transfer: transferZone, isTransferring: isTransferringZone } = useTransferProductZone();
  const { data: suppliers = [] } = useSuppliersList();
  const queryClient = useQueryClient();
  const upsertOrderPrep = useUpsertOrderPrep();

  const [search, setSearch] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);

  // Single edit dialog state
  const [editProduct, setEditProduct] = useState<DesktopProductStock | null>(null);
  const [stockInput, setStockInput] = useState("");
  // Multi-level stock inputs: one value per chain unit (largest → smallest)
  const [multiLevelInputs, setMultiLevelInputs] = useState<string[]>([]);
  const [seuilInput, setSeuilInput] = useState("");
  const [zoneInput, setZoneInput] = useState("");
  const [orderQtyInput, setOrderQtyInput] = useState("");
  const [orderUnitInput, setOrderUnitInput] = useState("");
  const [savingZone, setSavingZone] = useState(false);

  // Build supplier options from actual stock data
  const supplierOptions = useMemo(() => {
    const supplierIds = new Set(stock.map((p) => p.supplier_id).filter(Boolean));
    return suppliers
      .filter((s) => supplierIds.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [stock, suppliers]);

  const filtered = useMemo(() => {
    let result = stock;

    // Supplier filter
    if (selectedSupplierId) {
      result = result.filter((p) => p.supplier_id === selectedSupplierId);
    }

    // Search filter
    if (search.trim()) {
      const q = normalizeSearch(search);
      result = result.filter((p) => normalizeSearch(p.nom_produit).includes(q));
    }

    // Sort: 0 stock first, then ascending by estimated quantity
    result = [...result].sort((a, b) => {
      const estA = estimatedStock?.get(a.product_id);
      const estB = estimatedStock?.get(b.product_id);
      const qtyA = estA?.ok ? estA.data.estimated_quantity : Infinity;
      const qtyB = estB?.ok ? estB.data.estimated_quantity : Infinity;
      return qtyA - qtyB;
    });

    return result;
  }, [stock, search, selectedSupplierId, estimatedStock]);

  /**
   * Resolve the "internal" unit for a product via SSOT.
   * Returns either single-unit info or multi_level chain info.
   */
  type EditUnitInfo =
    | { mode: "single"; unitName: string; factorToTarget: number; unitId: string; canonicalUnitId: string }
    | { mode: "multi_level"; chainUnits: { id: string; name: string; abbreviation: string | null; factorToTarget: number }[]; canonicalUnitId: string };

  const resolveEditUnit = useCallback(
    (product: DesktopProductStock): EditUnitInfo | null => {
      const config = inputConfigMap.get(product.product_id) ?? null;
      const prodForRes: ProductForResolution = {
        id: product.product_id,
        nom_produit: product.nom_produit,
        final_unit_id: product.final_unit_id ?? null,
        stock_handling_unit_id: product.stock_handling_unit_id ?? null,
        delivery_unit_id: product.delivery_unit_id ?? null,
        supplier_billing_unit_id: product.supplier_billing_unit_id ?? null,
        conditionnement_config: product.conditionnement_config,
      };
      const resolved = resolveInputUnitForContext(prodForRes, "internal", config, dbUnits, dbConversions);

      if (resolved.status !== "ok") {
        // Fallback: legacy path
        const entryUnits = getProductEntryUnits(getProductUnitInput(product), dbUnits, dbConversions);
        const u = entryUnits[0];
        if (!u) return null;
        return {
          mode: "single",
          unitName: displayUnitName({ name: u.name, abbreviation: u.abbreviation }),
          factorToTarget: u.factorToTarget ?? 1,
          unitId: u.id,
          canonicalUnitId: u.id,
        };
      }

      if (resolved.mode === "multi_level") {
        const chainSet = new Set(resolved.unitChain);
        const chainUnits = resolved.reachableUnits
          .filter((u) => chainSet.has(u.id))
          .sort((a, b) => b.factorToTarget - a.factorToTarget);
        if (chainUnits.length === 0) return null;
        return {
          mode: "multi_level",
          chainUnits: chainUnits.map((u) => ({
            id: u.id,
            name: u.name,
            abbreviation: u.abbreviation ?? null,
            factorToTarget: u.factorToTarget,
          })),
          canonicalUnitId: resolved.canonicalUnitId,
        };
      }

      // Single unit
      const ru = resolved.reachableUnits.find((u) => u.id === resolved.unitId);
      return {
        mode: "single",
        unitName: resolved.unitName,
        factorToTarget: ru?.factorToTarget ?? 1,
        unitId: resolved.unitId,
        canonicalUnitId: resolved.canonicalUnitId,
      };
    },
    [dbUnits, dbConversions, inputConfigMap],
  );

  /** Helper: greedy decomposition of canonical qty into chain units (largest first) */
  const decomposeCanonical = useCallback(
    (canonicalQty: number, chainUnits: { factorToTarget: number }[]): number[] => {
      const values: number[] = [];
      let remainder = Math.abs(canonicalQty);
      for (let i = 0; i < chainUnits.length; i++) {
        const isLast = i === chainUnits.length - 1;
        const factor = chainUnits[i].factorToTarget;
        if (isLast) {
          values.push(Math.round(remainder * 10000) / 10000);
          remainder = 0;
        } else {
          const qty = Math.floor(remainder / factor);
          values.push(qty);
          remainder = Math.round((remainder - qty * factor) * 10000) / 10000;
        }
      }
      return values;
    },
    [],
  );

  /** Helper: recompose multi-level inputs back to canonical */
  const recomposeToCanonical = useCallback(
    (inputs: string[], chainUnits: { factorToTarget: number }[]): number => {
      let total = 0;
      for (let i = 0; i < chainUnits.length; i++) {
        const val = parseFloat(inputs[i] ?? "0");
        if (!isNaN(val)) total += val * chainUnits[i].factorToTarget;
      }
      return total;
    },
    [],
  );

  /** Get first-level factor for single-mode helpers */
  const getSingleFactor = useCallback(
    (editUnit: EditUnitInfo): number => {
      if (editUnit.mode === "single") return editUnit.factorToTarget;
      return editUnit.chainUnits[0]?.factorToTarget ?? 1;
    },
    [],
  );

  const getDisplayInfo = useCallback(
    (product: DesktopProductStock) => {
      const estOutcome = estimatedStock?.get(product.product_id);
      const estQty = estOutcome?.ok ? Math.max(0, estOutcome.data.estimated_quantity) : null;

      // Use SSOT display logic (same as desktop)
      const displayResult = estQty !== null
        ? resolveStockDisplay(
            {
              stock_handling_unit_id: product.stock_handling_unit_id,
              final_unit_id: product.final_unit_id,
              delivery_unit_id: product.delivery_unit_id,
              supplier_billing_unit_id: product.supplier_billing_unit_id,
              conditionnement_config: product.conditionnement_config,
              preferred_display_unit_id: product.preferred_display_unit_id,
              inventory_display_unit_id: product.inventory_display_unit_id,
            },
            estQty,
            dbUnits,
            dbConversions,
            "canonical",
            inputConfigMap.get(product.product_id),
          )
        : null;

      let stockDisplay = "—";
      let unitLabel = "";
      if (displayResult?.mode === "canonical") {
        stockDisplay = displayResult.result.label;
        // For simple display (1 segment), extract unit label separately
        if (displayResult.isSimple) {
          const seg = displayResult.result.segments[0];
          stockDisplay = String(seg.quantity % 1 === 0 ? seg.quantity : parseFloat(seg.quantity.toFixed(1)));
          unitLabel = displayUnitName({ name: seg.name, abbreviation: seg.abbreviation });
        }
      }

      // For edit dialog: use resolved internal unit (single mode only for legacy display)
      const editUnit = resolveEditUnit(product);
      let displayQtyRaw = 0;
      if (estQty !== null && editUnit) {
        if (editUnit.mode === "single") {
          displayQtyRaw = editUnit.factorToTarget ? estQty / editUnit.factorToTarget : estQty;
        } else {
          // multi_level: displayQtyRaw not used for input; just store canonical
          displayQtyRaw = estQty;
        }
      }

      let seuilDisplay = "";
      let seuilDisplayQty = 0;
      const minCanonical = product.min_stock_quantity_canonical;
      if (minCanonical != null && editUnit) {
        const factor = getSingleFactor(editUnit);
        seuilDisplayQty = factor ? minCanonical / factor : minCanonical;
        const unitName = editUnit.mode === "single"
          ? editUnit.unitName
          : displayUnitName({ name: editUnit.chainUnits[0].name, abbreviation: editUnit.chainUnits[0].abbreviation });
        seuilDisplay = `${seuilDisplayQty % 1 === 0 ? String(seuilDisplayQty) : seuilDisplayQty.toFixed(1)} ${unitName}`;
      }

      const isLow = estQty !== null && minCanonical != null && estQty <= minCanonical;

      return { stockDisplay, unitLabel, seuilDisplay, isLow, displayQtyRaw, seuilDisplayQty, estQty };
    },
    [dbUnits, dbConversions, estimatedStock, inputConfigMap, resolveEditUnit, getSingleFactor]
  );

  const getUnitLabel = useCallback(
    (product: DesktopProductStock) => {
      const editUnit = resolveEditUnit(product);
      if (!editUnit) return "";
      if (editUnit.mode === "single") return editUnit.unitName;
      return displayUnitName({ name: editUnit.chainUnits[0].name, abbreviation: editUnit.chainUnits[0].abbreviation });
    },
    [resolveEditUnit]
  );

  // Open unified edit dialog
  // Existing order prep line for current product
  const existingOrderPrep = useOrderPrepForProduct(editProduct?.product_id ?? null);

  const openEditDialog = useCallback(
    (product: DesktopProductStock) => {
      const info = getDisplayInfo(product);
      const editUnit = resolveEditUnit(product);

      if (editUnit?.mode === "multi_level" && info.estQty !== null) {
        // Multi-level: decompose canonical into chain levels
        const decomposed = decomposeCanonical(info.estQty, editUnit.chainUnits);
        setMultiLevelInputs(decomposed.map(String));
        setStockInput(""); // not used in multi_level
      } else {
        setStockInput(info.estQty !== null ? String(info.displayQtyRaw) : "");
        setMultiLevelInputs([]);
      }

      setSeuilInput(info.seuilDisplayQty ? String(info.seuilDisplayQty) : "");
      setZoneInput(product.storage_zone_id ?? "");
      setOrderQtyInput("");
      setOrderUnitInput("");
      setEditProduct(product);
    },
    [getDisplayInfo, resolveEditUnit, decomposeCanonical]
  );

  // Pre-fill order prep when existing line loads for the currently edited product
  const existingPrepData = existingOrderPrep.data;
  const editProductId = editProduct?.product_id;
  useEffect(() => {
    if (editProductId && existingPrepData) {
      setOrderQtyInput(String(existingPrepData.quantity));
      setOrderUnitInput(existingPrepData.unit_id);
    }
  }, [existingPrepData, editProductId]);

  // Get order entry units for the edited product
  const orderEntryUnits = useMemo(() => {
    if (!editProduct) return [];
    return getProductEntryUnits(getProductUnitInput(editProduct), dbUnits, dbConversions);
  }, [editProduct, dbUnits, dbConversions]);

  // Resolve edit unit info for the currently edited product (for dialog rendering)
  const editUnitInfo = useMemo(() => {
    if (!editProduct) return null;
    return resolveEditUnit(editProduct);
  }, [editProduct, resolveEditUnit]);

  // Save all: stock + seuil + zone
  const handleSave = useCallback(async () => {
    if (!editProduct || !editUnitInfo) return;

    const estOutcome = estimatedStock?.get(editProduct.product_id);
    const estQty = estOutcome?.ok ? estOutcome.data.estimated_quantity : null;

    const changes: string[] = [];

    // 1. Stock correction
    let newCanonical: number | null = null;
    if (editUnitInfo.mode === "multi_level") {
      newCanonical = recomposeToCanonical(multiLevelInputs, editUnitInfo.chainUnits);
    } else {
      const newStockDisplay = parseFloat(stockInput);
      if (!isNaN(newStockDisplay)) {
        newCanonical = newStockDisplay * editUnitInfo.factorToTarget;
      }
    }

    if (newCanonical !== null && editProduct.storage_zone_id && editUnitInfo.canonicalUnitId) {
      const currentCanonical = estQty ?? 0;
      if (Math.abs(newCanonical - currentCanonical) > 0.001) {
        const canonicalUnit = dbUnits.find((unit) => unit.id === editUnitInfo.canonicalUnitId);
        const result = await adjust({
          productId: editProduct.product_id,
          storageZoneId: editProduct.storage_zone_id,
          estimatedQty: currentCanonical,
          canonicalUnitId: editUnitInfo.canonicalUnitId,
          canonicalFamily: canonicalUnit?.family ?? "weight",
          canonicalLabel: canonicalUnit?.name ?? null,
          targetQty: newCanonical,
        });
        if (result.ok) changes.push("stock");
        else toast.error(result.error ?? "Erreur correction stock");
      }
    }

    // 2. Seuil (always uses first-level factor for simplicity)
    const seuilFactor = getSingleFactor(editUnitInfo);
    const seuilUnitId = editUnitInfo.mode === "single" ? editUnitInfo.unitId : editUnitInfo.chainUnits[0]?.id ?? null;
    const newSeuilDisplay = parseFloat(seuilInput);
    const currentMinCanonical = editProduct.min_stock_quantity_canonical;
    if (!isNaN(newSeuilDisplay) && newSeuilDisplay >= 0) {
      const newSeuilCanonical = newSeuilDisplay * seuilFactor;
      const changed =
        currentMinCanonical == null
          ? newSeuilDisplay > 0
          : Math.abs(newSeuilCanonical - currentMinCanonical) > 0.001;
      if (changed) {
        await saveMinStock(editProduct.product_id, newSeuilDisplay, seuilFactor, seuilUnitId);
        changes.push("seuil");
      }
    } else if (seuilInput === "" && currentMinCanonical != null) {
      await saveMinStock(editProduct.product_id, 0, 1, null);
      changes.push("seuil");
    }

    // 3. Zone (via fn_transfer_product_zone — SSOT conforme)
    if (zoneInput && zoneInput !== (editProduct.storage_zone_id ?? "")) {
      setSavingZone(true);
      try {
        const estOutcomeForZone = estimatedStock?.get(editProduct.product_id);
        const currentQty = estOutcomeForZone?.ok ? estOutcomeForZone.data.estimated_quantity : 0;
        const canonicalUnit = dbUnits.find((unit) => unit.id === editUnitInfo.canonicalUnitId);

        const result = await transferZone({
          productId: editProduct.product_id,
          newZoneId: zoneInput,
          estimatedQty: currentQty,
          canonicalUnitId: editUnitInfo.canonicalUnitId ?? null,
          canonicalFamily: canonicalUnit?.family ?? null,
          contextHash: null,
        });
        if (result.ok) {
          changes.push("zone");
        }
      } catch {
        // Error toast is handled by useTransferProductZone hook
      } finally {
        setSavingZone(false);
      }
    }

    // 4. À commander
    const orderQty = parseFloat(orderQtyInput);
    if (!isNaN(orderQty) && orderQty > 0 && editProduct.supplier_id) {
      const selectedUnitId = orderUnitInput || (editUnitInfo.mode === "single" ? editUnitInfo.unitId : editUnitInfo.chainUnits[0]?.id);
      if (selectedUnitId) {
        try {
          await upsertOrderPrep.mutateAsync({
            productId: editProduct.product_id,
            productName: editProduct.nom_produit,
            supplierId: editProduct.supplier_id,
            quantity: orderQty,
            unitId: selectedUnitId,
          });
          changes.push("à commander");
        } catch {
          // Error already handled by mutation
        }
      }
    }

    if (changes.length > 0) {
      toast.success("Mis à jour : " + changes.join(", "));
    }

    setEditProduct(null);
  }, [editProduct, editUnitInfo, stockInput, multiLevelInputs, seuilInput, zoneInput, orderQtyInput, orderUnitInput, dbUnits, estimatedStock, adjust, saveMinStock, queryClient, upsertOrderPrep, recomposeToCanonical, getSingleFactor, transferZone]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Chargement du stock…</p>
      </div>
    );
  }

  const isSaving = isSavingSeuil || isAdjusting || savingZone || upsertOrderPrep.isPending;

  return (
    <div className="flex flex-col gap-3">
      {/* Estimated stock error banner */}
      {isEstimatedStockError && (
        <div className="mx-1 p-3 rounded-lg border border-destructive/30 bg-destructive/10 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-xs text-destructive">
            Le calcul du stock estimé a échoué. Les quantités affichées peuvent être incorrectes.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-lg font-semibold text-foreground">Stock</h2>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Rechercher un produit…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Supplier filter chips */}
      {supplierOptions.length > 1 && (
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex gap-1.5 pb-1">
            <button
              onClick={() => setSelectedSupplierId(null)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors touch-manipulation ${
                !selectedSupplierId
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
              }`}
            >
              Tous
            </button>
            {supplierOptions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSupplierId(selectedSupplierId === s.id ? null : s.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors touch-manipulation ${
                  selectedSupplierId === s.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
                }`}
              >
                {s.trade_name || s.name}
              </button>
            ))}
          </div>
          <ScrollBar orientation="horizontal" className="h-0" />
        </ScrollArea>
      )}

      {/* Product list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <Package className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Aucun produit trouvé</p>
        </div>
      ) : (
        <div className="divide-y divide-border/50 rounded-xl border border-border/50 bg-card overflow-hidden">
          {filtered.map((product) => {
            const { stockDisplay, unitLabel, seuilDisplay, isLow } = getDisplayInfo(product);
            return (
              <div
                key={product.product_id}
                className="flex items-center gap-3 px-4 py-3 active:bg-muted/40 transition-colors cursor-pointer touch-manipulation"
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onClick={guardedClick(() => openEditDialog(product))}
              >
                {/* Left: Name + zone */}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground leading-tight break-words">
                    {displayProductName(product.nom_produit)}
                  </p>
                  {product.storage_zone_name && (
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5 flex items-center gap-0.5">
                      <MapPin className="h-2.5 w-2.5" />
                      {product.storage_zone_name}
                    </p>
                  )}
                </div>

                {/* Right: Stock + seuil */}
                <div className="flex flex-col items-end shrink-0">
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      isLow ? "text-destructive" : "text-foreground"
                    }`}
                  >
                    {stockDisplay} <span className="text-[11px] font-normal text-muted-foreground">{unitLabel}</span>
                  </span>
                  {seuilDisplay && (
                    <span className="text-[10px] text-muted-foreground/60 tabular-nums leading-tight">
                      seuil {seuilDisplay}
                    </span>
                  )}
                </div>

                <ChevronRight className="h-4 w-4 text-muted-foreground/30 shrink-0" />
              </div>
            );
          })}
        </div>
      )}

      {/* Unified edit dialog: Stock + Seuil + Zone */}
      <Dialog open={!!editProduct} onOpenChange={(open) => !open && setEditProduct(null)}>
        <DialogContent className="max-w-[340px] rounded-2xl border border-border/40 shadow-2xl bg-card p-0 overflow-hidden gap-0">
          <DialogHeader className="sr-only">
            <DialogTitle className="uppercase">{editProduct?.nom_produit}</DialogTitle>
          </DialogHeader>

          {/* Product name */}
          <div className="px-5 pt-5 pb-3">
            <p className="text-[15px] font-semibold text-foreground leading-snug break-words">
              {editProduct ? displayProductName(editProduct.nom_produit) : ""}
            </p>
          </div>

          <Separator className="bg-border/20" />

          {/* Fields */}
          <div className="px-5 py-4 space-y-5">
            {/* Stock */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-[0.12em]">
                Stock actuel
              </label>

              {editUnitInfo?.mode === "multi_level" ? (
                /* Multi-level: one input per chain unit */
                <div className="space-y-2">
                  {editUnitInfo.chainUnits.map((cu, idx) => (
                    <div key={cu.id} className="flex items-center gap-2">
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={multiLevelInputs[idx] ?? ""}
                        onChange={(e) => {
                          setMultiLevelInputs((prev) => {
                            const next = [...prev];
                            next[idx] = e.target.value;
                            return next;
                          });
                        }}
                        placeholder="0"
                        className="flex-1 h-11 rounded-lg border-border/30 bg-muted/15 text-center text-base font-semibold tabular-nums focus-visible:ring-primary/20 focus-visible:border-primary/40"
                        autoFocus={idx === 0}
                      />
                      <span className="text-[11px] font-medium text-muted-foreground/60 min-w-[50px] text-center">
                        {displayUnitName({ name: cu.name, abbreviation: cu.abbreviation })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                /* Single unit: one input */
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={stockInput}
                    onChange={(e) => setStockInput(e.target.value)}
                    placeholder="0"
                    className="flex-1 h-11 rounded-lg border-border/30 bg-muted/15 text-center text-base font-semibold tabular-nums focus-visible:ring-primary/20 focus-visible:border-primary/40"
                    autoFocus
                  />
                  <span className="text-[11px] font-medium text-muted-foreground/60 min-w-[36px] text-center">
                    {editProduct && getUnitLabel(editProduct)}
                  </span>
                </div>
              )}
            </div>

            {/* Seuil */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-[0.12em] flex items-center gap-1">
                <Gauge className="h-2.5 w-2.5" />
                Seuil d'alerte
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  value={seuilInput}
                  onChange={(e) => setSeuilInput(e.target.value)}
                  placeholder="—"
                  className="flex-1 h-11 rounded-lg border-border/30 bg-muted/15 text-center text-base font-semibold tabular-nums focus-visible:ring-primary/20 focus-visible:border-primary/40"
                />
                <span className="text-[11px] font-medium text-muted-foreground/60 min-w-[36px] text-center">
                  {editProduct && getUnitLabel(editProduct)}
                </span>
              </div>
            </div>

            {/* Zone */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-[0.12em] flex items-center gap-1">
                <MapPin className="h-2.5 w-2.5" />
                Zone de stockage
              </label>
              <Select value={zoneInput} onValueChange={setZoneInput}>
                <SelectTrigger className="h-11 rounded-lg border-border/30 bg-muted/15 text-[13px]">
                  <SelectValue placeholder="Aucune zone" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {storageZones.map((z) => (
                    <SelectItem key={z.id} value={z.id} className="rounded-lg text-[13px]">
                      {z.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* À commander — only if product has a supplier AND establishment is fournisseur */}
            {isFournisseur && editProduct?.supplier_id && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-[0.12em] flex items-center gap-1">
                  <ShoppingCart className="h-2.5 w-2.5" />
                  À commander
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={orderQtyInput}
                    onChange={(e) => setOrderQtyInput(e.target.value)}
                    placeholder="—"
                    className="flex-1 h-11 rounded-lg border-border/30 bg-muted/15 text-center text-base font-semibold tabular-nums focus-visible:ring-primary/20 focus-visible:border-primary/40"
                  />
                  {orderEntryUnits.length > 1 ? (
                    <Select value={orderUnitInput} onValueChange={setOrderUnitInput}>
                      <SelectTrigger className="w-[80px] h-11 rounded-lg text-[11px] font-medium border-border/30">
                        <SelectValue placeholder={orderEntryUnits[0]?.abbreviation ?? "—"} />
                      </SelectTrigger>
                      <SelectContent>
                        {orderEntryUnits.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {displayUnitName({ name: u.name, abbreviation: u.abbreviation })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-[11px] font-medium text-muted-foreground/60 min-w-[36px] text-center">
                      {orderEntryUnits[0] ? displayUnitName({ name: orderEntryUnits[0].name, abbreviation: orderEntryUnits[0].abbreviation }) : ""}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="px-5 pb-5 flex gap-2">
            <Button
              variant="ghost"
              className="flex-1 h-10 rounded-lg text-muted-foreground text-[13px]"
              onClick={() => setEditProduct(null)}
            >
              Annuler
            </Button>
            <Button
              className="flex-[1.5] h-10 rounded-lg font-semibold text-[13px]"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enregistrer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

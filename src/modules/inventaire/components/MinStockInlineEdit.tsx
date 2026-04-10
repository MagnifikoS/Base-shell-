/**
 * MinStockInlineEdit — Click to open a popup dialog for editing min stock threshold.
 *
 * SSOT: writes via useMinStockSave → updateProductV2 (same path as Wizard).
 * Popup includes numeric input + unit selector (same units as Wizard step 6).
 */

import { useCallback, useMemo, useState } from "react";
import { Pencil, Loader2 } from "lucide-react";
import { useMinStockSave } from "@/modules/produitsV2";
import type { DesktopProductStock } from "../hooks/useDesktopStock";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import {
  resolveProductUnitContext,
  type ProductUnitInput,
} from "@/core/unitConversion/resolveProductUnitContext";
import { formatQtyDisplay } from "./inventoryDisplayUtils";
import { displayUnitName } from "@/lib/units/displayUnitName";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MinStockInlineEditProps {
  product: DesktopProductStock;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
}

export function MinStockInlineEdit({
  product,
  dbUnits,
  dbConversions,
}: MinStockInlineEditProps) {
  const { saveMinStock, clearMinStock, isSaving } = useMinStockSave();
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState("");

  // Resolve display unit + allowed units
  const { displayQty, displayUnitLabel, allowedUnits, currentUnitId } = useMemo(() => {
    const canonical = product.min_stock_quantity_canonical;
    const minUnitId = product.min_stock_unit_id;

    const productForGraph: ProductUnitInput = {
      stock_handling_unit_id: product.stock_handling_unit_id,
      final_unit_id: product.final_unit_id,
      delivery_unit_id: product.delivery_unit_id,
      supplier_billing_unit_id: product.supplier_billing_unit_id,
      conditionnement_config: product.conditionnement_config,
    };

    const ctx = resolveProductUnitContext(productForGraph, dbUnits, dbConversions);

    if (ctx.needsConfiguration || !ctx.canonicalInventoryUnitId) {
      return { displayQty: null, displayUnitLabel: null, allowedUnits: [], currentUnitId: null };
    }

    const allowed = ctx.allowedInventoryEntryUnits;
    const savedUnit = minUnitId
      ? allowed.find((u) => u.id === minUnitId)
      : null;
    const unit = savedUnit ?? allowed[0];
    if (!unit) return { displayQty: null, displayUnitLabel: null, allowedUnits: allowed, currentUnitId: null };

    const unitObj = dbUnits.find((u) => u.id === unit.id);
    const unitLabel = unitObj ? displayUnitName(unitObj) : "?";

    if (canonical == null) {
      return { displayQty: null, displayUnitLabel: unitLabel, allowedUnits: allowed, currentUnitId: unit.id };
    }

    const qty = Math.round((canonical / unit.factorToTarget) * 10000) / 10000;
    return { displayQty: qty, displayUnitLabel: unitLabel, allowedUnits: allowed, currentUnitId: unit.id };
  }, [product, dbUnits, dbConversions]);

  const openDialog = useCallback(() => {
    if (allowedUnits.length === 0 || isSaving) return;
    setInputValue(displayQty != null ? String(displayQty) : "");
    setSelectedUnitId(currentUnitId ?? allowedUnits[0]?.id ?? "");
    setOpen(true);
  }, [allowedUnits, isSaving, displayQty, currentUnitId]);

  const handleSave = useCallback(async () => {
    const trimmed = inputValue.trim();
    const numVal = trimmed === "" ? 0 : parseFloat(trimmed);

    if (isNaN(numVal) || numVal < 0) {
      setOpen(false);
      return;
    }

    const unit = allowedUnits.find((u) => u.id === selectedUnitId);
    if (!unit) {
      setOpen(false);
      return;
    }

    try {
      if (numVal === 0) {
        await clearMinStock(product.product_id);
      } else {
        await saveMinStock(
          product.product_id,
          numVal,
          unit.factorToTarget,
          unit.id
        );
      }
    } catch {
      // useMinStockSave shows toast on error
    }

    setOpen(false);
  }, [inputValue, selectedUnitId, allowedUnits, product.product_id, saveMinStock, clearMinStock]);

  // Unit labels for selector
  const unitLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const u of allowedUnits) {
      const unitObj = dbUnits.find((du) => du.id === u.id);
      map[u.id] = unitObj ? displayUnitName(unitObj) : u.id;
    }
    return map;
  }, [allowedUnits, dbUnits]);

  // No allowed units → show nothing
  if (allowedUnits.length === 0) return null;

  return (
    <>
      {/* Display mode (clickable to open popup) */}
      <span
        className="text-[10px] text-muted-foreground/60 inline-flex items-center gap-1 cursor-pointer group/minedit hover:text-foreground transition-colors"
        style={{ fontVariantNumeric: "tabular-nums" }}
        onClick={(e) => {
          e.stopPropagation();
          openDialog();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") openDialog(); }}
      >
        {isSaving ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Enregistrement…</span>
          </span>
        ) : (
          <>
            <span>
              Seuil :{" "}
              {displayQty != null ? (
                <>
                  {formatQtyDisplay(displayQty)} {displayUnitLabel}
                </>
              ) : (
                "—"
              )}
            </span>
            <Pencil className="h-3 w-3 opacity-0 group-hover/minedit:opacity-100 transition-opacity" />
          </>
        )}
      </span>

      {/* Popup dialog */}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-xs" onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">Seuil minimum</AlertDialogTitle>
            <AlertDialogDescription className="text-xs truncate uppercase">
              {product.nom_produit}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex items-center gap-2 py-2">
            <Input
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              value={inputValue}
              onChange={(e) => {
                const v = e.target.value.replace(",", ".");
                if (v === "" || /^\d*\.?\d*$/.test(v)) setInputValue(v);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
              placeholder="0"
              className="w-24 text-center text-lg font-semibold tabular-nums tracking-wide border-0 border-b-2 border-muted-foreground/30 rounded-none bg-transparent focus-visible:ring-0 focus-visible:border-primary transition-colors"
              autoFocus
            />
            {allowedUnits.length === 1 ? (
              <span className="text-sm text-muted-foreground">
                {unitLabels[allowedUnits[0].id]}
              </span>
            ) : (
              <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {unitLabels[u.id]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <Button onClick={handleSave} disabled={isSaving} size="sm">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Enregistrer
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MIN STOCK EDITOR — Saisie stock minimum sur fiche produit
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PHASE 1 FIX: All writes go through useMinStockSave → updateProductV2.
 * No direct .from("products_v2").update() allowed.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Check, Package } from "lucide-react";
import { toast } from "sonner";
import { resolveProductUnitContext, type ProductUnitContext } from "@/core/unitConversion";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import type { ProductV2 } from "../types";
import { useMinStockSave } from "../hooks/useMinStockSave";

interface MinStockEditorProps {
  product: ProductV2;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
}

export function MinStockEditor({ product, dbUnits, dbConversions }: MinStockEditorProps) {
  const { saveMinStock, clearMinStock, isSaving } = useMinStockSave();

  const context: ProductUnitContext = useMemo(
    () => resolveProductUnitContext(product, dbUnits, dbConversions),
    [product, dbUnits, dbConversions]
  );

  const [inputQty, setInputQty] = useState<string>("");
  const [inputUnitId, setInputUnitId] = useState<string>("");

  // Initialize from existing min_stock (reverse-convert from canonical)
  useEffect(() => {
    const canonical = product.min_stock_quantity_canonical;
    if (canonical == null || !context.canonicalInventoryUnitId) {
      setInputQty("");
      setInputUnitId(context.allowedInventoryEntryUnits[0]?.id ?? "");
      return;
    }

    const firstUnit = context.allowedInventoryEntryUnits[0];
    if (firstUnit) {
      const displayQty = canonical / firstUnit.factorToTarget;
      setInputQty(String(Math.round(displayQty * 10000) / 10000));
      setInputUnitId(firstUnit.id);
    }
  }, [product, context]);

  if (context.needsConfiguration) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Stock minimum
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-400" />
            Configuration conditionnement requise avant de définir un stock minimum.
          </div>
        </CardContent>
      </Card>
    );
  }

  const selectedUnit = context.allowedInventoryEntryUnits.find((u) => u.id === inputUnitId);

  const handleSave = async () => {
    if (!product.id) return;

    const qty = parseFloat(inputQty);
    if (isNaN(qty) || qty < 0) {
      toast.error("Quantité invalide.");
      return;
    }

    if (!selectedUnit) {
      toast.error("Unité invalide.");
      return;
    }

    await saveMinStock(
      product.id,
      qty,
      selectedUnit.factorToTarget,
      context.canonicalInventoryUnitId
    );
  };

  const handleClear = async () => {
    if (!product.id) return;
    await clearMinStock(product.id);
    setInputQty("");
  };

  const hasExisting = product.min_stock_quantity_canonical != null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Package className="h-4 w-4" />
          Stock minimum
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="min_stock_qty">Quantité seuil</Label>
            <Input
              id="min_stock_qty"
              type="number"
              step="any"
              min="0"
              value={inputQty}
              onChange={(e) => setInputQty(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="w-40 space-y-1">
            <Label>Unité</Label>
            <Select value={inputUnitId} onValueChange={setInputUnitId}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent className="bg-background z-50">
                {context.allowedInventoryEntryUnits.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSave} disabled={isSaving} size="sm" className="h-10">
            <Check className="h-4 w-4 mr-1" />
            {isSaving ? "..." : "Valider"}
          </Button>
        </div>

        {/* Show canonical info */}
        {inputQty && selectedUnit && !isNaN(parseFloat(inputQty)) && (
          <p className="text-xs text-muted-foreground">
            = {Math.round(parseFloat(inputQty) * selectedUnit.factorToTarget * 10000) / 10000}{" "}
            {context.canonicalLabel ?? "canonical"}
          </p>
        )}

        {hasExisting && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-destructive"
            onClick={handleClear}
            disabled={isSaving}
          >
            Supprimer le stock minimum
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * MinStockEditForm — Inline edit form for min stock threshold.
 * Shared between product detail page and inventory table popover.
 */
import { useState } from "react";
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
import { AlertTriangle, X, Save } from "lucide-react";
import type { ProductUnitContext } from "@/core/unitConversion";
import { useMinStockSave } from "../hooks/useMinStockSave";

interface MinStockEditFormProps {
  productId: string;
  context: ProductUnitContext;
  initialQty?: string;
  initialUnitId?: string;
  onDone: () => void;
}

export function MinStockEditForm({
  productId,
  context,
  initialQty = "",
  initialUnitId = "",
  onDone,
}: MinStockEditFormProps) {
  const [inputQty, setInputQty] = useState(initialQty);
  const [inputUnitId, setInputUnitId] = useState(
    initialUnitId || context.allowedInventoryEntryUnits[0]?.id || ""
  );
  const { saveMinStock, isSaving } = useMinStockSave();

  if (context.needsConfiguration) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-400 shrink-0" />
        Configuration conditionnement requise avant de définir un stock minimum.
      </div>
    );
  }

  const selectedUnit = context.allowedInventoryEntryUnits.find((u) => u.id === inputUnitId);

  const handleSave = async () => {
    const qty = parseFloat(inputQty);
    if (isNaN(qty) || qty < 0) return;
    if (!selectedUnit) return;

    await saveMinStock(
      productId,
      qty,
      selectedUnit.factorToTarget,
      context.canonicalInventoryUnitId
    );
    onDone();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="min_stock_qty" className="text-xs">
            Quantité seuil
          </Label>
          <Input
            id="min_stock_qty"
            type="number"
            step="any"
            min="0"
            value={inputQty}
            onChange={(e) => setInputQty(e.target.value)}
            placeholder="0"
            className="h-9"
            autoFocus
          />
        </div>
        <div className="w-36 space-y-1">
          <Label className="text-xs">Unité</Label>
          <Select value={inputUnitId} onValueChange={setInputUnitId}>
            <SelectTrigger className="h-9">
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
      </div>

      {/* Canonical preview */}
      {inputQty && selectedUnit && !isNaN(parseFloat(inputQty)) && (
        <p className="text-xs text-muted-foreground">
          = {Math.round(parseFloat(inputQty) * selectedUnit.factorToTarget * 10000) / 10000}{" "}
          {context.canonicalLabel ?? "canonical"}
        </p>
      )}

      <div className="flex items-center gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onDone} disabled={isSaving}>
          <X className="h-3.5 w-3.5 mr-1" />
          Annuler
        </Button>
        <Button size="sm" onClick={handleSave} disabled={isSaving || !inputQty}>
          <Save className="h-3.5 w-3.5 mr-1" />
          {isSaving ? "..." : "Enregistrer"}
        </Button>
      </div>
    </div>
  );
}

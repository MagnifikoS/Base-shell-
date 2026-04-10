/**
 * Dialog for initializing stock of a product created after the last inventory.
 * User picks a unit from the product's conditioning tree, enters qty,
 * and we convert to canonical before calling the RPC.
 */

import { useState, useEffect, useMemo } from "react";
import { Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReachableUnit } from "@/core/unitConversion/resolveProductUnitContext";

interface InitializeStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string;
  /** Allowed units from resolveProductUnitContext (conditioning-aware) */
  allowedUnits: ReachableUnit[];
  /** Fallback label when no units available */
  unitLabel?: string;
  isLoading: boolean;
  /** Called with the quantity already converted to canonical */
  onConfirm: (canonicalQuantity: number) => void;
}

export function InitializeStockDialog({
  open,
  onOpenChange,
  productName,
  allowedUnits,
  unitLabel = "unité",
  isLoading,
  onConfirm,
}: InitializeStockDialogProps) {
  const [qty, setQty] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setQty("");
      // Default to first unit (usually canonical / target)
      setSelectedUnitId(allowedUnits[0]?.id ?? "");
    }
  }, [open, allowedUnits]);

  const selectedUnit = useMemo(
    () => allowedUnits.find((u) => u.id === selectedUnitId),
    [allowedUnits, selectedUnitId]
  );

  const parsedQty = parseFloat(qty);
  const isValid = qty !== "" && !isNaN(parsedQty) && parsedQty >= 0;

  const handleConfirm = () => {
    if (!isValid || !selectedUnit) return;
    // Convert to canonical using factorToTarget
    const canonicalQty = Math.round(parsedQty * selectedUnit.factorToTarget * 10000) / 10000;
    onConfirm(canonicalQty);
  };

  const hasMultipleUnits = allowedUnits.length > 1;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isLoading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Initialiser le stock
          </DialogTitle>
          <DialogDescription>
            <span className="font-semibold uppercase">{productName}</span> a été créé après
            le dernier inventaire. Saisissez le stock actuel pour commencer le suivi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="init-qty">Stock actuel</Label>
            <div className="flex items-center gap-2">
              <Input
                id="init-qty"
                type="text"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0"
                value={qty}
                onChange={(e) => {
                  const val = e.target.value.replace(",", ".");
                  if (val === "" || /^-?\d*\.?\d*$/.test(val)) setQty(val);
                }}
                className="font-mono flex-1"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && isValid) handleConfirm(); }}
              />
              {hasMultipleUnits ? (
                <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Unité" />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedUnits.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name || u.abbreviation}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  {selectedUnit?.name ?? selectedUnit?.abbreviation ?? unitLabel}
                </span>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Annuler
          </Button>
          <Button onClick={handleConfirm} disabled={!isValid || isLoading}>
            {isLoading ? "Initialisation…" : "Initialiser"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

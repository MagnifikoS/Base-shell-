/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE — Multi-Unit Entry Popover (Graph-driven, UUID-only)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Reusable popover for entering inventory quantities in multiple units.
 * Converts all entries to canonical total via BFS graph engine.
 *
 * Used by: Desktop table (clickable unit) + Product Drawer.
 *
 * RULES:
 * - Options = graph-reachable units only (0 hardcode)
 * - Saves 1 canonical line (unit_id + quantity)
 * - No text storage, no DB schema change
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo, useCallback, useEffect, type FocusEvent } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, AlertTriangle, Check } from "lucide-react";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import {
  resolveProductUnitContext,
  type ProductUnitInput,
  type ReachableUnit,
} from "@/core/unitConversion/resolveProductUnitContext";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface EntryLine {
  id: string;
  unitId: string;
  quantity: string;
}

interface MultiUnitEntryPopoverProps {
  /** Product data for graph building */
  product: ProductUnitInput;
  /** All DB units */
  dbUnits: UnitWithFamily[];
  /** All DB conversions */
  dbConversions: ConversionRule[];
  /** Current canonical quantity (to prefill) */
  currentQuantity: number | null;
  /** Current canonical unit_id */
  currentUnitId: string | null;
  /** Called with canonical result on confirm */
  onConfirm: (quantity: number, unitId: string) => void;
  /** Trigger element */
  children: React.ReactNode;
  /** Control open state externally */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Side of popover */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

const MAX_ENTRY_QUANTITY = 99999;

let _popoverEntryId = 0;
function nextId() {
  return `pu-${++_popoverEntryId}`;
}

/**
 * Compute a breakdown of `canonicalTotal` into the chosen `primaryUnitId`.
 * Returns 1 entry line. If the division isn't exact and a finer unit exists,
 * returns 2 lines (greedy). Guarantees sum * factor == canonicalTotal.
 */
function computeBreakdown(
  canonicalTotal: number,
  primaryUnitId: string,
  options: ReachableUnit[]
): EntryLine[] {
  if (canonicalTotal === 0 || options.length === 0) {
    return [{ id: nextId(), unitId: primaryUnitId, quantity: "0" }];
  }

  const primary = options.find((o) => o.id === primaryUnitId);
  if (!primary || primary.factorToTarget === 0) {
    return [{ id: nextId(), unitId: primaryUnitId, quantity: canonicalTotal.toString() }];
  }

  // B2 guard: packaging/delivery must produce integer quantities
  // P0-FIX: Continuous units keep full precision
  const isPackagingPrimary = primary.kind === "packaging" || primary.kind === "delivery" || primary.kind === "billing" || primary.kind === "equivalence";
  const rawQty1 = canonicalTotal / primary.factorToTarget;
  const qty1 = isPackagingPrimary ? Math.floor(rawQty1) : Math.round(rawQty1 * 10000) / 10000;
  const remainder = Math.round((canonicalTotal - qty1 * primary.factorToTarget) * 10000) / 10000;

  if (remainder <= 0) {
    return [{ id: nextId(), unitId: primaryUnitId, quantity: qty1.toString() }];
  }

  // Find a finer unit for the remainder (smallest factor > 0, != primary)
  const finerUnits = options
    .filter(
      (o) =>
        o.id !== primaryUnitId && o.factorToTarget > 0 && o.factorToTarget < primary.factorToTarget
    )
    .sort((a, b) => a.factorToTarget - b.factorToTarget);

  for (const finer of finerUnits) {
    const isPackagingFiner = finer.kind === "packaging" || finer.kind === "delivery";
    const qty2Raw = remainder / finer.factorToTarget;
    // For packaging, only accept integer breakdown
    const qty2 = isPackagingFiner ? Math.floor(qty2Raw) : Math.round(qty2Raw * 10000) / 10000;
    const check =
      Math.round((qty1 * primary.factorToTarget + qty2 * finer.factorToTarget) * 10000) / 10000;

    if (Math.abs(check - canonicalTotal) < 0.001) {
      return [
        { id: nextId(), unitId: primaryUnitId, quantity: qty1.toString() },
        { id: nextId(), unitId: finer.id, quantity: qty2.toString() },
      ];
    }

    // If finer is packaging and didn't produce exact match, try with remainder going to canonical
    if (isPackagingFiner && qty2 > 0) {
      const usedByFiner = qty2 * finer.factorToTarget;
      const finalRemainder = Math.round((remainder - usedByFiner) * 10000) / 10000;
      if (finalRemainder > 0) {
        const target = options.find((o) => o.factorToTarget === 1);
        if (target) {
          const checkAll =
            Math.round((qty1 * primary.factorToTarget + usedByFiner + finalRemainder) * 10000) /
            10000;
          if (Math.abs(checkAll - canonicalTotal) < 0.001) {
            // 3-line breakdown: primary + finer packaging + canonical remainder
            return [
              { id: nextId(), unitId: primaryUnitId, quantity: qty1.toString() },
              { id: nextId(), unitId: finer.id, quantity: qty2.toString() },
            ];
          }
        }
      }
    }
  }

  // Fallback: express entirely in canonical target unit (factor=1)
  const target = options.find((o) => o.factorToTarget === 1);
  if (target && target.id !== primaryUnitId) {
    return [{ id: nextId(), unitId: target.id, quantity: canonicalTotal.toString() }];
  }

  // Ultimate fallback: if primary is packaging, refuse fractional — show in canonical
  if (isPackagingPrimary) {
    if (import.meta.env.DEV)
      console.warn(
        "[computeBreakdown] Cannot express",
        canonicalTotal,
        "as integer packaging. Falling back to canonical."
      );
    const canonicalUnit = options.find((o) => o.factorToTarget === 1);
    if (canonicalUnit) {
      return [{ id: nextId(), unitId: canonicalUnit.id, quantity: canonicalTotal.toString() }];
    }
  }

  // Non-packaging: allow fractional
  const fractionalQty = Math.round((canonicalTotal / primary.factorToTarget) * 10000) / 10000;
  return [{ id: nextId(), unitId: primaryUnitId, quantity: fractionalQty.toString() }];
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function MultiUnitEntryPopover({
  product,
  dbUnits,
  dbConversions,
  currentQuantity,
  currentUnitId,
  onConfirm,
  children,
  open: controlledOpen,
  onOpenChange,
  side = "bottom",
  align = "start",
}: MultiUnitEntryPopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen ?? internalOpen;
  const setIsOpen = onOpenChange ?? setInternalOpen;

  const [entries, setEntries] = useState<EntryLine[]>([]);

  // ── Graph-driven options via SSOT service ──
  const unitContext = useMemo(
    () => resolveProductUnitContext(product, dbUnits, dbConversions),
    [product, dbUnits, dbConversions]
  );

  const targetUnitId = unitContext.canonicalInventoryUnitId;
  const availableOptions = unitContext.allowedInventoryEntryUnits;

  // ── Init entries when popover opens — uses breakdown suggestion ──
  useEffect(() => {
    if (!isOpen || !targetUnitId) return;

    const canonicalTotal = currentQuantity ?? 0;
    const initUnitId =
      currentUnitId && availableOptions.some((o) => o.id === currentUnitId)
        ? currentUnitId
        : targetUnitId;

    // Build suggested breakdown preserving canonical total
    const breakdown = computeBreakdown(canonicalTotal, initUnitId, availableOptions);
    setEntries(breakdown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, targetUnitId]);

  // ── Computed canonical total ──
  const computedTotal = useMemo(() => {
    if (!targetUnitId || entries.length === 0) return null;

    let total = 0;
    let hasAny = false;
    for (const entry of entries) {
      const qty = parseFloat(entry.quantity);
      if (isNaN(qty) || qty < 0) continue;
      const option = availableOptions.find((o) => o.id === entry.unitId);
      if (!option) continue;
      total += qty * option.factorToTarget;
      hasAny = true;
    }

    return hasAny ? total : null;
  }, [entries, targetUnitId, availableOptions]);

  const targetAbbr = availableOptions.find((o) => o.id === targetUnitId)?.abbreviation ?? "";

  // ── Handlers ──
  const updateEntry = useCallback(
    (id: string, field: "unitId" | "quantity", value: string) => {
      if (field === "quantity") {
        setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, quantity: value } : e)));
      } else {
        // Unit changed — recalculate quantity to preserve canonical total
        setEntries((prev) => {
          // Calculate current canonical total from ALL entries
          let currentCanonical = 0;
          for (const entry of prev) {
            const qty = parseFloat(entry.quantity);
            if (isNaN(qty) || qty < 0) continue;
            const opt = availableOptions.find((o) => o.id === entry.unitId);
            if (opt) currentCanonical += qty * opt.factorToTarget;
          }

          // If this is the only entry, recompute breakdown for new unit
          if (prev.length === 1) {
            return computeBreakdown(
              Math.round(currentCanonical * 10000) / 10000,
              value, // new unitId
              availableOptions
            );
          }

          // Fix C: Multi-entry — always recompute full breakdown from canonical total
          // (instead of proportional conversion which can produce fractional packaging)
          return computeBreakdown(
            Math.round(currentCanonical * 10000) / 10000,
            value, // new primary unitId
            availableOptions
          );
        });
      }
    },
    [availableOptions]
  );

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // HARDENING: Clamp quantity on blur to [0, MAX_ENTRY_QUANTITY]
  const handleBlur = useCallback((id: string, e: FocusEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (isNaN(val) || val < 0) {
      setEntries((prev) =>
        prev.map((entry) => (entry.id === id ? { ...entry, quantity: "0" } : entry))
      );
    } else if (val > MAX_ENTRY_QUANTITY) {
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === id ? { ...entry, quantity: MAX_ENTRY_QUANTITY.toString() } : entry
        )
      );
    }
  }, []);

  const handleConfirm = () => {
    if (computedTotal === null || computedTotal < 0 || !targetUnitId) return;
    const rounded = Math.round(computedTotal * 10000) / 10000;
    onConfirm(rounded, targetUnitId);
    setIsOpen(false);
  };

  // ── Needs configuration ──
  if (unitContext.needsConfiguration) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent side={side} align={align} className="w-72 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              Produit non configuré — passez par le Wizard.
            </p>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-80 p-3 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Saisir en…
        </p>

        {/* Entry lines */}
        {entries.map((entry) => {
          const entryOpt = availableOptions.find((o) => o.id === entry.unitId);
          const isPackaging = entryOpt?.kind === "packaging" || entryOpt?.kind === "delivery" || entryOpt?.kind === "billing" || entryOpt?.kind === "equivalence";
          // Anti-doublon: exclude units already used in OTHER entries
          const usedUnitIds = new Set(entries.filter((e) => e.id !== entry.id).map((e) => e.unitId));

          return (
            <div key={entry.id} className="flex items-center gap-1.5">
              <Input
                type="number"
                inputMode={isPackaging ? "numeric" : "decimal"}
                min="0"
                max={MAX_ENTRY_QUANTITY}
                step={isPackaging ? "1" : "any"}
                value={entry.quantity}
                onChange={(e) => {
                  let val = e.target.value;
                  if (isPackaging && val !== "") {
                    // Force integer for packaging
                    const parsed = Math.floor(Math.abs(parseFloat(val)));
                    if (!isNaN(parsed)) val = parsed.toString();
                  }
                  updateEntry(entry.id, "quantity", val);
                }}
                onKeyDown={isPackaging ? (e) => { if (e.key === "." || e.key === ",") e.preventDefault(); } : undefined}
                onBlur={(e) => handleBlur(entry.id, e)}
                className="h-9 text-sm font-mono flex-1"
                placeholder="0"
                autoFocus
                aria-label="Quantité"
              />
              <Select value={entry.unitId} onValueChange={(v) => updateEntry(entry.id, "unitId", v)}>
                <SelectTrigger className="w-[100px] h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableOptions
                    .filter((opt) => opt.id === entry.unitId || !usedUnitIds.has(opt.id))
                    .map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.abbreviation}
                        {opt.kind === "target" ? " ★" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {entries.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-8 shrink-0"
                  onClick={() => removeEntry(entry.id)}
                  aria-label="Supprimer l'entrée"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
            </div>
          );
        })}

        {/* Quick-add chips for unused units */}
        {availableOptions.length > entries.length && (
          <div className="flex flex-wrap gap-1">
            {availableOptions
              .filter((o) => !entries.some((e) => e.unitId === o.id))
              .map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() =>
                    setEntries((prev) => [...prev, { id: nextId(), unitId: opt.id, quantity: "" }])
                  }
                  className="px-2 py-0.5 rounded-full text-xs font-medium border bg-muted text-muted-foreground border-border hover:border-primary/50 transition-colors"
                >
                  + {opt.abbreviation}
                </button>
              ))}
          </div>
        )}

        {/* Total */}
        {computedTotal !== null && computedTotal > 0 && (
          <div className="rounded-md border bg-muted/40 p-2 text-center">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-base font-bold font-mono">
              {Math.round(computedTotal * 10000) / 10000}{" "}
              <span className="text-xs font-normal text-muted-foreground">{targetAbbr}</span>
            </p>
            {entries.length > 1 && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {entries
                  .filter((e) => e.quantity && parseFloat(e.quantity) > 0)
                  .map((e) => {
                    const opt = availableOptions.find((o) => o.id === e.unitId);
                    return `${e.quantity} ${opt?.abbreviation ?? "?"}`;
                  })
                  .join(" + ")}
              </p>
            )}
          </div>
        )}

        {/* Confirm */}
        <Button
          size="sm"
          className="w-full"
          onClick={handleConfirm}
          disabled={computedTotal === null || computedTotal < 0}
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          Valider
        </Button>
      </PopoverContent>
    </Popover>
  );
}

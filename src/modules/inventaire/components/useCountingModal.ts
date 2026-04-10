/**
 * useCountingModal — Extracted state, memos, effects, and handlers
 * from CountingModal.tsx for file size compliance.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PHASE 2 SSOT: Uses resolveInputUnitForContext("internal") as sole resolver.
 * No more resolveProductUnitContext, usePreferredUnits, or buildOrderedFields.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Contains: navigation logic, field management, confirm/save flow,
 * auto-advance behavior.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import type { InventoryLineWithProduct } from "../types";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import {
  resolveInputUnitForContext,
  type InputResolutionResult,
  type ProductInputConfigRow,
} from "@/modules/inputConfig";
import type { ProductForResolution } from "@/modules/inputConfig";
import { resolveInputConversion } from "@/modules/stockLedger/utils/resolveInputConversion";
import type { Json } from "@/integrations/supabase/types";

import {
  MAX_QUANTITY,
  findNextUncountedLineId,
  findFirstUncountedLineId,
  getCountedLineIds,
  getPrevLineId,
  getNextLineId,
  type UnitField,
} from "./countingModalHelpers";

interface UseCountingModalParams {
  open: boolean;
  onClose: () => void;
  lines: InventoryLineWithProduct[];
  linesLoading: boolean;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
  mode: "comptage" | "correction";
  /** Product input configs map (SSOT) */
  inputConfigs: Map<string, ProductInputConfigRow>;
  onCount: (lineId: string, quantity: number, unitId: string | null) => Promise<void>;
  onUpdate: (lineId: string, quantity: number, unitId: string | null) => Promise<void>;
  onAllCounted?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS: Map SSOT resolver result → UnitField[]
// ─────────────────────────────────────────────────────────────────────────────

function buildFieldsFromResolved(
  resolved: InputResolutionResult,
  existingQuantity: number | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[],
  conditionnementConfig: unknown,
): UnitField[] {
  if (resolved.status !== "ok") return [];

  if (resolved.mode === "multi_level") {
    // Multi-level: one field per unit in chain
    return resolved.unitChain.map((unitId, i) => {
      const reachable = resolved.reachableUnits.find((u) => u.id === unitId);
      return {
        unitId,
        quantity: "",
        abbreviation: reachable?.abbreviation ?? dbUnits.find((u) => u.id === unitId)?.abbreviation ?? "",
        name: resolved.unitNames[i],
        factorToTarget: reachable?.factorToTarget ?? 1,
        kind: reachable?.kind ?? "target",
      };
    });
  }

  // Simple mode: single field
  const reachable = resolved.reachableUnits.find((u) => u.id === resolved.unitId);
  const factor = reachable?.factorToTarget ?? 1;

  // If editing, convert canonical quantity to display unit
  let displayQty = "";
  if (existingQuantity != null && existingQuantity > 0) {
    if (factor === 1 || factor === 0) {
      displayQty = existingQuantity.toString();
    } else {
      // Convert canonical → display unit
      const displayValue = Math.round((existingQuantity / factor) * 10000) / 10000;
      displayQty = displayValue.toString();
    }
  }

  return [{
    unitId: resolved.unitId,
    quantity: displayQty,
    abbreviation: reachable?.abbreviation ?? dbUnits.find((u) => u.id === resolved.unitId)?.abbreviation ?? "",
    name: resolved.unitName,
    factorToTarget: factor,
    kind: reachable?.kind ?? "target",
  }];
}

// ─────────────────────────────────────────────────────────────────────────────
// Map InventoryLineWithProduct → ProductForResolution
// ─────────────────────────────────────────────────────────────────────────────

function lineToProductForResolution(line: InventoryLineWithProduct): ProductForResolution {
  return {
    id: line.product_id,
    nom_produit: line.product_name,
    final_unit_id: line.product_final_unit_id,
    stock_handling_unit_id: line.product_stock_handling_unit_id,
    delivery_unit_id: line.product_delivery_unit_id,
    supplier_billing_unit_id: line.product_supplier_billing_unit_id,
    conditionnement_config: line.product_conditionnement_config,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HOOK
// ─────────────────────────────────────────────────────────────────────────────

export function useCountingModal({
  open,
  onClose,
  lines,
  linesLoading,
  mode,
  dbUnits,
  dbConversions,
  inputConfigs,
  onCount,
  onUpdate,
  onAllCounted,
}: UseCountingModalParams) {
  const [currentLineId, setCurrentLineId] = useState<string | null>(null);
  const [fields, setFields] = useState<UnitField[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const hasInitializedRef = useRef(false);

  // ── RESOLVE current line ──

  const currentLine = useMemo(
    () => lines.find((l) => l.id === currentLineId) ?? null,
    [lines, currentLineId]
  );

  const countedCount = lines.filter((l) => l.counted_at !== null).length;
  const progress = lines.length > 0 ? (countedCount / lines.length) * 100 : 0;

  const currentPosition = useMemo(() => {
    if (!currentLineId) return 0;
    const idx = lines.findIndex((l) => l.id === currentLineId);
    return idx >= 0 ? idx + 1 : 0;
  }, [lines, currentLineId]);

  const countedLineIds = useMemo(() => getCountedLineIds(lines), [lines]);
  const correctionPos = useMemo(() => {
    if (mode !== "correction" || !currentLineId) return { current: 0, total: 0 };
    const pos = countedLineIds.indexOf(currentLineId);
    return { current: pos >= 0 ? pos : 0, total: countedLineIds.length };
  }, [mode, countedLineIds, currentLineId]);

  const isCurrentLineCounted = currentLine?.counted_at !== null;

  // ── INITIAL LINE on open / mode change ──

  useEffect(() => {
    if (!open) {
      hasInitializedRef.current = false;
      setIsReviewing(false);
    }
  }, [open, mode]);

  useEffect(() => {
    if (!open || hasInitializedRef.current) return;
    if (linesLoading) return;
    if (lines.length === 0) return;

    hasInitializedRef.current = true;

    if (mode === "comptage") {
      setIsReviewing(false);
      const nextId = findFirstUncountedLineId(lines);
      if (nextId) {
        setCurrentLineId(nextId);
      } else {
        onAllCounted?.();
      }
    } else {
      const counted = getCountedLineIds(lines);
      if (counted.length > 0) {
        setCurrentLineId(counted[0]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, linesLoading, lines.length]);

  // ── SSOT: Resolve via inputConfig ──

  const resolved = useMemo((): InputResolutionResult | null => {
    if (!currentLine) return null;
    const product = lineToProductForResolution(currentLine);
    const config = inputConfigs.get(currentLine.product_id) ?? null;
    return resolveInputUnitForContext(product, "internal", config, dbUnits, dbConversions);
  }, [currentLine, inputConfigs, dbUnits, dbConversions]);

  const isBlocked = resolved != null && resolved.status !== "ok";
  const blockedReason = resolved != null && resolved.status !== "ok" ? resolved.reason : null;

  const targetUnitId = useMemo(() => {
    if (!resolved || resolved.status !== "ok") return null;
    return resolved.canonicalUnitId;
  }, [resolved]);

  // ── SYNC FIELDS ON PRODUCT CHANGE ──

  useEffect(() => {
    if (!currentLine || !resolved) {
      setFields([]);
      return;
    }

    if (resolved.status !== "ok") {
      setFields([]);
      return;
    }

    const newFields = buildFieldsFromResolved(
      resolved,
      currentLine.quantity,
      dbUnits,
      dbConversions,
      currentLine.product_conditionnement_config,
    );
    setFields(newFields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLine?.id, resolved]);

  // ── FIELD UPDATE ──

  const updateFieldQuantity = useCallback((unitId: string, value: string) => {
    setFields((prev) => prev.map((f) => (f.unitId === unitId ? { ...f, quantity: value } : f)));
  }, []);

  // ── COMPUTED CANONICAL TOTAL ──

  const computedTotal = useMemo(() => {
    if (!targetUnitId || fields.length === 0) return null;

    let total = 0;
    for (const f of fields) {
      if (f.quantity === "" || f.quantity === undefined) continue;
      const qty = parseFloat(f.quantity);
      if (isNaN(qty) || qty < 0) return -1; // invalid marker
      total += qty * f.factorToTarget;
    }

    return total;
  }, [fields, targetUnitId]);

  const targetAbbreviation = useMemo(() => {
    if (!targetUnitId) return "";
    return dbUnits.find((u) => u.id === targetUnitId)?.abbreviation ?? "";
  }, [targetUnitId, dbUnits]);

  // ── RECAP TEXT ──

  const recapText = useMemo(() => {
    const parts = fields
      .filter((f) => f.quantity && parseFloat(f.quantity) > 0 && !isNaN(parseFloat(f.quantity)))
      .map((f) => `${f.quantity} ${f.abbreviation}`);
    if (parts.length === 0) return null;
    const joined = parts.join(" + ");
    const total = computedTotal !== null ? Math.round(computedTotal * 10000) / 10000 : null;
    if (total === null) return null;
    return { parts: joined, total, targetAbbr: targetAbbreviation };
  }, [fields, computedTotal, targetAbbreviation]);

  // ── HANDLERS ──

  const executeConfirm = async () => {
    if (computedTotal === null || computedTotal < 0 || !targetUnitId || !currentLine) return;
    if (isSaving) return;

    const canonicalQty = Math.round(computedTotal * 10000) / 10000;

    // HARDENING: Reject quantities exceeding safe range
    if (canonicalQty > MAX_QUANTITY) {
      toast.error(`Quantité trop élevée (max ${MAX_QUANTITY.toLocaleString("fr-FR")})`);
      return;
    }
    setIsSaving(true);

    try {
      if (mode === "correction" || (mode === "comptage" && isReviewing && isCurrentLineCounted)) {
        if (import.meta.env.DEV)
          // eslint-disable-next-line no-console
          console.debug("[CountingModal] Enregistrer ->", {
            mode,
            isReviewing,
            lineId: currentLine.id,
            qty: canonicalQty,
            unitId: targetUnitId,
          });
        await onUpdate(currentLine.id, canonicalQty, targetUnitId);
        toast.success("Mis à jour");

        if (mode === "comptage" && isReviewing) {
          const nextId = getNextLineId(lines, currentLine.id);
          if (nextId) {
            const nextLine = lines.find((l) => l.id === nextId);
            if (nextLine && nextLine.counted_at === null) {
              setIsReviewing(false);
            }
            setCurrentLineId(nextId);
          } else {
            const uncounted = findNextUncountedLineId(lines, currentLine.display_order);
            if (uncounted) {
              setCurrentLineId(uncounted);
              setIsReviewing(false);
            } else {
              onAllCounted?.();
            }
          }
        } else if (mode === "correction") {
          const pos = countedLineIds.indexOf(currentLine.id);
          if (pos >= 0 && pos < countedLineIds.length - 1) {
            setCurrentLineId(countedLineIds[pos + 1]);
          } else {
            onClose();
          }
        }
      } else {
        if (import.meta.env.DEV)
          // eslint-disable-next-line no-console
          console.debug("[CountingModal] Valider ->", {
            mode,
            lineId: currentLine.id,
            qty: canonicalQty,
            unitId: targetUnitId,
          });
        await onCount(currentLine.id, canonicalQty, targetUnitId);
        toast.success("Compté");

        const nextId = findNextUncountedLineId(lines, currentLine.display_order);
        if (nextId && nextId !== currentLine.id) {
          setCurrentLineId(nextId);
          setIsReviewing(false);
        } else {
          onAllCounted?.();
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("[CountingModal] Mutation error:", err);
      toast.error("Erreur lors de la sauvegarde");
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirm = () => {
    executeConfirm();
  };

  // ── NAVIGATION ──

  const handlePrev = () => {
    if (!currentLineId) return;

    if (mode === "comptage") {
      const prevId = getPrevLineId(lines, currentLineId);
      if (prevId) {
        setCurrentLineId(prevId);
        setIsReviewing(true);
      }
    } else {
      const pos = countedLineIds.indexOf(currentLineId);
      if (pos > 0) setCurrentLineId(countedLineIds[pos - 1]);
    }
  };

  const handleNext = () => {
    if (!currentLineId) return;

    if (mode === "comptage" && isReviewing) {
      const nextId = getNextLineId(lines, currentLineId);
      if (nextId) {
        const nextLine = lines.find((l) => l.id === nextId);
        if (nextLine && nextLine.counted_at === null) {
          setIsReviewing(false);
        }
        setCurrentLineId(nextId);
      }
    } else if (mode === "correction") {
      const pos = countedLineIds.indexOf(currentLineId);
      if (pos >= 0 && pos < countedLineIds.length - 1) {
        setCurrentLineId(countedLineIds[pos + 1]);
      }
    }
  };

  const handleSkip = () => {
    if (!currentLine) return;
    if (mode === "comptage") {
      const nextId = findNextUncountedLineId(lines, currentLine.display_order);
      if (nextId && nextId !== currentLine.id) {
        setCurrentLineId(nextId);
        setIsReviewing(false);
      } else {
        onAllCounted?.();
      }
    } else {
      const pos = countedLineIds.indexOf(currentLine.id);
      if (pos >= 0 && pos < countedLineIds.length - 1) {
        setCurrentLineId(countedLineIds[pos + 1]);
      }
    }
  };

  const handleResumeCount = () => {
    const nextId = findFirstUncountedLineId(lines);
    if (nextId) {
      setCurrentLineId(nextId);
      setIsReviewing(false);
    } else {
      onAllCounted?.();
    }
  };

  // ── GUARD: auto-advance if current line becomes counted in comptage ──

  useEffect(() => {
    if (!open || mode !== "comptage" || !currentLine) return;
    if (linesLoading || isReviewing) return;
    if (currentLine.counted_at !== null) {
      const nextId = findFirstUncountedLineId(lines);
      if (nextId) {
        setCurrentLineId(nextId);
      } else if (lines.length > 0) {
        onAllCounted?.();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, currentLine?.id, currentLine?.counted_at, lines, linesLoading, isReviewing]);

  // ── DERIVED STATE ──

  const isCounted = currentLine?.counted_at !== null;
  const hasValidEntries = fields.some(
    (f) => f.quantity !== "" && !isNaN(parseFloat(f.quantity)) && parseFloat(f.quantity) >= 0
  );

  const isInUpdateMode =
    mode === "correction" || (mode === "comptage" && isReviewing && (isCounted ?? false));
  const confirmLabel = isInUpdateMode ? "Enregistrer" : "Valider";
  const modeLabel = mode === "correction" ? "Correction" : isReviewing ? "Relecture" : "Comptage";

  const canGoPrev =
    mode === "comptage"
      ? getPrevLineId(lines, currentLineId!) !== null
      : countedLineIds.indexOf(currentLineId!) > 0;

  const canGoNext =
    mode === "comptage" && isReviewing
      ? getNextLineId(lines, currentLineId!) !== null
      : mode === "correction"
        ? countedLineIds.indexOf(currentLineId!) < countedLineIds.length - 1
        : false;

  return {
    // Line state
    currentLine,
    currentLineId,
    countedCount,
    progress,
    currentPosition,
    correctionPos,
    isCounted,

    // Fields
    fields,
    updateFieldQuantity,
    inputRefs,

    // SSOT resolution
    resolved,
    isBlocked,
    blockedReason,
    targetUnitId,

    // Computed
    computedTotal,
    targetAbbreviation,
    recapText,

    // Modal state
    isSaving,
    isReviewing,

    // Derived
    hasValidEntries,
    isInUpdateMode,
    confirmLabel,
    modeLabel,
    canGoPrev,
    canGoNext,

    // Handlers
    handleConfirm,
    handlePrev,
    handleNext,
    handleSkip,
    handleResumeCount,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUANTITY MODAL WITH RESOLVER — SSOT adapter (Phase 1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Passive adapter that wraps UniversalQuantityModal with the SSOT resolver
 * (resolveInputUnitForContext). Used by all desktop/order flows.
 *
 * CONTRACT:
 *   - Reads config from useProductInputConfigs (caller-provided or internal)
 *   - Resolves via resolveInputUnitForContext (SSOT)
 *   - Maps resolved → UQM props (no local ordering, no BFS exposure)
 *   - status ok → render modal
 *   - status not_configured / needs_review → blocked modal
 *   - contextType is REQUIRED — no default
 *
 * NEVER: sorts units, computes breakdowns, exposes raw BFS, adds fallbacks
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useCallback, useState } from "react";
import {
  UniversalQuantityModal,
  type QuantityEntry,
  type QuantityProduct,
  type QuantityContextType,
  type StepperConfig,
  type UnitField,
} from "./UniversalQuantityModal";
import {
  resolveInputUnitForContext,
  useProductInputConfigs,
  type InputContext,
} from "@/modules/inputConfig";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import { resolveInputConversion } from "@/modules/stockLedger/utils/resolveInputConversion";
import { computeMultiLevelInitValues } from "@/modules/commandes/utils/computeMultiLevelInitValues";
import type { Json } from "@/integrations/supabase/types";

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT MAPPING: QuantityContextType → InputContext (SSOT)
// ─────────────────────────────────────────────────────────────────────────────

function toInputContext(ct: QuantityContextType): InputContext {
  // External purchase flows (supplier reception, BL correction) use "purchase"
  // → reads purchase_* columns (always L0, independent of B2B toggle).
  if (ct === "reception") return "purchase";
  // B2B transactional flows (order, preparation, B2B reception) use "b2b_sale"
  // → reads reception_* columns (piloted by allow_unit_sale toggle).
  if (ct === "order") return "b2b_sale";
  // Internal flows (inventory, withdrawal, correction, adjustment, return)
  return "internal";
}

// ─────────────────────────────────────────────────────────────────────────────
// PROPS — contextType is REQUIRED (no default)
// ─────────────────────────────────────────────────────────────────────────────

/** Snapshot of the user's input intent — one entry per unit actually entered */
export interface InputEntrySnapshot {
  unit_id: string;
  quantity: number;
  unit_label: string;
}

export interface QuantityModalWithResolverProps {
  open: boolean;
  onClose: () => void;
  product: QuantityProduct | null;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
  /** Called with canonical quantity, unit ID, and raw input intent */
  onConfirm: (params: {
    productId: string;
    canonicalQuantity: number;
    canonicalUnitId: string;
    canonicalFamily: string;
    canonicalLabel: string | null;
    /** Snapshot of what the user actually typed (presentation only) */
    inputEntries: InputEntrySnapshot[];
  }) => Promise<void>;
  /** Existing canonical quantity (for editing existing lines) */
  existingQuantity?: number | null;
  /** Label shown in header badge */
  contextLabel?: string;
  /** Semantic context type — REQUIRED, no default */
  contextType: QuantityContextType;
  /** Current stock in canonical unit (informational) */
  currentStockCanonical?: number | null;
  /** Label for stock unit display */
  currentStockUnitLabel?: string | null;
  /** Whether stock data is still loading */
  currentStockLoading?: boolean;
}

/**
 * SSOT adapter: resolves input config → maps to UQM props.
 * 100% passive — no local unit logic.
 */
export function QuantityModalWithResolver({
  open,
  onClose,
  product,
  dbUnits,
  dbConversions,
  onConfirm,
  existingQuantity,
  contextLabel,
  contextType,
  currentStockCanonical,
  currentStockUnitLabel,
  currentStockLoading = false,
}: QuantityModalWithResolverProps) {
  const [isSaving, setIsSaving] = useState(false);
  const inputConfigs = useProductInputConfigs();

  // ── Resolve via SSOT ──
  const resolved = useMemo(() => {
    if (!product) return null;
    const config = inputConfigs.get(product.id) ?? null;
    return resolveInputUnitForContext(
      product,
      toInputContext(contextType),
      config,
      dbUnits,
      dbConversions,
    );
  }, [product, inputConfigs, contextType, dbUnits, dbConversions]);

  // ── Reverse-convert existingQuantity (canonical → display unit) ──
  const displayInitialQuantity = useMemo((): number | undefined => {
    // null/undefined → no pre-fill; 0 is a valid value
    if (existingQuantity == null || !resolved || resolved.status !== "ok" || !product) {
      return undefined;
    }

    // For multi_level, the per-level breakdown is handled separately
    if (resolved.mode === "multi_level") return undefined;

    const displayUnitId = resolved.unitId;

    // Same unit → no conversion needed
    if (displayUnitId === resolved.canonicalUnitId) {
      return existingQuantity;
    }

    // Reverse-convert: canonical ÷ factor(display→canonical)
    const conversion = resolveInputConversion(
      displayUnitId,
      resolved.canonicalUnitId,
      product.conditionnement_config as Json | null,
      dbUnits,
      dbConversions,
    );

    if (conversion.error || conversion.factor === null) {
      if (import.meta.env.DEV) {
        console.warn("[QuantityModalWithResolver] reverse-conversion failed — falling back to canonical value", {
          displayUnitId,
          canonicalUnitId: resolved.canonicalUnitId,
          error: conversion.error,
        });
      }
      // Fallback: show canonical value (imperfect but non-destructive)
      return existingQuantity;
    }

    return +(existingQuantity / conversion.factor).toFixed(4);
  }, [existingQuantity, resolved, product, dbUnits, dbConversions]);

  // ── Greedy decomposition for multi_level: canonical → per-level values ──
  const displayInitialMultiValues = useMemo((): number[] | undefined => {
    if (existingQuantity == null || existingQuantity <= 0 || !resolved || resolved.status !== "ok" || !product) {
      return undefined;
    }
    if (resolved.mode !== "multi_level") return undefined;

    return computeMultiLevelInitValues(
      existingQuantity,
      resolved.unitChain,
      resolved.unitFamilies ?? [],
      resolved.canonicalUnitId,
      product.conditionnement_config as Json | null,
      dbUnits,
      dbConversions,
    );
  }, [existingQuantity, resolved, product, dbUnits, dbConversions]);

  // ── Build stepper config from resolved result ──
  const stepperConfig = useMemo((): StepperConfig | null => {
    if (!product || !resolved) return null;

    // BLOCKED: not configured or needs review
    if (resolved.status !== "ok") {
      return {
        productId: product.id,
        productName: product.nom_produit,
        unitId: "",
        unitName: "",
        steps: [],
        defaultStep: 1,
        blockedMessage: {
          title: resolved.status === "not_configured"
            ? "Produit non configuré"
            : "Configuration à revoir",
          description: resolved.reason,
        },
      };
    }

    // MULTI_LEVEL
    if (resolved.mode === "multi_level") {
      return {
        productId: product.id,
        productName: product.nom_produit,
        unitId: resolved.unitChain[0],
        unitName: resolved.unitNames[0],
        steps: [1],
        defaultStep: 1,
        inputMode: "multi_level",
        unitChain: resolved.unitChain,
        unitNames: resolved.unitNames,
        unitFamilies: resolved.unitFamilies,
        initialMultiValues: displayInitialMultiValues,
      };
    }

    // SIMPLE MODE (integer, fraction, continuous, decimal)
    return {
      productId: product.id,
      productName: product.nom_produit,
      unitId: resolved.unitId,
      unitName: resolved.unitName,
      steps: resolved.steps,
      defaultStep: resolved.defaultStep,
      initialQuantity: displayInitialQuantity,
      inputMode: resolved.mode,
    };
  }, [product, resolved, displayInitialQuantity]);

  // ── Handle confirm: convert raw entries → canonical ──
  const handleConfirmRaw = useCallback(
    async (entries: QuantityEntry[]) => {
      if (!product || !resolved || resolved.status !== "ok") return;

      const canonicalUnitId = resolved.canonicalUnitId;
      if (!canonicalUnitId) return;

      setIsSaving(true);
      try {
        // Use BFS conversion for each entry
        let totalCanonical = 0;
        for (const entry of entries) {
          if (entry.quantity <= 0) continue;
          if (entry.unitId === canonicalUnitId) {
            totalCanonical += entry.quantity;
            continue;
          }
          const conversion = resolveInputConversion(
            entry.unitId,
            canonicalUnitId,
            product.conditionnement_config as Json | null,
            dbUnits,
            dbConversions,
          );
          if (conversion.error || conversion.factor === null) {
            if (import.meta.env.DEV) console.error("[QuantityModalWithResolver] conversion error:", conversion.error);
            return;
          }
          totalCanonical += +(entry.quantity * conversion.factor).toFixed(4);
        }
        totalCanonical = Math.round(totalCanonical * 10000) / 10000;

        const unitInfo = dbUnits.find((u) => u.id === canonicalUnitId);

        // Build input intent snapshot from raw entries
        const inputEntries: InputEntrySnapshot[] = entries
          .filter((e) => e.quantity > 0)
          .map((e) => {
            const unit = dbUnits.find((u) => u.id === e.unitId);
            return {
              unit_id: e.unitId,
              quantity: e.quantity,
              unit_label: unit?.name ?? e.unitId,
            };
          });

        await onConfirm({
          productId: product.id,
          canonicalQuantity: totalCanonical,
          canonicalUnitId,
          canonicalFamily: unitInfo?.family ?? unitInfo?.category ?? "unknown",
          canonicalLabel: unitInfo?.name ?? null,
          inputEntries,
        });
        onClose();
      } catch (err) {
        if (import.meta.env.DEV) console.error("[QuantityModalWithResolver] error:", err);
      } finally {
        setIsSaving(false);
      }
    },
    [product, resolved, dbUnits, dbConversions, onConfirm, onClose],
  );

  return (
    <UniversalQuantityModal
      open={open}
      onClose={onClose}
      productName={product?.nom_produit ?? ""}
      productId={product?.id}
      productCategory={product?.category}
      uiMode="stepper"
      stepperConfig={stepperConfig}
      onConfirmRaw={handleConfirmRaw}
      isSaving={isSaving}
      isEditing={!!existingQuantity}
      contextLabel={contextLabel}
      contextType={contextType}
      currentStockCanonical={currentStockCanonical}
      currentStockUnitLabel={currentStockUnitLabel}
      currentStockLoading={currentStockLoading}
    />
  );
}

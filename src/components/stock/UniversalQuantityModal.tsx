/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UNIVERSAL — Quantity Entry Modal (100% UI-pure)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Context-agnostic popup for stock quantity entry.
 * Used by: Reception, Withdrawal, Return, Inventory, Correction, etc.
 *
 * INVARIANT: This component is purely passive.
 * - NO engine imports
 * - NO conversion logic
 * - NO BFS / breakdown computation
 * - NO field ordering / filtering
 * - Receives pre-computed fields, returns raw QuantityEntry[]
 *
 * Field resolution is done OUTSIDE via resolveFullModeFields.ts
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertTriangle, Loader2, PackageOpen, TrendingUp, TrendingDown, Minus, Plus } from "lucide-react";
import { displayUnitName } from "@/lib/units/displayUnitName";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MAX_QUANTITY = 99999;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface UnitField {
  unitId: string;
  quantity: string;
  abbreviation: string;
  name: string;
  factorToTarget: number;
  kind: string;
}

export interface ExtraUnitOption {
  id: string;
  name: string;
  abbreviation: string;
  factorToTarget: number;
  kind: string;
}

export interface QuantityProduct {
  id: string;
  nom_produit: string;
  stock_handling_unit_id: string | null;
  final_unit_id: string | null;
  delivery_unit_id: string | null;
  supplier_billing_unit_id: string | null;
  conditionnement_config: Record<string, unknown> | null | string | boolean | number | unknown[];
  category?: string | null;
}

/** @deprecated Use QuantityProduct instead */
export type ReceptionProduct = QuantityProduct;

export type QuantityContextType =
  | "reception"
  | "withdrawal"
  | "return"
  | "inventory"
  | "correction"
  | "adjustment"
  | "order";

// ─────────────────────────────────────────────────────────────────────────────
// PURE-MODE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type UiMode = "full" | "stepper";

/** Raw quantity entry returned by the modal — no conversion */
export interface QuantityEntry {
  unitId: string;
  quantity: number;
}

/** Configuration for stepper mode (single unit, +/- buttons, chips) */
export interface StepperConfig {
  unitId: string;
  unitName: string;
  steps: number[];
  defaultStep: number;
  productName: string;
  productId: string;
  initialQuantity?: number;
  conversionError?: string | null;
  headerLabel?: string;
  confirmLabel?: string;
  /** If set, modal shows a blocking message instead of input controls */
  blockedMessage?: { title: string; description: string } | null;
  /** Input mode — drives UI variant (stepper vs decimal pad vs multi-level). Default: stepper */
  inputMode?: "integer" | "fraction" | "continuous" | "decimal" | "multi_level";
  /** Ordered unit chain for multi_level mode */
  unitChain?: string[];
  /** Display names corresponding to unitChain */
  unitNames?: string[];
  /** Unit families corresponding to unitChain (e.g. "weight", "volume", "count") — drives integer vs decimal */
  unitFamilies?: (string | null)[];
  /** Pre-fill values for each level in multi_level mode (same order as unitChain) */
  initialMultiValues?: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// PROPS — 100% passive contract
// ─────────────────────────────────────────────────────────────────────────────

export interface UniversalQuantityModalProps {
  open: boolean;
  onClose: () => void;

  // ── Display info ──
  productName?: string;
  productId?: string;
  productCategory?: string | null;

  // ── Pre-computed fields (full mode) ──
  /** Ordered fields to display, prepared by resolveFullModeConfig */
  initialFields?: UnitField[];
  /** Extra units available via "Autre unité" sheet */
  availableExtraUnits?: ExtraUnitOption[];
  /** Canonical unit label for recap display */
  canonicalUnitLabel?: string;
  /** Whether the product needs unit configuration */
  needsConfig?: boolean;
  /** Diagnostic message to display when needsConfig is true */
  diagnosticMessage?: string | null;

  // ── Output ──
  /** Returns raw entries (unitId + quantity). Sole output of the modal. */
  onConfirmRaw: (entries: QuantityEntry[]) => void;

  // ── Context ──
  contextLabel?: string;
  contextType?: QuantityContextType;
  currentStockCanonical?: number | null;
  currentStockUnitLabel?: string | null;
  currentStockLoading?: boolean;

  // ── UI mode ──
  uiMode?: UiMode;
  stepperConfig?: StepperConfig | null;

  // ── Caller-managed state ──
  isEditing?: boolean;
  isSaving?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT LABEL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const CONTEXT_COLORS: Record<QuantityContextType, string> = {
  reception: "bg-emerald-500/10 text-emerald-600",
  withdrawal: "bg-orange-500/10 text-orange-600",
  return: "bg-blue-500/10 text-blue-600",
  inventory: "bg-violet-500/10 text-violet-600",
  correction: "bg-amber-500/10 text-amber-600",
  adjustment: "bg-amber-500/10 text-amber-600",
  order: "bg-sky-500/10 text-sky-600",
};

const CONTEXT_RECAP_LABELS: Record<QuantityContextType, string> = {
  reception: "Tu réceptionnes",
  withdrawal: "Tu retires",
  return: "Tu retournes",
  inventory: "Quantité comptée",
  correction: "Correction",
  adjustment: "Ajustement",
  order: "Quantité commandée",
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function UniversalQuantityModal({
  open,
  onClose,
  productName = "",
  productId: _productId,
  productCategory,
  initialFields,
  availableExtraUnits,
  canonicalUnitLabel = "",
  needsConfig = false,
  diagnosticMessage,
  onConfirmRaw,
  contextLabel,
  contextType = "reception",
  currentStockCanonical,
  currentStockUnitLabel,
  currentStockLoading = false,
  uiMode = "full",
  stepperConfig,
  isEditing = false,
  isSaving = false,
}: UniversalQuantityModalProps) {
  // ═══════════════════════════════════════════════════════════════════════════
  // ALL HOOKS FIRST (React rules of hooks)
  // ═══════════════════════════════════════════════════════════════════════════

  // Stepper mode state
  const [stepperQty, setStepperQty] = useState(0);
  // Decimal mode state (free-text input)
  const [decimalText, setDecimalText] = useState("");
  // Multi-level mode state
  const [multiValues, setMultiValues] = useState<number[]>([]);

  // Full mode state
  const [showOtherUnitsSheet, setShowOtherUnitsSheet] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const displayLabel = contextLabel ?? "Saisie";
  const contextColor = CONTEXT_COLORS[contextType] ?? "bg-primary/10 text-primary";
  const recapLabel = CONTEXT_RECAP_LABELS[contextType] ?? "Quantité";

  // Stepper effect
  useEffect(() => {
    if (uiMode === "stepper" && open && stepperConfig) {
      const init = stepperConfig.initialQuantity ?? stepperConfig.defaultStep;
      setStepperQty(init);
      setDecimalText(init > 0 ? String(init) : "");
      // Multi-level init: use pre-computed values if provided, otherwise zeros
      if (stepperConfig.inputMode === "multi_level" && stepperConfig.unitChain) {
        const initVals = stepperConfig.initialMultiValues;
        setMultiValues(
          stepperConfig.unitChain.map((_, i) => initVals?.[i] ?? 0)
        );
      }
    }
  }, [open, uiMode, stepperConfig]);

  // ── Field state — initialized from pre-computed initialFields ──
  const prevOpenRef = useRef(false);
  const [fields, setFields] = useState<UnitField[]>([]);

  // Synchronous field init on open transition (no useEffect delay)
  if (open && !prevOpenRef.current) {
    const newFields = initialFields ?? [];
    if (newFields.length > 0 || fields.length > 0) {
      setFields(newFields);
    }
  } else if (!open && prevOpenRef.current) {
    if (fields.length > 0) {
      setFields([]);
    }
  }
  prevOpenRef.current = open;

  // ── Anti-doublon: units already in visible fields ──
  const usedUnitIds = useMemo(
    () => new Set(fields.map((f) => f.unitId)),
    [fields],
  );

  const overflowOptions = useMemo(() => {
    return (availableExtraUnits ?? []).filter((o) => !usedUnitIds.has(o.id));
  }, [availableExtraUnits, usedUnitIds]);

  // ── Field updates ──
  const updateFieldQuantity = useCallback((unitId: string, value: string) => {
    setFields((prev) => prev.map((f) => (f.unitId === unitId ? { ...f, quantity: value } : f)));
  }, []);

  const addExtraField = useCallback((opt: ExtraUnitOption) => {
    setFields((prev) => {
      if (prev.some((f) => f.unitId === opt.id)) return prev;
      const newField: UnitField = {
        unitId: opt.id,
        quantity: "",
        abbreviation: opt.abbreviation,
        name: opt.name,
        factorToTarget: opt.factorToTarget,
        kind: opt.kind,
      };
      return [...prev, newField];
    });
    setShowOtherUnitsSheet(false);
  }, []);

  const removeField = useCallback((unitId: string) => {
    setFields((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((f) => f.unitId !== unitId);
    });
  }, []);

  // ── Display-only total (simple arithmetic on pre-provided factors) ──
  const computedTotal = useMemo(() => {
    if (fields.length === 0) return null;
    let total = 0;
    let hasAny = false;
    for (const f of fields) {
      const qty = parseFloat(f.quantity);
      if (isNaN(qty) || qty < 0) continue;
      total += qty * f.factorToTarget;
      hasAny = true;
    }
    return hasAny ? total : null;
  }, [fields]);

  const targetAbbreviation = canonicalUnitLabel;

  // ── Stock after preview (display-only) ──
  const stockAfter = useMemo(() => {
    if (currentStockCanonical == null || computedTotal == null) return null;
    const isSubtraction = contextType === "withdrawal";
    return isSubtraction
      ? currentStockCanonical - computedTotal
      : currentStockCanonical + computedTotal;
  }, [currentStockCanonical, computedTotal, contextType]);

  // ── Recap (display-only) ──
  const recapText = useMemo(() => {
    const parts = fields
      .filter((f) => f.quantity && parseFloat(f.quantity) > 0 && !isNaN(parseFloat(f.quantity)))
      .map((f) => `${f.quantity} ${displayUnitName({ name: f.name, abbreviation: f.abbreviation })}`);
    if (parts.length === 0) return null;
    const total = computedTotal !== null ? Math.round(computedTotal * 10000) / 10000 : null;
    if (total === null) return null;
    return { parts: parts.join(" + "), total, targetAbbr: targetAbbreviation };
  }, [fields, computedTotal, targetAbbreviation]);

  // ── Build raw entries from current field state ──
  const buildRawEntries = useCallback((): QuantityEntry[] => {
    return fields
      .filter((f) => {
        const qty = parseFloat(f.quantity);
        if (isNaN(qty)) return false;
        return contextType === "adjustment" ? qty >= 0 : qty > 0;
      })
      .map((f) => ({
        unitId: f.unitId,
        quantity: parseFloat(f.quantity),
      }));
  }, [fields, contextType]);

  // ── Confirm handler ──
  const handleConfirm = useCallback(() => {
    if (isSaving) return;
    const entries = buildRawEntries();
    if (entries.length === 0) return;
    onConfirmRaw(entries);
  }, [isSaving, buildRawEntries, onConfirmRaw]);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEPPER MODE RENDER — Pure UI, no conversion, returns raw entries
  // ═══════════════════════════════════════════════════════════════════════════
  if (uiMode === "stepper") {
    if (!stepperConfig) return null;

    // ── BLOCKED STATE — product not configured or needs review ──
    if (stepperConfig.blockedMessage) {
      return (
        <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
          <SheetContent side="bottom" className="z-[70] rounded-t-2xl px-6 pb-8 pt-4" overlayClassName="z-[70]">
            <SheetHeader className="mb-6">
              <SheetTitle className="text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  <span className="text-base font-semibold truncate max-w-[240px]">
                    {stepperConfig.productName}
                  </span>
                </div>
              </SheetTitle>
            </SheetHeader>

            <div className="flex flex-col items-center gap-4 py-6">
              <div className="h-16 w-16 rounded-full bg-amber-500/10 flex items-center justify-center">
                <AlertTriangle className="h-8 w-8 text-amber-500" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-base font-semibold text-foreground">
                  {stepperConfig.blockedMessage.title}
                </p>
                <p className="text-sm text-muted-foreground max-w-[280px]">
                  {stepperConfig.blockedMessage.description}
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full h-12 text-base font-semibold rounded-xl"
              onClick={onClose}
            >
              Fermer
            </Button>
          </SheetContent>
        </Sheet>
      );
    }

    // ── MULTI_LEVEL MODE — N independent numeric inputs ──
    if (stepperConfig.inputMode === "multi_level" && stepperConfig.unitChain && stepperConfig.unitNames) {
      const chain = stepperConfig.unitChain;
      const names = stepperConfig.unitNames;
      const hasAnyValue = multiValues.some((v) => v > 0);
      const canConfirmMulti = hasAnyValue && !stepperConfig.conversionError;
      const headerLbl = stepperConfig.headerLabel ?? "Saisie en";
      const confirmLbl = stepperConfig.confirmLabel ?? "Confirmer";

      return (
        <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
          <SheetContent side="bottom" className="z-[70] rounded-t-2xl px-6 pb-8 pt-4" overlayClassName="z-[70]">
            <SheetHeader className="mb-6">
              <SheetTitle className="text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <PackageOpen className="h-5 w-5 text-primary" />
                  <span className="text-base font-semibold uppercase truncate max-w-[240px]">
                    {stepperConfig.productName}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground font-normal">
                  {headerLbl} <strong>multi-niveaux</strong>
                </p>
              </SheetTitle>
            </SheetHeader>

            {/* ── Conversion error banner ── */}
            {stepperConfig.conversionError && (
              <div className="flex items-start gap-2 mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{stepperConfig.conversionError}</span>
              </div>
            )}

            {/* ── Multi-level inputs — stepper for discrete, free input for physical ── */}
            <div className="space-y-4 mb-6">
              {chain.map((unitId, index) => {
                const family = stepperConfig.unitFamilies?.[index] ?? null;
                const isPhysical = family === "weight" || family === "volume";
                const currentVal = multiValues[index];

                return (
                  <div key={unitId} className="flex items-center gap-3">
                    <label className="text-sm font-medium text-muted-foreground w-20 text-right shrink-0">
                      {names[index]}
                    </label>

                    {isPhysical ? (
                      /* ── Physical unit: free text input ── */
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max={MAX_QUANTITY}
                        step="any"
                        value={currentVal > 0 ? String(currentVal) : ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const num = Number(raw);
                          if (raw !== "" && isNaN(num)) return;
                          const clamped = raw === "" ? 0 : Math.max(0, Math.min(MAX_QUANTITY, num));
                          setMultiValues((prev) => {
                            const next = [...prev];
                            next[index] = clamped;
                            return next;
                          });
                        }}
                        className="flex-1 text-center text-2xl font-bold h-14 rounded-xl border-2 border-primary/30 focus:border-primary tabular-nums"
                        placeholder="0"
                        autoFocus={index === 0}
                      />
                    ) : (
                      /* ── Discrete unit: mini stepper (+/-) ── */
                      <div className="flex-1 flex items-center justify-center gap-3">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-12 w-12 rounded-full shrink-0"
                          onClick={() => {
                            setMultiValues((prev) => {
                              const next = [...prev];
                              next[index] = Math.max(0, prev[index] - 1);
                              return next;
                            });
                          }}
                          disabled={currentVal <= 0}
                        >
                          <Minus className="h-5 w-5" />
                        </Button>

                        <div className="text-center min-w-[60px]">
                          <p className="text-3xl font-bold tabular-nums text-foreground">
                            {currentVal}
                          </p>
                        </div>

                        <Button
                          variant="outline"
                          size="icon"
                          className="h-12 w-12 rounded-full shrink-0"
                          onClick={() => {
                            setMultiValues((prev) => {
                              const next = [...prev];
                              next[index] = Math.min(MAX_QUANTITY, prev[index] + 1);
                              return next;
                            });
                          }}
                        >
                          <Plus className="h-5 w-5" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Confirm ── */}
            <Button
              className="w-full h-12 text-base font-semibold rounded-xl"
              onClick={() => {
                if (!canConfirmMulti) return;
                // Build raw entries — filter out zeros, deduplicate by unitId
                const seen = new Set<string>();
                const entries: QuantityEntry[] = [];
                for (let i = 0; i < chain.length; i++) {
                  const qty = multiValues[i];
                  if (qty > 0 && !seen.has(chain[i])) {
                    seen.add(chain[i]);
                    entries.push({ unitId: chain[i], quantity: qty });
                  }
                }
                if (entries.length > 0) {
                  onConfirmRaw(entries);
                  onClose();
                }
              }}
              disabled={!canConfirmMulti}
            >
              {stepperConfig.conversionError ? "Conversion impossible" : confirmLbl}
            </Button>
          </SheetContent>
        </Sheet>
      );
    }

    const displayQty = Number.isInteger(stepperQty)
      ? stepperQty.toString()
      : stepperQty.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

    const headerLbl = stepperConfig.headerLabel ?? "Saisie en";
    const confirmLbl = stepperConfig.confirmLabel ?? "Confirmer";
    const isDecimalMode = stepperConfig.inputMode === "decimal" || stepperConfig.inputMode === "continuous";
    const isFractionMode = stepperConfig.inputMode === "fraction";

    // ── Fraction helper: format decimal → fraction label ──
    const formatFraction = (val: number): string => {
      if (val === 0) return "0";
      const whole = Math.floor(val);
      const frac = +(val - whole).toFixed(4);
      let fracStr = "";
      if (Math.abs(frac - 0.25) < 0.001) fracStr = "¼";
      else if (Math.abs(frac - 0.5) < 0.001) fracStr = "½";
      else if (Math.abs(frac - 0.75) < 0.001) fracStr = "¾";
      else if (frac > 0.001) fracStr = frac.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

      if (whole > 0 && fracStr) return `${whole} ${fracStr}`;
      if (whole > 0) return whole.toString();
      return fracStr || "0";
    };

    // Decimal mode: quantity comes from free-text input
    const decimalQty = parseFloat(decimalText);
    const effectiveQty = isDecimalMode ? (isNaN(decimalQty) ? 0 : decimalQty) : stepperQty;
    const canConfirmStepper = effectiveQty > 0 && !stepperConfig.conversionError;

    return (
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="bottom" className="z-[70] rounded-t-2xl px-6 pb-8 pt-4" overlayClassName="z-[70]">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <PackageOpen className="h-5 w-5 text-primary" />
                <span className="text-base font-semibold uppercase truncate max-w-[240px]">
                  {stepperConfig.productName}
                </span>
              </div>
              <p className="text-xs text-muted-foreground font-normal">
                {headerLbl} <strong>{stepperConfig.unitName}</strong>
              </p>
            </SheetTitle>
          </SheetHeader>

          {/* ── Conversion error banner ── */}
          {stepperConfig.conversionError && (
            <div className="flex items-start gap-2 mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{stepperConfig.conversionError}</span>
            </div>
          )}

          {isFractionMode ? (
            /* ══════════════════════════════════════════════════════
               FRACTION MODE — Replace buttons: ¼, ½, ¾
               ══════════════════════════════════════════════════════ */
            <>
              {/* Current value display */}
              <div className="flex items-center justify-center mb-6">
                <div className="text-center min-w-[100px]">
                  <p className="text-4xl font-bold tabular-nums text-foreground">
                    {formatFraction(stepperQty)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {stepperConfig.unitName}
                  </p>
                </div>
              </div>

              {/* Fraction selection buttons — REPLACE, not add */}
              {!stepperConfig.conversionError && (
                <div className="flex items-center justify-center gap-3 mb-6">
                  {[0.25, 0.5, 0.75].map((frac) => {
                    const isSelected = Math.abs(stepperQty - frac) < 0.001;
                    const label = frac === 0.25 ? "¼" : frac === 0.5 ? "½" : "¾";
                    return (
                      <button
                        key={frac}
                        onClick={() => setStepperQty(frac)}
                        className={cn(
                          "w-16 h-16 rounded-2xl text-xl font-bold transition-all active:scale-95 border-2",
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-md"
                            : "bg-muted/50 text-foreground border-border hover:border-primary/50 hover:bg-muted",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : isDecimalMode ? (
            /* ══════════════════════════════════════════════════════
               DECIMAL / CONTINUOUS MODE — Editable field + stepper only
               ══════════════════════════════════════════════════════ */
            <>
              <div className="flex items-center justify-center gap-6 mb-6">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-14 w-14 rounded-full text-lg"
                  onClick={() => {
                    const current = parseFloat(decimalText) || 0;
                    const next = Math.max(0, +(current - stepperConfig.defaultStep).toFixed(4));
                    setDecimalText(next > 0 ? String(next) : "");
                  }}
                  disabled={(parseFloat(decimalText) || 0) <= 0 || !!stepperConfig.conversionError}
                >
                  <Minus className="h-6 w-6" />
                </Button>

                <div className="text-center min-w-[100px]">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    max={MAX_QUANTITY}
                    value={decimalText}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || /^\d*\.?\d*$/.test(val)) {
                        setDecimalText(val);
                      }
                    }}
                    className="text-center text-3xl font-bold h-16 rounded-xl border-2 border-primary/30 focus:border-primary tabular-nums"
                    placeholder="0"
                    autoFocus={false}
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    {stepperConfig.unitName}
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-14 w-14 rounded-full text-lg"
                  onClick={() => {
                    const current = parseFloat(decimalText) || 0;
                    const next = Math.min(MAX_QUANTITY, +(current + stepperConfig.defaultStep).toFixed(4));
                    setDecimalText(String(next));
                  }}
                  disabled={!!stepperConfig.conversionError}
                >
                  <Plus className="h-6 w-6" />
                </Button>
              </div>
            </>
          ) : (
            /* ══════════════════════════════════════════════════════
               INTEGER MODE — Simple stepper only (no chips)
               ══════════════════════════════════════════════════════ */
            <>
              <div className="flex items-center justify-center gap-6 mb-6">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-14 w-14 rounded-full text-lg"
                  onClick={() => setStepperQty((prev) => Math.max(0, +(prev - stepperConfig.defaultStep).toFixed(4)))}
                  disabled={stepperQty <= 0 || !!stepperConfig.conversionError}
                >
                  <Minus className="h-6 w-6" />
                </Button>

                <div className="text-center min-w-[100px]">
                  <p className="text-4xl font-bold tabular-nums text-foreground">
                    {displayQty}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {stepperConfig.unitName}
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-14 w-14 rounded-full text-lg"
                  onClick={() => setStepperQty((prev) => Math.min(MAX_QUANTITY, +(prev + stepperConfig.defaultStep).toFixed(4)))}
                  disabled={!!stepperConfig.conversionError}
                >
                  <Plus className="h-6 w-6" />
                </Button>
              </div>
            </>
          )}

          {/* ── Confirm ── */}
          <Button
            className="w-full h-12 text-base font-semibold rounded-xl"
            onClick={() => {
              if (!canConfirmStepper) return;
              onConfirmRaw([{ unitId: stepperConfig.unitId, quantity: effectiveQty }]);
              onClose();
            }}
            disabled={!canConfirmStepper}
          >
            {stepperConfig.conversionError ? "Conversion impossible" : confirmLbl}
          </Button>
        </SheetContent>
      </Sheet>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL MODE RENDER — Pure UI, pre-computed fields, returns raw entries
  // ═══════════════════════════════════════════════════════════════════════════

  const hasValidEntries =
    contextType === "adjustment"
      ? fields.some((f) => f.quantity !== "" && !isNaN(parseFloat(f.quantity)) && parseFloat(f.quantity) >= 0)
      : fields.some((f) => f.quantity !== "" && !isNaN(parseFloat(f.quantity)) && parseFloat(f.quantity) > 0);

  const stockUnitLabel = currentStockUnitLabel ?? targetAbbreviation;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="z-[70] sm:max-w-md max-h-[min(70vh,500px)] flex flex-col p-0 gap-0 [&>button]:hidden" overlayClassName="z-[70]">
          {/* ── HEADER ── */}
          <div className="px-4 pt-4 pb-3 space-y-1 border-b border-border/50">
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full",
                contextColor,
              )}
            >
              {displayLabel}
            </span>
            <h3 className="text-lg font-bold uppercase leading-tight truncate">
              {productName}
            </h3>
            {productCategory && (
              <p className="text-xs text-muted-foreground">{productCategory}</p>
            )}
          </div>

          {/* ── BODY ── */}
          <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto">
            {/* ── STOCK INFO (informational) ── */}
            {(currentStockCanonical != null || currentStockLoading) && (
              <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <PackageOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Stock actuel</span>
                </div>
                {currentStockLoading ? (
                  <div className="h-5 w-20 rounded bg-muted animate-pulse" />
                ) : (
                  <span className="font-mono font-semibold text-sm">
                    {Math.round((currentStockCanonical ?? 0) * 10000) / 10000}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      {stockUnitLabel}
                    </span>
                  </span>
                )}
              </div>
            )}

            {needsConfig && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-semibold text-destructive">
                      {diagnosticMessage ?? "Produit non configuré pour l'inventaire"}
                    </p>
                    <p className="text-muted-foreground text-xs mt-1">
                      Configurez le conditionnement via le Wizard avant de saisir.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!needsConfig && (
              <>
                {/* ── QUANTITY FIELDS ── */}
                <div
                  className={cn(
                    "grid gap-3",
                    fields.length === 1
                      ? "grid-cols-1"
                      : fields.length === 2
                        ? "grid-cols-2"
                        : "grid-cols-3",
                  )}
                >
                  {fields.map((field, idx) => {
                    const isPackaging =
                      field.kind === "packaging" ||
                      field.kind === "delivery" ||
                      field.kind === "billing" ||
                      field.kind === "equivalence";
                    return (
                      <div key={field.unitId} className="space-y-1.5 relative group">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center block">
                          {field.name}
                        </label>
                        <Input
                          ref={(el) => {
                            inputRefs.current[idx] = el;
                          }}
                          type="text"
                          inputMode={isPackaging ? "numeric" : "decimal"}
                          min="0"
                          step={isPackaging ? "1" : "any"}
                          value={field.quantity}
                          onChange={(e) => {
                            let val = e.target.value.replace(",", ".");
                            if (val !== "" && !/^-?\d*\.?\d*$/.test(val)) return;
                            if (isPackaging && val !== "") {
                              const parsed = Math.floor(Math.abs(parseFloat(val)));
                              if (!isNaN(parsed)) val = parsed.toString();
                            }
                            const num = parseFloat(val);
                            if (!isNaN(num) && num > MAX_QUANTITY) {
                              val = MAX_QUANTITY.toString();
                            }
                            updateFieldQuantity(field.unitId, val);
                          }}
                          onKeyDown={
                            isPackaging
                              ? (ev) => {
                                  if (ev.key === "." || ev.key === ",") ev.preventDefault();
                                }
                              : undefined
                          }
                          className={cn(
                            "text-center font-mono border-2 focus:border-primary",
                            fields.length >= 3 ? "text-xl h-12" : "text-2xl h-14",
                          )}
                          placeholder="0"
                          autoFocus={idx === 0}
                        />
                        <p className="text-[10px] text-muted-foreground/50 text-center">
                          {displayUnitName({ name: field.name, abbreviation: field.abbreviation })}
                        </p>
                        {fields.length > 1 && idx > 0 && (
                          <button
                            type="button"
                            onClick={() => removeField(field.unitId)}
                            className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-muted border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label={`Retirer ${field.name}`}
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* ── "Autre unité" — anti-doublon: only unused units ── */}
                {overflowOptions.length > 0 && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => setShowOtherUnitsSheet(true)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border hover:border-primary/50 transition-colors"
                    >
                      + Autre unité
                    </button>
                  </div>
                )}

                {/* ── RECAP ── */}
                {recapText && computedTotal !== null && computedTotal > 0 && (
                  <div className="rounded-xl bg-muted/50 border p-3 text-center space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      {recapLabel}
                    </p>
                    <p className="text-sm font-semibold text-foreground">{recapText.parts}</p>
                    {fields.length > 1 && (
                      <p className="text-xl font-bold font-mono text-primary">
                        = {recapText.total}
                        <span className="text-sm font-normal text-muted-foreground ml-2">
                          {recapText.targetAbbr}
                        </span>
                      </p>
                    )}
                    {fields.length === 1 && (
                      <p className="text-2xl font-bold font-mono">
                        {recapText.total}
                        <span className="text-sm font-normal text-muted-foreground ml-2">
                          {recapText.targetAbbr}
                        </span>
                      </p>
                    )}
                  </div>
                )}

                {/* ── STOCK AFTER (informational preview) ── */}
                {stockAfter != null && computedTotal != null && computedTotal > 0 && (
                  <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      {stockAfter >= (currentStockCanonical ?? 0) ? (
                        <TrendingUp className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-orange-500" />
                      )}
                      <span className="text-muted-foreground">Stock après</span>
                    </div>
                    <span
                      className={cn(
                        "font-mono font-semibold text-sm",
                        stockAfter < 0 && "text-destructive",
                      )}
                    >
                      {Math.round(stockAfter * 10000) / 10000}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        {stockUnitLabel}
                      </span>
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── FOOTER ── */}
          <div className="px-4 pb-3 pt-2 border-t border-border/50 space-y-1.5">
            {!needsConfig && (
              <Button
                onClick={handleConfirm}
                disabled={
                  !hasValidEntries ||
                  computedTotal === null ||
                  (contextType === "adjustment" ? computedTotal < 0 : computedTotal <= 0) ||
                  isSaving
                }
                className="w-full h-11 text-base font-semibold"
                aria-busy={isSaving}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enregistrement…
                  </>
                ) : isEditing ? (
                  "Mettre à jour"
                ) : (
                  "Ajouter"
                )}
              </Button>
            )}
            {!needsConfig &&
              !isSaving &&
              (computedTotal === null ||
                (contextType === "adjustment" ? computedTotal < 0 : computedTotal <= 0)) && (
                <p className="text-xs text-destructive text-center">
                  {contextType === "adjustment"
                    ? "Saisissez une quantité valide"
                    : "Saisissez une quantité supérieure à 0"}
                </p>
              )}
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={isSaving}
              className="w-full h-8 text-sm text-muted-foreground"
            >
              Fermer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── OTHER UNITS SHEET — anti-doublon: only unused units ── */}
      <Sheet open={showOtherUnitsSheet} onOpenChange={setShowOtherUnitsSheet}>
        <SheetContent side="bottom" className="z-[75] max-h-[50vh]" overlayClassName="z-[75]">
          <SheetHeader>
            <SheetTitle className="text-sm">Ajouter une unité</SheetTitle>
          </SheetHeader>
          <div className="flex flex-wrap gap-2 py-4">
            {overflowOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => addExtraField(opt)}
                className="px-4 py-2.5 rounded-full text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 border border-border transition-all"
              >
                {opt.name} ({displayUnitName({ name: opt.name, abbreviation: opt.abbreviation })})
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * @deprecated Use UniversalQuantityModal directly.
 * Backward-compatible wrapper.
 */
export function ReceptionQuantityModal(
  props: Omit<UniversalQuantityModalProps, "contextLabel" | "contextType"> & {
    contextLabel?: string;
    contextType?: QuantityContextType;
  },
) {
  return (
    <UniversalQuantityModal
      {...props}
      contextLabel={props.contextLabel ?? "Réception"}
      contextType={props.contextType ?? "reception"}
    />
  );
}

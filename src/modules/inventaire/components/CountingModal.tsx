/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE MOBILE — Counting Modal (Dual Mode: COMPTAGE / CORRECTION)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * INVARIANT 1: "compté" = counted_at != null (partout)
 * INVARIANT 2: COMPTAGE mode auto-advances to uncounted lines
 * INVARIANT 3: Navigation par lineId + display_order, JAMAIS par index
 * INVARIANT 4: Toute mutation = .eq("id", lineId)
 * INVARIANT 5: qty=0 est VALIDE (stock vide)
 *
 * PHASE 2 SSOT: Uses resolveInputUnitForContext("internal") via useCountingModal.
 * No more resolveProductUnitContext, usePreferredUnits, or buildOrderedFields.
 *
 * Logic extracted to:
 * - useCountingModal — state, memos, effects, handlers
 * - countingModalHelpers — pure functions, types, constants
 *
 * This file contains ONLY the presentational (JSX) shell.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  ChevronLeft,
  Loader2,
  SkipForward,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { InventoryLineWithProduct } from "../types";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import type { ProductInputConfigRow } from "@/modules/inputConfig";
import { cn } from "@/lib/utils";
import { useCountingModal } from "./useCountingModal";
import { type CountingModalMode } from "./countingModalHelpers";

export type { CountingModalMode };

interface CountingModalProps {
  open: boolean;
  onClose: () => void;
  lines: InventoryLineWithProduct[];
  linesLoading: boolean;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
  zoneName: string;
  mode: CountingModalMode;
  /** Product input configs (SSOT) */
  inputConfigs: Map<string, ProductInputConfigRow>;
  /** COMPTAGE: count a product (sets counted_at) */
  onCount: (lineId: string, quantity: number, unitId: string | null) => Promise<void>;
  /** CORRECTION: update quantity only (does NOT touch counted_at) */
  onUpdate: (lineId: string, quantity: number, unitId: string | null) => Promise<void>;
  /** Called when all products are counted in comptage mode */
  onAllCounted?: () => void;
}

export function CountingModal({
  open,
  onClose,
  lines,
  linesLoading,
  dbUnits,
  dbConversions,
  zoneName,
  mode,
  inputConfigs,
  onCount,
  onUpdate,
  onAllCounted,
}: CountingModalProps) {
  const cm = useCountingModal({
    open,
    onClose,
    lines,
    linesLoading,
    dbUnits,
    dbConversions,
    mode,
    inputConfigs,
    onCount,
    onUpdate,
    onAllCounted,
  });

  // Show loading state
  if (open && linesLoading) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md flex flex-col items-center justify-center min-h-[200px] [&>button]:hidden">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground mt-2">Chargement des produits…</p>
        </DialogContent>
      </Dialog>
    );
  }

  if (!cm.currentLine) return null;

  const hasInvalidEntry = cm.fields.some(
    (f) => f.quantity !== "" && (isNaN(parseFloat(f.quantity)) || parseFloat(f.quantity) < 0)
  );
  const hasValidEntries = !hasInvalidEntry;
  const canValidate = hasValidEntries && cm.computedTotal !== null && cm.computedTotal >= 0;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col p-0 gap-0 [&>button]:hidden">
          {/* HEADER */}
          <CountingHeader
            mode={mode}
            modeLabel={cm.modeLabel}
            isReviewing={cm.isReviewing}
            currentPosition={cm.currentPosition}
            totalLines={lines.length}
            countedCount={cm.countedCount}
            correctionPos={cm.correctionPos}
            progress={cm.progress}
            currentLine={cm.currentLine}
            isCounted={cm.isCounted ?? false}
            zoneName={zoneName}
          />

          {/* BODY */}
          <div className="flex-1 px-4 py-4 space-y-5 overflow-y-auto">
            {/* BLOCKED: not_configured or needs_review */}
            {cm.isBlocked && (
              <BlockedProductAlert
                reason={cm.blockedReason}
                onSkip={() => cm.handleSkip()}
                isSaving={cm.isSaving}
              />
            )}

            {/* ACTIVE: resolved OK */}
            {!cm.isBlocked && cm.fields.length > 0 && (
              <>
                {/* LABELED QUANTITY FIELDS */}
                <div
                  className={cn(
                    "grid gap-3",
                    cm.fields.length === 1
                      ? "grid-cols-1"
                      : cm.fields.length === 2
                        ? "grid-cols-2"
                        : "grid-cols-3"
                  )}
                >
                  {cm.fields.map((field, idx) => {
                    const isPackaging = field.kind === "packaging" || field.kind === "delivery" || field.kind === "billing" || field.kind === "equivalence";
                    return (
                    <div key={field.unitId} className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center block">
                        {field.name}
                      </label>
                      <Input
                        ref={(el) => {
                          cm.inputRefs.current[idx] = el;
                        }}
                        type="number"
                        onFocus={(e) => e.target.select()}
                        inputMode={isPackaging ? "numeric" : "decimal"}
                        min="0"
                        step={isPackaging ? "1" : "any"}
                        value={field.quantity}
                        onChange={(e) => {
                          let val = e.target.value;
                          if (isPackaging && val !== "") {
                            const parsed = Math.floor(Math.abs(parseFloat(val)));
                            if (!isNaN(parsed)) val = parsed.toString();
                          }
                          cm.updateFieldQuantity(field.unitId, val);
                        }}
                        onKeyDown={isPackaging ? (ev) => { if (ev.key === "." || ev.key === ",") ev.preventDefault(); } : undefined}
                        className={cn(
                          "text-center font-mono border-2 focus:border-primary",
                          cm.fields.length >= 3 ? "text-2xl h-14" : "text-3xl h-16"
                        )}
                        placeholder="0"
                        autoFocus={idx === 0}
                      />
                      <p className="text-[10px] text-muted-foreground/50 text-center">
                        {field.abbreviation}
                      </p>
                    </div>
                    );
                  })}
                </div>

                {/* RECAP + CANONICAL TOTAL */}
                {cm.recapText && cm.computedTotal !== null && cm.computedTotal > 0 && (
                  <div className="rounded-xl bg-muted/50 border p-4 text-center space-y-1.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Tu enregistres
                    </p>
                    <p className="text-sm font-semibold text-foreground">{cm.recapText.parts}</p>
                    {cm.fields.length > 1 && (
                      <p className="text-2xl font-bold font-mono text-primary">
                        = {cm.recapText.total}
                        <span className="text-sm font-normal text-muted-foreground ml-2">
                          {cm.recapText.targetAbbr}
                        </span>
                      </p>
                    )}
                    {cm.fields.length === 1 && (
                      <p className="text-3xl font-bold font-mono">
                        {cm.recapText.total}
                        <span className="text-base font-normal text-muted-foreground ml-2">
                          {cm.recapText.targetAbbr}
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* FOOTER */}
          <div className="px-4 pb-4 pt-2 border-t border-border/50 space-y-2">
            {(cm.canGoPrev || cm.canGoNext) && (
              <div className="flex items-center justify-between mb-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={cm.handlePrev}
                  disabled={!cm.canGoPrev || cm.isSaving}
                  className="h-9 w-9"
                  aria-label="Précédent"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={cm.handleNext}
                  disabled={!cm.canGoNext || cm.isSaving}
                  className="h-9 w-9"
                  aria-label="Suivant"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            )}

            {!cm.isBlocked && cm.fields.length > 0 && (
              <Button
                onClick={cm.handleConfirm}
                disabled={!canValidate || cm.isSaving}
                className="w-full h-12 text-base font-semibold"
                aria-busy={cm.isSaving}
              >
                {cm.isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enregistrement…
                  </>
                ) : (
                  cm.confirmLabel
                )}
              </Button>
            )}

            <Button
              variant="ghost"
              onClick={onClose}
              disabled={cm.isSaving}
              className="w-full h-9 text-sm text-muted-foreground"
            >
              Fermer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS (co-located, small)
// ═══════════════════════════════════════════════════════════════════════════

function CountingHeader({
  mode,
  modeLabel,
  isReviewing,
  currentPosition,
  totalLines,
  countedCount,
  correctionPos,
  progress,
  currentLine,
  isCounted,
  zoneName,
}: {
  mode: CountingModalMode;
  modeLabel: string;
  isReviewing: boolean;
  currentPosition: number;
  totalLines: number;
  countedCount: number;
  correctionPos: { current: number; total: number };
  progress: number;
  currentLine: InventoryLineWithProduct;
  isCounted: boolean;
  zoneName: string;
}) {
  return (
    <div className="px-4 pt-4 pb-3 space-y-2 border-b border-border/50">
      <div className="flex items-center justify-between mb-1">
        <span
          className={cn(
            "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full",
            mode === "comptage" && !isReviewing
              ? "bg-primary/10 text-primary"
              : "bg-accent text-accent-foreground"
          )}
        >
          {modeLabel}
        </span>
        <span className="text-xs text-muted-foreground font-mono">
          {mode === "correction"
            ? `${correctionPos.current + 1}/${correctionPos.total}`
            : `${currentPosition}/${totalLines} · ${countedCount} comptés`}
        </span>
      </div>
      <Progress value={progress} className="h-1.5" />
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold uppercase leading-tight truncate">
            {currentLine.product_name}
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            {currentLine.product_category && <span>{currentLine.product_category}</span>}
            {currentLine.product_code && (
              <span className="font-mono text-muted-foreground/70">{currentLine.product_code}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {isCounted && (
            <span className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              <Check className="h-3 w-3" /> Compté
            </span>
          )}
        </div>
      </div>
      {zoneName && (
        <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">{zoneName}</p>
      )}
    </div>
  );
}

function BlockedProductAlert({
  reason,
  onSkip,
  isSaving,
}: {
  reason: string | null;
  onSkip: () => void;
  isSaving: boolean;
}) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
        <div className="text-sm">
          <p className="font-semibold text-destructive">
            Produit non configuré
          </p>
          <p className="text-muted-foreground text-xs mt-1">
            {reason ?? "Configurez les paramètres avancés pour ce produit."}
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full mt-2 border-destructive/30 text-destructive hover:bg-destructive/10"
        onClick={onSkip}
        disabled={isSaving}
      >
        <SkipForward className="h-4 w-4 mr-2" />
        Passer ce produit
      </Button>
    </div>
  );
}

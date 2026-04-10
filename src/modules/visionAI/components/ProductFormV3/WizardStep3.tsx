/**
 * ═══════════════════════════════════════════════════════════════════════════
 * V3 WIZARD — ÉTAPE 3 : FACTURATION + PRIX DISPLAY (Nizar B)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 💰 Comment le fournisseur facture ?
 * - Unité facturée (FILTERED: only reachable units)
 * - Quantité facture
 * - Prix total ligne
 * - Unité d'affichage du prix (BFS-filtered)
 *
 * HARD LOCK: Billing unit must have a valid conversion path to reference unit.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, ArrowRight, Receipt, Calculator, AlertTriangle, Tag } from "lucide-react";
import type { PackagingLevel, Equivalence } from "@/modules/conditionnementV2";
import { useUnitConversions, resolveWizardUnitContext } from "@/core/unitConversion";
import { useMemo, useEffect } from "react";

interface WizardStep3Props {
  finalUnit: string | null;
  finalUnitId: string | null;
  packagingLevels: PackagingLevel[];
  billedQuantity: string;
  billedUnit: string;
  billedUnitId: string | null;
  lineTotal: string;
  priceDisplayUnitId: string | null;
  onBilledQuantityChange: (value: string) => void;
  onBilledUnitChange: (value: string, unitId: string | null) => void;
  onLineTotalChange: (value: string) => void;
  onPriceDisplayUnitChange: (unitId: string | null) => void;
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
}

export function WizardStep3({
  finalUnit,
  finalUnitId,
  packagingLevels,
  billedQuantity,
  billedUnit,
  billedUnitId,
  lineTotal,
  priceDisplayUnitId,
  onBilledQuantityChange,
  onBilledUnitChange,
  onLineTotalChange,
  onPriceDisplayUnitChange,
  onNext,
  onBack,
  canProceed,
}: WizardStep3Props) {
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();

  // Equivalence removed from wizard — always null
  const equivalence: Equivalence | null = null;

  // ── SINGLE SOURCE OF TRUTH: central resolver for ALL unit lists ──
  const unitContext = useMemo(() => {
    return resolveWizardUnitContext(
      { finalUnitId, billedUnitId, packagingLevels, equivalence },
      null,
      dbUnits,
      dbConversions
    );
  }, [finalUnitId, billedUnitId, packagingLevels, equivalence, dbUnits, dbConversions]);

  // Billing options = same BFS-reachable list as price display (single source of truth)
  const billingOptions = unitContext.allowedPriceDisplayUnits;

  // Check if currently selected billing unit is unreachable
  const billingUnreachable = useMemo(() => {
    if (!billedUnitId || !finalUnitId || billedUnitId === finalUnitId) return false;
    return !billingOptions.some((u) => u.id === billedUnitId);
  }, [billedUnitId, finalUnitId, billingOptions]);

  const billedUnitName = billedUnitId
    ? dbUnits.find((u) => u.id === billedUnitId)?.name ?? billedUnit
    : billedUnit;

  // Auto-prefill: Prix affiché → unité de référence
  useEffect(() => {
    if (!priceDisplayUnitId && finalUnitId) {
      onPriceDisplayUnitChange(finalUnitId);
    }
  }, [finalUnitId]); // eslint-disable-line react-hooks/exhaustive-deps

  const getUnitLabel = (id: string | null) => {
    if (!id) return null;
    const u = dbUnits.find((unit) => unit.id === id);
    return u ? `${u.name} (${u.abbreviation})` : null;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
            <Receipt className="h-8 w-8 text-primary" />
          </div>

          <h2 className="text-xl font-semibold text-center mb-2">
            💰 Comment le fournisseur facture ?
          </h2>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Recopie exactement ce qui est écrit sur la facture.
          </p>
        </div>

        <div className="max-w-lg mx-auto space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="v3-billed-qty">Quantité</Label>
              <Input
                id="v3-billed-qty"
                type="number"
                step="0.01"
                min="0"
                value={billedQuantity}
                onChange={(e) => onBilledQuantityChange(e.target.value)}
                placeholder="Ex: 5"
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="v3-billed-unit">Facturé en</Label>
              <Select
                value={billedUnitId ?? ""}
                onValueChange={(id) => {
                  const opt = billingOptions.find((o) => o.id === id);
                  if (opt) onBilledUnitChange(opt.name, id);
                }}
              >
                <SelectTrigger id="v3-billed-unit" className="h-11">
                  <SelectValue placeholder="...">{billedUnit || "..."}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {billingOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.name} ({opt.abbreviation})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="v3-line-total">Total ligne (€)</Label>
              <Input
                id="v3-line-total"
                type="number"
                step="0.01"
                min="0"
                value={lineTotal}
                onChange={(e) => onLineTotalChange(e.target.value)}
                placeholder="Ex: 54.35"
                className="h-11"
              />
            </div>
          </div>

          {/* Quick-pick chips — from central resolver */}
          <div className="flex flex-wrap gap-2">
            {billingOptions.slice(0, 7).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onBilledUnitChange(opt.name, opt.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  billedUnitId === opt.id
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-muted/50 text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground hover:border-accent"
                }`}
              >
                {opt.name} ({opt.abbreviation})
              </button>
            ))}
          </div>

          {/* Warning: currently selected unit is unreachable */}
          {billingUnreachable && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">
                  "{billedUnitName}" n'a aucune conversion vers "{finalUnit}".
                </p>
                <p className="text-xs mt-1 opacity-80">
                  Solutions : choisir une autre unité de facturation, ajouter un conditionnement, ou
                  modifier l'unité de référence.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 p-3 rounded-lg bg-accent/50 border border-border text-primary">
            <Calculator className="h-5 w-5 flex-shrink-0" />
            <p className="text-sm">Le prix unitaire sera calculé automatiquement.</p>
          </div>

          {/* ── Affichage du prix ── */}
          <div className="p-4 border rounded-lg space-y-2">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Tag className="h-4 w-4" />
              Afficher le prix en
            </Label>
            <Select
              value={priceDisplayUnitId ?? "__default__"}
              onValueChange={(v) => onPriceDisplayUnitChange(v === "__default__" ? null : v)}
            >
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Sélectionner une unité">
                  {priceDisplayUnitId ? getUnitLabel(priceDisplayUnitId) : "Sélectionner une unité"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {unitContext.allowedPriceDisplayUnits.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} ({u.abbreviation})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Unité dans laquelle le prix sera affiché sur la fiche produit.
            </p>
          </div>
        </div>
      </div>

      <div className="border-t px-6 py-4 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <Button
          onClick={onNext}
          disabled={!canProceed || billingUnreachable}
          className="min-w-[120px]"
        >
          Suivant
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

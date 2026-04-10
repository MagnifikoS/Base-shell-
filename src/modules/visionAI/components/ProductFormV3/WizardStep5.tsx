/**
 * ═══════════════════════════════════════════════════════════════════════════
 * V3 WIZARD — ÉTAPE 5 : RÉSUMÉ INTELLIGENT (Nizar B)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Visual summary with:
 * - Structure block (+ livraison & inventaire auto)
 * - Facturation block (+ prix affiché)
 * - Calculated price
 * - Variable weight warning
 *
 * SSOT: All unit displays resolve via UUID from measurement_units.
 * Zero text fallback.
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Calculator,
  Edit,
  Tag,
  Package,
  Receipt,
  X,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  CalculationResult,
  PackagingLevel,
  PriceLevel,
  Equivalence,
} from "@/modules/conditionnementV2";
import type { WizardStep } from "./types";
import { useMemo, useState } from "react";
import { useProductCategories } from "@/modules/produitsV2";
import { useUnits } from "@/hooks/useUnits";
import { useUnitConversions } from "@/core/unitConversion";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion";
import { findConversionPath } from "@/modules/conditionnementV2";
import { buildStructureSummary } from "@/core/unitConversion/buildStructureSummary";
import { displayUnitName } from "@/lib/units/displayUnitName";

interface WizardStep5Props {
  finalUnit: string | null;
  finalUnitId: string | null;
  packagingLevels: PackagingLevel[];
  billedQuantity: string;
  billedUnit: string;
  billedUnitId: string | null;
  lineTotal: string;
  priceLevel: PriceLevel | null;
  deliveryUnitId: string | null;
  stockHandlingUnitId: string | null;
  priceDisplayUnitId: string | null;
  category: string;
  categoryId: string | null;
  onCategoryChange: (name: string, id?: string | null) => void;
  onDeliveryUnitChange: (unitId: string | null) => void;
  
  onPriceDisplayUnitChange: (unitId: string | null) => void;
  calculationResult: CalculationResult;
  onBack: () => void;
  onGoToStep: (step: WizardStep) => void;
  onValidate: () => void;
  onNextProduct: () => void;
}

interface ReachableUnit {
  id: string;
  name: string;
  abbreviation: string;
}

// ── UX sort key: packaging first (by level), final unit, primary physical (kg/L), sub-units (g/ml) ──
const PRIMARY_PHYSICAL: Record<string, boolean> = { kg: true, L: true };
function unitSortKey(
  u: ReachableUnit,
  packagingMap: Map<string, number>,
  finalUnitId: string | null,
  dbUnits: UnitWithFamily[],
): number {
  const pkgIdx = packagingMap.get(u.id);
  if (pkgIdx !== undefined) return pkgIdx; // 0, 1, 2… packaging levels
  if (u.id === finalUnitId) return 50;
  const dbU = dbUnits.find((d) => d.id === u.id);
  if (dbU && (dbU.family === "weight" || dbU.family === "volume")) {
    return PRIMARY_PHYSICAL[dbU.abbreviation] ? 60 : 70; // kg/L before g/ml
  }
  return 80;
}

// ── Price display respecting user's chosen unit ──
function PriceDisplay({
  calculationResult,
  finalUnit,
  finalUnitId,
  priceDisplayUnitId,
  dbUnits,
  dbConversions,
  packagingLevels,
  equivalence,
  allUnits,
}: {
  calculationResult: CalculationResult;
  finalUnit: string | null;
  finalUnitId: string | null;
  priceDisplayUnitId: string | null;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
  packagingLevels: PackagingLevel[];
  equivalence: Equivalence | null;
  allUnits: Array<{ id: string; name: string; abbreviation: string }>;
}) {
  const unitPrice = calculationResult.unitPriceFinal;
  const quantity = calculationResult.quantityFinalTotal;
  if (unitPrice === null || quantity === null) return null;

  // Default: show in finalUnit
  let displayUnit = finalUnit || "?";
  let displayPrice = unitPrice;
  let displayQty = quantity;

  // If user chose a different display unit and conversion exists, convert
  if (priceDisplayUnitId && finalUnitId && priceDisplayUnitId !== finalUnitId) {
    const path = findConversionPath(
      priceDisplayUnitId,
      finalUnitId,
      dbUnits,
      dbConversions,
      packagingLevels,
      equivalence,
    );
    if (path.reached && path.factor !== null && path.factor > 0) {
      // factor = how many finalUnit per 1 displayUnit
      displayPrice = unitPrice * path.factor;
      displayQty = quantity / path.factor;
      const dispU = allUnits.find((u) => u.id === priceDisplayUnitId);
      if (dispU) displayUnit = dispU.name;
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div>
        <span className="text-muted-foreground text-xs">Quantité totale</span>
        <p className="font-semibold text-base">
          {displayQty.toFixed(2)} {displayUnit}
        </p>
      </div>
      <div>
        <span className="text-muted-foreground text-xs">Prix unitaire</span>
        <p className="font-semibold text-base">
          {displayPrice.toFixed(2)} € / {displayUnit}
        </p>
      </div>
    </div>
  );
}

export function WizardStep5({
  finalUnit,
  finalUnitId,
  packagingLevels,
  billedQuantity,
  billedUnit,
  billedUnitId,
  lineTotal,
  priceLevel,
  deliveryUnitId,
  stockHandlingUnitId,
  priceDisplayUnitId,
  category,
  categoryId,
  onCategoryChange,
  onDeliveryUnitChange,
  
  onPriceDisplayUnitChange,
  calculationResult,
  onBack,
  onGoToStep,
  onValidate,
  onNextProduct,
}: WizardStep5Props) {
  const isCoherent = calculationResult.isCoherent;
  const hasResult = calculationResult.unitPriceFinal !== null;
  const { categories, isEmpty: noCategoriesConfigured } = useProductCategories();
  const selectedCategoryId = categoryId ?? "__empty__";
  const { units: allUnits } = useUnits();
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();

  // ── Inline edit states ──
  const [editingStructureUnits, setEditingStructureUnits] = useState(false);
  const [editDelivery, setEditDelivery] = useState<string | null>(null);

  const [editingPriceDisplay, setEditingPriceDisplay] = useState(false);
  const [editPriceDisplay, setEditPriceDisplay] = useState<string | null>(null);

  const startEditStructureUnits = () => {
    setEditDelivery(deliveryUnitId);
    setEditingStructureUnits(true);
  };
  const cancelEditStructureUnits = () => setEditingStructureUnits(false);
  const applyEditStructureUnits = () => {
    onDeliveryUnitChange(editDelivery);
    setEditingStructureUnits(false);
  };

  const startEditPriceDisplay = () => {
    setEditPriceDisplay(priceDisplayUnitId);
    setEditingPriceDisplay(true);
  };
  const cancelEditPriceDisplay = () => setEditingPriceDisplay(false);
  const applyEditPriceDisplay = () => {
    onPriceDisplayUnitChange(editPriceDisplay);
    setEditingPriceDisplay(false);
  };

  // ── Unit resolution helpers ──
  const getUnitLabel = (id: string | null): string | null => {
    if (!id) return null;
    const u = allUnits.find((u) => u.id === id);
    return u ? displayUnitName({ name: u.name, abbreviation: u.abbreviation }) : null;
  };

  // ── Delivery unit validation: warn only if packaging exists but user chose physical ──
  const deliveryUnitWarning = useMemo(() => {
    if (!deliveryUnitId) return null;
    const u = dbUnits.find((unit) => unit.id === deliveryUnitId);
    if (!u || (u.family !== "weight" && u.family !== "volume")) return null;
    // Only warn if the product HAS packaging levels available —
    // meaning the user could pick a packaging unit but chose a physical one.
    // For simple products (no packaging), physical delivery is normal.
    const hasPackagingOptions = packagingLevels.some((lvl) => !!lvl.type_unit_id);
    if (!hasPackagingOptions) return null;
    return "Livraison doit être un packaging (carton, colis…), pas une unité physique.";
  }, [deliveryUnitId, dbUnits, packagingLevels]);

  // ── Equivalence removed from wizard — always null ──
  const equivalence: Equivalence | null = null;

  // ── Candidate IDs for BFS ──
  const candidateIds = useMemo(() => {
    const ids = new Set<string>();
    if (finalUnitId) ids.add(finalUnitId);
    if (billedUnitId) ids.add(billedUnitId);
    for (const level of packagingLevels) {
      if (level.type_unit_id) ids.add(level.type_unit_id);
      if (level.contains_unit_id) ids.add(level.contains_unit_id);
    }
    if (equivalence?.source_unit_id) ids.add(equivalence.source_unit_id);
    if (equivalence?.unit_id) ids.add(equivalence.unit_id);
    for (const rule of dbConversions) {
      if (!rule.is_active) continue;
      if (ids.has(rule.from_unit_id)) ids.add(rule.to_unit_id);
      if (ids.has(rule.to_unit_id)) ids.add(rule.from_unit_id);
    }
    return ids;
  }, [finalUnitId, billedUnitId, packagingLevels, equivalence, dbConversions]);

  // ── Delivery options: packaging types + final unit fallback ──
  const deliveryOptions = useMemo((): ReachableUnit[] => {
    const result: ReachableUnit[] = [];
    const addedIds = new Set<string>();
    for (const level of packagingLevels) {
      if (level.type_unit_id && !addedIds.has(level.type_unit_id)) {
        const unit = allUnits.find((u) => u.id === level.type_unit_id);
        if (unit) {
          result.push({ id: unit.id, name: unit.name, abbreviation: unit.abbreviation });
          addedIds.add(unit.id);
        }
      }
    }
    if (result.length === 0 && finalUnitId) {
      const fu = allUnits.find((u) => u.id === finalUnitId);
      if (fu) {
        result.push({ id: fu.id, name: fu.name, abbreviation: fu.abbreviation });
      }
    }
    return result;
  }, [packagingLevels, allUnits, finalUnitId]);

  // ── BFS price display options (sorted: packaging desc → final → kg/L before g/ml) ──
  const priceDisplayOptions = useMemo((): ReachableUnit[] => {
    if (!finalUnitId) return [];
    const result: ReachableUnit[] = [];
    for (const unitId of candidateIds) {
      const unit = allUnits.find((u) => u.id === unitId);
      if (!unit) continue;
      if (unitId === finalUnitId) {
        result.push({ id: unit.id, name: unit.name, abbreviation: unit.abbreviation });
        continue;
      }
      const path = findConversionPath(
        unitId,
        finalUnitId,
        dbUnits,
        dbConversions,
        packagingLevels,
        equivalence
      );
      if (path.reached && path.factor !== null) {
        result.push({ id: unit.id, name: unit.name, abbreviation: unit.abbreviation });
      }
    }
    // Sort: packaging levels first (by index), then final unit, then primary physical (kg/L), then sub-units (g/ml)
    const packagingUnitIds = new Map<string, number>();
    packagingLevels.forEach((lvl, i) => {
      if (lvl.type_unit_id) packagingUnitIds.set(lvl.type_unit_id, i);
    });
    result.sort((a, b) => {
      const aKey = unitSortKey(a, packagingUnitIds, finalUnitId, dbUnits);
      const bKey = unitSortKey(b, packagingUnitIds, finalUnitId, dbUnits);
      return aKey - bKey;
    });
    return result;
  }, [finalUnitId, candidateIds, allUnits, dbUnits, dbConversions, packagingLevels, equivalence]);

  // Build structure summary via shared utility
  const structureResult = useMemo(() => {
    return buildStructureSummary(
      packagingLevels,
      equivalence,
      finalUnit,
      finalUnitId,
      dbUnits,
      dbConversions
    );
  }, [packagingLevels, equivalence, finalUnit, finalUnitId, dbUnits, dbConversions]);

  const structureSummary = structureResult.lines.map((l) => l.label).join("\n");

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="flex flex-col items-center mb-4">
          <div
            className={cn(
              "w-14 h-14 rounded-full flex items-center justify-center mb-3",
              isCoherent ? "bg-green-100 dark:bg-green-900/30" : "bg-amber-100 dark:bg-amber-900/30"
            )}
          >
            {isCoherent ? (
              <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400" />
            ) : (
              <AlertTriangle className="h-7 w-7 text-amber-600 dark:text-amber-400" />
            )}
          </div>
          <h2 className="text-lg font-semibold text-center">Résumé</h2>
        </div>

        <div className="max-w-lg mx-auto space-y-3">
          {/* Category */}
          <div className="p-3 border rounded-lg bg-muted/10 space-y-2">
            <Label htmlFor="category" className="flex items-center gap-2 text-xs font-medium">
              <Tag className="h-3.5 w-3.5" />
              Catégorie
            </Label>
            {noCategoriesConfigured ? (
              <p className="text-sm text-muted-foreground italic">Aucune catégorie configurée.</p>
            ) : (
              <Select
                value={selectedCategoryId}
                onValueChange={(value) => {
                  if (value === "__empty__") {
                    onCategoryChange("", null);
                  } else {
                    const cat = categories.find((c) => c.id === value);
                    if (cat) {
                      onCategoryChange(cat.name, cat.id);
                    }
                  }
                }}
              >
                <SelectTrigger id="category" className="max-w-xs h-9">
                  <SelectValue placeholder="Sélectionner une catégorie" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__empty__">— Aucune —</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* Structure block — includes delivery & inventory (auto)       */}
          {/* ══════════════════════════════════════════════════════════════ */}
          <div className="p-3 border rounded-lg bg-muted/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" /> Structure
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => onGoToStep(1)}
              >
                <Edit className="h-3 w-3 mr-1" /> Modifier
              </Button>
            </div>

            {structureSummary && (
              <pre className="text-sm whitespace-pre-wrap font-mono text-foreground/80">
                {structureSummary}
              </pre>
            )}

            {/* Delivery + Stock unit inline */}
            <Separator className="my-1" />

            {!editingStructureUnits ? (
              <div className="flex items-center justify-between">
                <div className="flex gap-4 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground">Livraison</span>
                    <p className="font-medium">
                      {getUnitLabel(deliveryUnitId) || (
                        <span className="text-muted-foreground italic text-xs">—</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Stock</span>
                    <div className="flex items-center gap-1">
                      <p className="font-medium">{getUnitLabel(stockHandlingUnitId) || "—"}</p>
                      <span className="text-[10px] text-muted-foreground">(auto)</span>
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={startEditStructureUnits}
                >
                  <Edit className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {deliveryOptions.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs">Livraison</Label>
                    <Select
                      value={editDelivery ?? "__none__"}
                      onValueChange={(v) => setEditDelivery(v === "__none__" ? null : v)}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Non défini" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Non défini</SelectItem>
                        {deliveryOptions.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">Stock</Label>
                  <div className="h-8 flex items-center px-3 rounded-md border bg-muted text-xs font-medium">
                    {getUnitLabel(stockHandlingUnitId) || "—"}
                    <span className="ml-1 text-muted-foreground">(auto)</span>
                  </div>
                </div>
                <div className="flex gap-1 justify-end">
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={cancelEditStructureUnits}>
                    <X className="h-3 w-3 mr-1" /> Annuler
                  </Button>
                  <Button variant="default" size="sm" className="h-6 text-xs px-2" onClick={applyEditStructureUnits}>
                    <Check className="h-3 w-3 mr-1" /> OK
                  </Button>
                </div>
              </div>
            )}

            {/* Delivery unit warning */}
            {deliveryUnitWarning && (
              <div className="flex items-center gap-2 p-1.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <span className="text-xs text-amber-700 dark:text-amber-400">{deliveryUnitWarning}</span>
              </div>
            )}
          </div>

          {/* Variable weight warning removed — equivalence no longer in wizard */}

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* Facturation block — includes price display unit              */}
          {/* ══════════════════════════════════════════════════════════════ */}
          <div className="p-3 border rounded-lg bg-muted/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium flex items-center gap-1.5">
                <Receipt className="h-3.5 w-3.5" /> Facturation
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => onGoToStep(3)}
              >
                <Edit className="h-3 w-3 mr-1" /> Modifier
              </Button>
            </div>
            <p className="text-sm">
              {billedQuantity && billedUnit
                ? `${billedQuantity} × ${billedUnit} = ${lineTotal || "?"} €`
                : "Non renseigné"}
            </p>

            {/* Prix affiché — inline in facturation */}
            <Separator className="my-1" />
            {!editingPriceDisplay ? (
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="text-xs text-muted-foreground">Prix affiché en</span>
                  <p className="font-medium">
                    {getUnitLabel(priceDisplayUnitId) || (
                      <span className="text-muted-foreground italic text-xs">—</span>
                    )}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={startEditPriceDisplay}
                >
                  <Edit className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs">Prix affiché en</Label>
                <Select
                  value={editPriceDisplay ?? "__none__"}
                  onValueChange={(v) => setEditPriceDisplay(v === "__none__" ? null : v)}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Non défini" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Non défini</SelectItem>
                    {priceDisplayOptions.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-1 justify-end">
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={cancelEditPriceDisplay}>
                    <X className="h-3 w-3 mr-1" /> Annuler
                  </Button>
                  <Button variant="default" size="sm" className="h-6 text-xs px-2" onClick={applyEditPriceDisplay}>
                    <Check className="h-3 w-3 mr-1" /> OK
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Calculated result */}
          <div
            className={cn(
              "p-4 rounded-lg border-2",
              isCoherent
                ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30"
                : "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30"
            )}
          >
            <div className="flex items-center gap-2 mb-3">
              <Calculator className="h-5 w-5" />
              <span className="font-semibold text-sm">Prix calculé</span>
              <Badge
                variant={isCoherent ? "default" : "secondary"}
                className={cn(
                  "ml-auto text-xs",
                  isCoherent ? "bg-green-600 dark:bg-green-700" : "bg-amber-600 dark:bg-amber-700"
                )}
              >
                {isCoherent ? "Cohérent" : "Incohérence"}
              </Badge>
            </div>

            {hasResult ? (
              <PriceDisplay
                calculationResult={calculationResult}
                finalUnit={finalUnit}
                finalUnitId={finalUnitId}
                priceDisplayUnitId={priceDisplayUnitId}
                dbUnits={dbUnits}
                dbConversions={dbConversions}
                packagingLevels={packagingLevels}
                equivalence={equivalence}
                allUnits={allUnits}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Impossible de calculer avec les données fournies.
              </p>
            )}

            {calculationResult.warnings.length > 0 && (
              <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800 space-y-1">
                {calculationResult.warnings
                  .filter((w) => !(priceLevel && w.toLowerCase().includes("niveau")))
                  .map((warning, i) => (
                    <p
                      key={i}
                      className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1"
                    >
                      <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                      {warning}
                    </p>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t px-6 py-4 flex justify-between gap-2">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onNextProduct}>
            Produit suivant
          </Button>
          <Button onClick={onValidate} className="min-w-[100px]">
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Valider
          </Button>
        </div>
      </div>
    </div>
  );
}

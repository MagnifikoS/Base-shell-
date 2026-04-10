/**
 * ═══════════════════════════════════════════════════════════════════════════
 * V3 WIZARD — ÉTAPE 2 : STRUCTURE & CONDITIONNEMENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * UX "packaging-first":
 *   - L'utilisateur commence par décrire le conditionnement réel
 *   - L'unité de référence (finalUnit) est auto-déduite du niveau le plus profond
 *   - Option "produit simple" pour les produits sans conditionnement
 *
 * Aucun terme technique exposé à l'utilisateur.
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
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Plus,
  Trash2,
  Lock,
  AlertTriangle,
  XCircle,
  Scale,
  Package,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PackagingLevel } from "@/modules/conditionnementV2";
import { validateAllPackaging } from "@/modules/conditionnementV2";
import { useUnits } from "@/hooks/useUnits";
import { useUnitConversions } from "@/core/unitConversion";
import { useNavigate } from "react-router-dom";
import { useMemo, useEffect, useState } from "react";

const MAX_LEVELS = 3;

/** Is the contains_unit_id a physical (weight/volume) unit? */
function isContentUnitPhysical(
  containsUnitId: string | null | undefined,
  baseUnits: Array<{ id: string; family?: string | null }>
): boolean {
  if (!containsUnitId) return false;
  const u = baseUnits.find((b) => b.id === containsUnitId);
  return u?.family === "weight" || u?.family === "volume";
}

/** Input for containsQuantity — integer-only for discrete, decimal for weight/volume */
function ContainsQuantityInput({
  level,
  baseUnits,
  onUpdateLevel,
}: {
  level: PackagingLevel;
  baseUnits: Array<{ id: string; family?: string | null }>;
  onUpdateLevel: (id: string, updates: Partial<PackagingLevel>) => void;
}) {
  const allowDecimal = isContentUnitPhysical(level.contains_unit_id, baseUnits);

  return (
    <Input
      type="number"
      min={allowDecimal ? "0.001" : "1"}
      step={allowDecimal ? "any" : "1"}
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={level.containsQuantity ?? ""}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          onUpdateLevel(level.id, { containsQuantity: null });
          return;
        }
        const parsed = parseFloat(raw.replace(",", "."));
        if (allowDecimal) {
          if (!isNaN(parsed) && parsed > 0) {
            onUpdateLevel(level.id, { containsQuantity: parsed });
          }
        } else {
          const intVal = Math.floor(Math.abs(parsed));
          if (!isNaN(intVal) && intVal > 0) {
            onUpdateLevel(level.id, { containsQuantity: intVal });
          }
        }
      }}
      onKeyDown={(e) => {
        if (!allowDecimal && (e.key === "." || e.key === ",")) {
          e.preventDefault();
        }
      }}
      className="h-9"
      placeholder="Qté"
    />
  );
}

type StructureMode = "packaging" | "simple";

interface WizardStepStructureProps {
  // Section A — Unité de référence (auto-deduced in packaging mode)
  finalUnit: string | null;
  finalUnitId: string | null;
  onFinalUnitChange: (unit: string | null, unitId: string | null) => void;

  // Section C — Conditionnement
  hasPackaging: boolean;
  packagingLevels: PackagingLevel[];
  onHasPackagingChange: (value: boolean) => void;
  onAddLevel: () => void;
  onRemoveLevel: (id: string) => void;
  onUpdateLevel: (id: string, updates: Partial<PackagingLevel>) => void;

  // Navigation
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
}

export function WizardStepStructure({
  finalUnit,
  finalUnitId,
  onFinalUnitChange,
  hasPackaging,
  packagingLevels,
  onHasPackagingChange,
  onAddLevel,
  onRemoveLevel,
  onUpdateLevel,
  onNext,
  onBack,
  canProceed,
}: WizardStepStructureProps) {
  const { baseUnits, packagingTypes, physicalUnits } = useUnits({ withPackaging: true });
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();
  const navigate = useNavigate();

  // ── Derive structure mode from state ──
  const [mode, setMode] = useState<StructureMode>(
    hasPackaging || packagingLevels.length > 0 ? "packaging" : "simple"
  );

  // ── All units for dropdowns ──
  const allBaseAndPackaging = [...baseUnits, ...packagingTypes];

  // Content options for packaging "contenu" dropdown (all units available)
  const contentOptions = useMemo(() => [
    ...packagingTypes.map((p) => ({ id: p.id, name: p.name })),
    ...baseUnits.map((u) => ({ id: u.id, name: u.name })),
  ], [packagingTypes, baseUnits]);

  const typeOptions = packagingTypes.map((p) => ({ id: p.id, name: p.name }));


  // ── Auto-deduce finalUnit from deepest packaging level ──
  const deepestLevel = packagingLevels.length > 0
    ? packagingLevels[packagingLevels.length - 1]
    : null;

  useEffect(() => {
    if (mode !== "packaging" || !deepestLevel) return;
    const deepContainsId = deepestLevel.contains_unit_id;
    const deepContainsName = deepestLevel.containsUnit;
    if (deepContainsId && deepContainsName && deepContainsId !== finalUnitId) {
      onFinalUnitChange(deepContainsName, deepContainsId);
    }
  }, [mode, deepestLevel?.contains_unit_id, deepestLevel?.containsUnit, finalUnitId, onFinalUnitChange]);

  // ── Detect if deduced finalUnit is countable (for equivalence) ──
  const selectedUnit = baseUnits.find((u) => u.id === finalUnitId);
  const isCountableUnit =
    finalUnitId &&
    (!selectedUnit || (selectedUnit.family !== "weight" && selectedUnit.family !== "volume"));

  // Already-used type_unit_ids (prevent duplicates)
  const usedTypeUnitIds = useMemo(
    () => new Set(packagingLevels.map((l) => l.type_unit_id).filter(Boolean)),
    [packagingLevels]
  );

  // Packaging validation
  const packagingValidation = useMemo(() => {
    if (mode !== "packaging" || packagingLevels.length === 0)
      return { valid: true, errors: [] };
    return validateAllPackaging(packagingLevels, finalUnitId, null, dbUnits, dbConversions);
  }, [mode, packagingLevels, finalUnitId, dbUnits, dbConversions]);

  const effectiveCanProceed = canProceed && (mode !== "packaging" || packagingValidation.valid);

  // ── Mode switch handlers ──
  function switchToPackaging() {
    setMode("packaging");
    onHasPackagingChange(true);
    // Auto-add first level if empty
    if (packagingLevels.length === 0) {
      onAddLevel();
    }
  }

  function switchToSimple() {
    setMode("simple");
    onHasPackagingChange(false);
    // Clear finalUnit so user picks it fresh
    onFinalUnitChange(null, null);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* MODE SELECTOR                                                  */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-1">Structure & Conditionnement</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Comment ce produit est-il conditionné par le fournisseur ?
          </p>

          <div className="grid grid-cols-2 gap-3 max-w-lg mx-auto">
            <button
              type="button"
              onClick={switchToPackaging}
              className={cn(
                "flex flex-col items-center gap-2 p-4 border rounded-xl transition-all text-center",
                mode === "packaging"
                  ? "border-primary bg-primary/5 shadow-sm ring-2 ring-primary/20"
                  : "hover:bg-muted/50 border-border"
              )}
            >
              <Boxes className="h-6 w-6 text-primary" />
              <span className="text-sm font-medium">Produit conditionné</span>
              <span className="text-[11px] text-muted-foreground leading-tight">
                Sac, carton, boîte, pack…
              </span>
            </button>

            <button
              type="button"
              onClick={switchToSimple}
              className={cn(
                "flex flex-col items-center gap-2 p-4 border rounded-xl transition-all text-center",
                mode === "simple"
                  ? "border-primary bg-primary/5 shadow-sm ring-2 ring-primary/20"
                  : "hover:bg-muted/50 border-border"
              )}
            >
              <Package className="h-6 w-6 text-primary" />
              <span className="text-sm font-medium">Produit simple</span>
              <span className="text-[11px] text-muted-foreground leading-tight">
                Vendu au kg, à la pièce, au litre…
              </span>
            </button>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* MODE: PACKAGING — Packaging rows first                         */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {mode === "packaging" && (
          <div className="mb-8 border-t pt-6">
            <div className="flex items-center gap-2 mb-4">
              <Boxes className="h-5 w-5 text-primary" />
              <h3 className="text-base font-semibold">Conditionnement</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Décrivez l'emballage : un <strong>type</strong> contient une <strong>quantité</strong> d'une <strong>unité</strong>.
            </p>

            <div className="max-w-lg mx-auto space-y-4">
              {packagingLevels.map((level, index) => {
                const isTypeLocked = index > 0 && !!level.type;
                const isSelfRef =
                  level.type_unit_id &&
                  level.contains_unit_id &&
                  level.type_unit_id === level.contains_unit_id;
                const isDuplicateType =
                  level.type_unit_id &&
                  packagingLevels.filter(
                    (l) => l.id !== level.id && l.type_unit_id === level.type_unit_id
                  ).length > 0;

                return (
                  <div
                    key={level.id}
                    className={cn(
                      "p-4 border rounded-lg bg-muted/30 space-y-3",
                      (isSelfRef || isDuplicateType) && "border-destructive"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {packagingLevels.length === 1
                          ? "Conditionnement"
                          : `Niveau ${index + 1}`}
                      </span>
                      {packagingLevels.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => onRemoveLevel(level.id)}
                          aria-label="Supprimer le niveau"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {/* Row: [Type] contient [Qty] [Unit] */}
                    <div className="flex items-end gap-2">
                      {/* Type */}
                      <div className="flex-1 min-w-0">
                        <Label className="text-xs flex items-center gap-1 mb-1">
                          Type
                          {isTypeLocked && <Lock className="h-3 w-3 text-muted-foreground" />}
                        </Label>
                        {isTypeLocked ? (
                          <div className="h-9 px-3 flex items-center text-sm bg-muted border rounded-md text-muted-foreground">
                            {level.type}
                          </div>
                        ) : (
                          <Select
                            value={level.type_unit_id ?? ""}
                            onValueChange={(id) => {
                              const pkg = typeOptions.find((t) => t.id === id);
                              if (pkg)
                                onUpdateLevel(level.id, {
                                  type: pkg.name,
                                  type_unit_id: id,
                                });
                            }}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Sac, Carton…">
                                {level.type || "Sac, Carton…"}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {typeOptions
                                .filter(
                                  (t) =>
                                    t.id === level.type_unit_id ||
                                    !usedTypeUnitIds.has(t.id)
                                )
                                .map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>

                      {/* "contient" label */}
                      <span className="text-xs text-muted-foreground pb-2 shrink-0">
                        contient
                      </span>

                      {/* Quantity */}
                      <div className="w-20">
                        <Label className="text-xs mb-1">Qté</Label>
                        <ContainsQuantityInput
                          level={level}
                          baseUnits={baseUnits}
                          onUpdateLevel={onUpdateLevel}
                        />
                      </div>

                      {/* Contains Unit */}
                      <div className="flex-1 min-w-0">
                        <Label className="text-xs mb-1">Unité</Label>
                        <Select
                          value={level.contains_unit_id ?? ""}
                          onValueChange={(id) => {
                            if (id === level.type_unit_id) return;
                            const opt = contentOptions.find((o) => o.id === id);
                            if (opt)
                              onUpdateLevel(level.id, {
                                containsUnit: opt.name,
                                contains_unit_id: id,
                              });
                          }}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="kg, pièce…">
                              {level.containsUnit || "kg, pièce…"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {contentOptions
                              .filter((opt) => opt.id !== level.type_unit_id)
                              .map((opt) => (
                                <SelectItem key={opt.id} value={opt.id}>
                                  {opt.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {isSelfRef && (
                      <div className="flex items-center gap-2 text-xs text-destructive">
                        <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        Un conditionnement ne peut pas se contenir lui-même.
                      </div>
                    )}
                    {isDuplicateType && !isSelfRef && (
                      <div className="flex items-center gap-2 text-xs text-destructive">
                        <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        Ce type est déjà utilisé dans un autre niveau.
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add level button */}
              {packagingLevels.length < MAX_LEVELS && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={onAddLevel}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter un niveau
                </Button>
              )}

              {/* Packaging validation errors */}
              {!packagingValidation.valid && (
                <div className="space-y-2">
                  {packagingValidation.errors
                    .filter(
                      (e) => e.code === "CYCLE" || e.code === "UNREACHABLE_PACKAGING"
                    )
                    .map((error, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive"
                      >
                        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium">{error.message}</p>
                          <p className="text-xs mt-1 opacity-80">{error.fix}</p>
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {packagingLevels.some((l) => l.type && !l.type_unit_id) && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Unité manquante</p>
                    <p className="text-xs mt-1">
                      Certaines unités n'existent pas encore. Créez-les dans les paramètres.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => navigate("/parametres/unites")}
                  >
                    Créer
                  </Button>
                </div>
              )}

              {/* Auto-deduced summary */}
              {finalUnit && finalUnitId && packagingLevels.length > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                  <Package className="h-4 w-4 text-primary shrink-0" />
                  <span>
                    Unité de base déduite : <strong>{finalUnit}</strong>
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* MODE: SIMPLE — Direct unit picker                              */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {mode === "simple" && (
          <div className="mb-8 border-t pt-6">
            <div className="flex items-center gap-2 mb-4">
              <Package className="h-5 w-5 text-primary" />
              <h3 className="text-base font-semibold">Unité de vente</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Comment ce produit est-il vendu ?
            </p>

            <div className="max-w-lg mx-auto">
              <Select
                value={finalUnitId ?? ""}
                onValueChange={(id) => {
                  const unit = allBaseAndPackaging.find((u) => u.id === id);
                  if (unit) onFinalUnitChange(unit.name, unit.id);
                }}
              >
                <SelectTrigger className="w-full h-12 text-base">
                  <SelectValue placeholder="Sélectionner…" />
                </SelectTrigger>
                <SelectContent>
                  {baseUnits.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground tracking-widest uppercase">
                        Mesure
                      </div>
                      {baseUnits.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </>
                  )}
                  {packagingTypes.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground tracking-widest uppercase mt-1">
                        Conditionnement
                      </div>
                      {packagingTypes.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>

              {allBaseAndPackaging.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Chargement des unités…
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-6 py-4 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <Button
          onClick={onNext}
          disabled={!effectiveCanProceed}
          className="min-w-[120px]"
        >
          Suivant
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

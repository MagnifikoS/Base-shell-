/**
 * ═══════════════════════════════════════════════════════════════════════════
 * V3 WIZARD — ÉTAPE 4 : ZONE, STOCK & UNITÉS DE SAISIE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Champs obligatoires:
 * - Catégorie (UUID via product_categories)
 * - Zone de stockage
 * - Seuil minimum (quantité + unité)
 * - Unités de saisie (réception + interne) — auto pour mono-unité
 *
 * Champ optionnel:
 * - Code-barres
 *
 * INPUT CONFIG INTEGRATION:
 * - Uses EXACTLY the same engine as SingleConfigDialog
 * - buildUnitChoicesFromEngine (BFS-validated choices)
 * - isMultiLevelPossible / getChainableUnits
 * - Zero new logic — just UI wiring
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  ArrowLeft,
  ArrowRight,
  MapPin,
  Tag,
  AlertTriangle,
  BarChart3,
  ScanBarcode,
  Package,
  ShieldAlert,
  Settings2,
  Plus,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { useProductCategories, useStorageZones } from "@/modules/produitsV2";
import { useUnits } from "@/hooks/useUnits";
import { useMemo, useEffect, useState } from "react";
import { useUnitConversions, resolveProductUnitContext, type ReachableUnit } from "@/core/unitConversion";
import type { ConditioningConfig } from "@/modules/produitsV2";
import {
  buildUnitChoicesFromEngine,
  isMultiLevelPossible,
  getChainableUnits,
  findChoiceForConfig,
} from "@/modules/inputConfig";
import type { UnitChoice, InputMode, ProductInputConfigRow } from "@/modules/inputConfig";
import { wizardStateToProductForConfig } from "./wizardInputConfigAdapter";
import type { WizardState } from "./types";
import type { Equivalence } from "@/modules/conditionnementV2";
import { buildReceptionConfig } from "@/modules/inputConfig/utils/buildReceptionConfig";

type SelectionType = "simple" | "multi_level";

interface WizardStep5StockProps {
  category: string;
  categoryId: string | null;
  storageZoneId: string | null;
  minStockQuantity: string;
  minStockUnitId: string | null;
  initialStockQuantity: string;
  initialStockUnitId: string | null;
  barcode: string;
  dlcWarningDays: string;
  finalUnitId: string | null;
  packagingLevels: Array<{
    id: string;
    type: string;
    type_unit_id?: string | null;
    containsUnit?: string;
    contains_unit_id?: string | null;
  }>;
  onCategoryChange: (name: string, id?: string | null) => void;
  onStorageZoneIdChange: (value: string | null) => void;
  onMinStockQuantityChange: (value: string) => void;
  onMinStockUnitIdChange: (value: string | null) => void;
  onInitialStockQuantityChange: (value: string) => void;
  onInitialStockUnitIdChange: (value: string | null) => void;
  onBarcodeChange: (value: string) => void;
  onDlcWarningDaysChange: (value: string) => void;
  canProceed: boolean;
  onNext: () => void;
  onBack: () => void;
  isEditMode?: boolean;
  // ── Input config props ──
  wizardState: WizardState;
  effectiveStockHandlingUnitId: string | null;
  effectiveDeliveryUnitId: string | null;
  equivalenceObject: Equivalence | null;
  conditioningConfig: ConditioningConfig | null;
  existingInputConfig: ProductInputConfigRow | null;
  onInputConfigReceptionChange: (mode: InputMode | null, unitId: string | null, chain: string[] | null, partial: boolean) => void;
  onInputConfigInternalChange: (mode: InputMode | null, unitId: string | null, chain: string[] | null, partial: boolean) => void;
  // ── Supplier Unit V1: toggle ──
  onAllowUnitSaleChange: (value: boolean) => void;
}

export function WizardStep5Stock({
  category,
  categoryId,
  storageZoneId,
  minStockQuantity,
  minStockUnitId,
  initialStockQuantity,
  initialStockUnitId,
  barcode,
  dlcWarningDays,
  finalUnitId,
  packagingLevels,
  onCategoryChange,
  onStorageZoneIdChange,
  onMinStockQuantityChange,
  onMinStockUnitIdChange,
  onInitialStockQuantityChange,
  onInitialStockUnitIdChange,
  onBarcodeChange,
  onDlcWarningDaysChange,
  canProceed,
  onNext,
  onBack,
  isEditMode = false,
  wizardState,
  effectiveStockHandlingUnitId,
  effectiveDeliveryUnitId,
  equivalenceObject,
  conditioningConfig,
  existingInputConfig,
  onInputConfigReceptionChange,
  onInputConfigInternalChange,
  onAllowUnitSaleChange,
}: WizardStep5StockProps) {
  const { categories } = useProductCategories();
  const { zones: storageZones } = useStorageZones();
  const { units: allUnits } = useUnits();
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();

  // ═══════════════════════════════════════════════════════════════════════════
  // INPUT CONFIG — BFS engine (SAME as SingleConfigDialog)
  // ═══════════════════════════════════════════════════════════════════════════

  const productForConfig = useMemo(() => {
    if (!wizardState.finalUnitId || dbUnits.length === 0) return null;
    return wizardStateToProductForConfig(
      wizardState,
      effectiveStockHandlingUnitId,
      effectiveDeliveryUnitId,
      equivalenceObject,
      conditioningConfig,
      dbUnits,
    );
  }, [wizardState, effectiveStockHandlingUnitId, effectiveDeliveryUnitId, equivalenceObject, conditioningConfig, dbUnits]);

  const engineContext = useMemo(() => {
    if (!productForConfig || dbUnits.length === 0) return null;
    return resolveProductUnitContext(
      {
        stock_handling_unit_id: productForConfig.stock_handling_unit_id,
        final_unit_id: productForConfig.final_unit_id,
        delivery_unit_id: productForConfig.delivery_unit_id,
        supplier_billing_unit_id: productForConfig.supplier_billing_unit_id,
        conditionnement_config: conditioningConfig ?? undefined,
      },
      dbUnits,
      dbConversions,
    );
  }, [productForConfig, conditioningConfig, dbUnits, dbConversions]);

  const reachableUnits = engineContext?.allowedInventoryEntryUnits ?? [];

  const receptionChoices = useMemo(
    () => (productForConfig ? buildUnitChoicesFromEngine(productForConfig, reachableUnits, "reception") : []),
    [productForConfig, reachableUnits],
  );
  const internalChoices = useMemo(
    () => (productForConfig ? buildUnitChoicesFromEngine(productForConfig, reachableUnits, "internal") : []),
    [productForConfig, reachableUnits],
  );

  // ── Mono-unit normalization ──
  // If ALL choices belong to the same physical family (weight or volume),
  // the product is effectively mono-unit (e.g. kg+g → pick kg, L+ml → pick L).
  // This avoids treating simple weight/volume products as multi-choice.
  const getEffectiveMonoChoice = (choices: UnitChoice[], reachable: ReachableUnit[]): UnitChoice | null => {
    if (choices.length === 0) return null;
    if (choices.length === 1) return choices[0];
    // Check if all choices map to the same physical family
    const families = new Set<string>();
    for (const c of choices) {
      const ru = reachable.find((u) => u.id === c.primaryUnitId);
      if (!ru?.family || (ru.family !== "weight" && ru.family !== "volume")) return null;
      families.add(ru.family);
    }
    if (families.size !== 1) return null;
    // All same physical family → pick first (largest unit by sort order from buildUnitChoicesFromEngine)
    return choices[0];
  };

  const effectiveReceptionMono = getEffectiveMonoChoice(receptionChoices, reachableUnits);
  const effectiveInternalMono = getEffectiveMonoChoice(internalChoices, reachableUnits);
  const isMonoUnit = !!effectiveReceptionMono && !!effectiveInternalMono;
  const canMultiLevel = useMemo(
    () => (productForConfig ? isMultiLevelPossible(productForConfig, reachableUnits) : false),
    [productForConfig, reachableUnits],
  );
  const chainableUnits = useMemo(
    () => (productForConfig ? getChainableUnits(productForConfig, reachableUnits) : []),
    [productForConfig, reachableUnits],
  );

  // ── Local UI state for internal selects (reception is now auto-generated) ──
  // ═══════════════════════════════════════════════════════════════════════════
  // SUPPLIER UNIT V1: Auto-generate reception_* from packaging + toggle
  // ═══════════════════════════════════════════════════════════════════════════
  // The reception config is now auto-generated (read-only) based on the
  // product's physical structure. The resolver is NOT touched — we write
  // the same fields it already reads.

  const autoReceptionConfig = useMemo(() => {
    return buildReceptionConfig(
      wizardState.packagingLevels,
      wizardState.allowUnitSale,
      wizardState.finalUnitId,
      dbUnits,
    );
  }, [wizardState.packagingLevels, wizardState.allowUnitSale, wizardState.finalUnitId, dbUnits]);

  // Push auto-generated reception config to wizard state
  useEffect(() => {
    if (dbUnits.length === 0) return;
    onInputConfigReceptionChange(
      autoReceptionConfig.reception_mode,
      autoReceptionConfig.reception_preferred_unit_id,
      autoReceptionConfig.reception_unit_chain,
      false,
    );
  }, [autoReceptionConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve display labels for auto-generated reception config
  const autoReceptionLabel = useMemo(() => {
    if (autoReceptionConfig.reception_mode === "multi_level" && autoReceptionConfig.reception_unit_chain) {
      const names = autoReceptionConfig.reception_unit_chain.map(
        (id) => dbUnits.find((u) => u.id === id)?.name ?? "?"
      );
      return names.join(" + ");
    }
    if (autoReceptionConfig.reception_preferred_unit_id) {
      return dbUnits.find((u) => u.id === autoReceptionConfig.reception_preferred_unit_id)?.name ?? "?";
    }
    return "—";
  }, [autoReceptionConfig, dbUnits]);

  const autoReceptionModeLabel = autoReceptionConfig.reception_mode === "multi_level"
    ? "Multi-niveaux"
    : autoReceptionConfig.reception_mode === "continuous"
      ? "Stepper (+/-)"
      : "Entier";

  // ── Initialize internal config (unchanged logic) ──
  const [internalType, setInternalType] = useState<SelectionType>("simple");
  const [internalKey, setInternalKey] = useState<string>("");
  const [internalPartial, setInternalPartial] = useState(false);
  const [internalChain, setInternalChain] = useState<string[]>([]);
  const [inputConfigInitialized, setInputConfigInitialized] = useState(false);

  useEffect(() => {
    if (internalChoices.length === 0) return;
    if (inputConfigInitialized) return;

    // Internal config: restore from existing or wizard state or auto-detect
    const savedConfig = existingInputConfig;
    if (savedConfig) {
      if (savedConfig.internal_mode === "multi_level" && savedConfig.internal_unit_chain?.length) {
        setInternalType("multi_level");
        setInternalChain(savedConfig.internal_unit_chain);
        setInternalKey(internalChoices[0]?.key ?? "");
      } else {
        const ic = findChoiceForConfig(internalChoices, savedConfig.internal_mode, savedConfig.internal_preferred_unit_id);
        setInternalKey(ic.key);
      }
      setInternalPartial(savedConfig.internal_mode === "fraction");

      onInputConfigInternalChange(
        savedConfig.internal_mode,
        savedConfig.internal_preferred_unit_id,
        savedConfig.internal_unit_chain,
        savedConfig.internal_mode === "fraction",
      );
    } else if (wizardState.inputConfigInternalMode) {
      if (wizardState.inputConfigInternalChain?.length) {
        setInternalType("multi_level");
        setInternalChain(wizardState.inputConfigInternalChain);
      } else {
        const ic = findChoiceForConfig(
          internalChoices,
          wizardState.inputConfigInternalMode,
          wizardState.inputConfigInternalUnitId,
        );
        setInternalKey(ic.key);
      }
      setInternalPartial(wizardState.inputConfigInternalPartial);
    } else {
      // Default: pick first + auto for mono-unit
      const effectiveMono = getEffectiveMonoChoice(internalChoices, reachableUnits);
      if (effectiveMono) {
        setInternalKey(effectiveMono.key);
        onInputConfigInternalChange(effectiveMono.mode, effectiveMono.primaryUnitId, null, false);
      } else {
        const iChoice = internalChoices[0];
        setInternalKey(iChoice.key);
        onInputConfigInternalChange(iChoice.mode, iChoice.primaryUnitId, null, false);
      }
    }

    setInputConfigInitialized(true);
  }, [internalChoices]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve mode from key + partial
  const resolveMode = (choices: UnitChoice[], key: string, partial: boolean): InputMode => {
    const choice = choices.find((c) => c.key === key) ?? choices[0];
    if (!choice) return "integer";
    if (choice.supportsPartial && partial) return "fraction";
    return choice.mode;
  };

  const selectedInternal = internalChoices.find((c) => c.key === internalKey);

  // Sync local state → wizard state on change (internal only — reception is auto-generated)
  const handleInternalChange = (key: string) => {
    setInternalKey(key);
    const choice = internalChoices.find((c) => c.key === key);
    if (!choice?.supportsPartial) setInternalPartial(false);
    const mode = resolveMode(internalChoices, key, internalPartial);
    onInputConfigInternalChange(mode, choice?.primaryUnitId ?? null, null, internalPartial);
  };

  const handleInternalPartialToggle = (val: boolean) => {
    setInternalPartial(val);
    const mode = resolveMode(internalChoices, internalKey, val);
    onInputConfigInternalChange(mode, selectedInternal?.primaryUnitId ?? null, null, val);
  };

  const handleInternalTypeChange = (t: SelectionType) => {
    setInternalType(t);
    if (t === "multi_level" && internalChain.length === 0 && chainableUnits.length >= 2) {
      const chain = [chainableUnits[0].id, chainableUnits[1].id];
      setInternalChain(chain);
      onInputConfigInternalChange("multi_level", chain[0], chain, false);
    } else if (t === "simple") {
      const mode = resolveMode(internalChoices, internalKey, internalPartial);
      onInputConfigInternalChange(mode, selectedInternal?.primaryUnitId ?? null, null, internalPartial);
    }
  };

  const handleInternalChainChange = (chain: string[]) => {
    setInternalChain(chain);
    onInputConfigInternalChange("multi_level", chain[0] ?? null, chain, false);
  };

  // Filter units: only finalUnit + packaging level units from conditioning
  const stockUnits = useMemo(() => {
    const allowedIds = new Set<string>();
    if (finalUnitId) allowedIds.add(finalUnitId);
    for (const level of packagingLevels) {
      if (level.type_unit_id) allowedIds.add(level.type_unit_id);
    }
    const filtered = allUnits.filter((u) => allowedIds.has(u.id));
    return filtered.length > 0 ? filtered : allUnits;
  }, [allUnits, finalUnitId, packagingLevels]);

  // Auto pre-fill minStockUnitId with finalUnitId on first render if empty
  useEffect(() => {
    if (!minStockUnitId && finalUnitId && stockUnits.some((u) => u.id === finalUnitId)) {
      onMinStockUnitIdChange(finalUnitId);
    }
  }, [finalUnitId, stockUnits]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto pre-fill initialStockUnitId with finalUnitId on first render if empty
  useEffect(() => {
    if (!initialStockUnitId && finalUnitId && stockUnits.some((u) => u.id === finalUnitId)) {
      onInitialStockUnitIdChange(finalUnitId);
    }
  }, [finalUnitId, stockUnits]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCategoryId = categoryId ?? "__empty__";
  const hasCategorySelected = !!categoryId;

  // Warnings
  const minQtyParsed = parseFloat(minStockQuantity);
  const showQtyRequired = minStockQuantity === "";
  const showQtyInvalid = minStockQuantity !== "" && (isNaN(minQtyParsed) || minQtyParsed <= 0);
  const showUnitRequired =
    !!minStockQuantity && !isNaN(minQtyParsed) && minQtyParsed > 0 && !minStockUnitId;
  const showHighThresholdWarning = !isNaN(minQtyParsed) && minQtyParsed > 500;

  // Input config available?
  const hasInputConfigSection = receptionChoices.length > 0 && internalChoices.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
            <BarChart3 className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-center mb-2">Zone & Stock initial</h2>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Configurez la zone, le stock initial, le seuil minimum et les unités de saisie.
          </p>
        </div>

        <div className="max-w-md mx-auto space-y-5">
          {/* 1️⃣ Catégorie — OBLIGATOIRE (sélection par UUID) */}
          <div className="p-4 border rounded-lg space-y-2">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Tag className="h-4 w-4" />
              Catégorie <span className="text-destructive">*</span>
            </Label>
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
              <SelectTrigger className="h-11">
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
            {!hasCategorySelected && (
              <p className="text-xs text-destructive">
                La catégorie est obligatoire pour organiser le produit.
              </p>
            )}
          </div>

          {/* 2️⃣ Zone de stockage — OBLIGATOIRE */}
          <div className="p-4 border rounded-lg space-y-2">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <MapPin className="h-4 w-4" />
              Zone de stockage <span className="text-destructive">*</span>
            </Label>
            <Select
              value={storageZoneId || "__empty__"}
              onValueChange={(value) => onStorageZoneIdChange(value === "__empty__" ? null : value)}
            >
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Sélectionner une zone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty__">— Aucune —</SelectItem>
                {storageZones.map((zone) => (
                  <SelectItem key={zone.id} value={zone.id}>
                    {zone.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!storageZoneId && (
              <p className="text-xs text-destructive">
                La zone de stockage est obligatoire. Sans zone, le produit sera invisible en
                inventaire.
              </p>
            )}
          </div>

          {/* 2.5️⃣ Stock initial — CRÉATION UNIQUEMENT */}
          {!isEditMode && storageZoneId && (
            <div className="p-4 border rounded-lg space-y-2 border-primary/30 bg-primary/5">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <Package className="h-4 w-4" />
                Stock actuel dans cette zone
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0"
                    value={initialStockQuantity}
                    onChange={(e) => onInitialStockQuantityChange(e.target.value)}
                    className="h-11 font-mono"
                  />
                </div>
                <Select
                  value={initialStockUnitId || "__empty__"}
                  onValueChange={(value) =>
                    onInitialStockUnitIdChange(value === "__empty__" ? null : value)
                  }
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Unité" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty__">— Unité —</SelectItem>
                    {stockUnits.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} ({u.abbreviation})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                Quantité actuellement en stock. Pré-rempli à 0.
              </p>
            </div>
          )}

          {/* 3️⃣ Seuil minimum — OBLIGATOIRE */}
          <div className="p-4 border rounded-lg space-y-2">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4" />
              Seuil minimum <span className="text-destructive">*</span>
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Quantité"
                  value={minStockQuantity}
                  onChange={(e) => onMinStockQuantityChange(e.target.value)}
                  className="h-11"
                />
                {showQtyInvalid && (
                  <p className="text-xs text-destructive">Le seuil doit être supérieur à 0.</p>
                )}
              </div>
              <Select
                value={minStockUnitId || "__empty__"}
                onValueChange={(value) =>
                  onMinStockUnitIdChange(value === "__empty__" ? null : value)
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Unité" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__empty__">— Unité —</SelectItem>
                  {stockUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} ({u.abbreviation})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {showQtyRequired && (
              <p className="text-xs text-destructive">Le seuil minimum est obligatoire.</p>
            )}
            {showUnitRequired && (
              <p className="text-xs text-destructive">L'unité est obligatoire pour le seuil.</p>
            )}
            {showHighThresholdWarning && (
              <div className="flex items-center gap-2 p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  Le seuil semble élevé. Vérifiez la cohérence.
                </span>
              </div>
            )}
          </div>

          {/* 4️⃣ Code-barres — OPTIONNEL */}
          <div className="p-4 border rounded-lg space-y-2">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <ScanBarcode className="h-4 w-4" />
              Code-barres <span className="text-muted-foreground text-xs">(optionnel)</span>
            </Label>
            <Input
              placeholder="EAN13 / EAN8"
              value={barcode}
              onChange={(e) => onBarcodeChange(e.target.value)}
              className="h-11"
            />
          </div>

          {/* 5️⃣ Alerte DLC — OPTIONNEL (product-level override) */}
          <div className="p-4 border rounded-lg space-y-2">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <ShieldAlert className="h-4 w-4" />
              Alerte DLC <span className="text-muted-foreground text-xs">(optionnel, jours)</span>
            </Label>
            <Input
              type="number"
              step="1"
              min="0"
              placeholder="Hériter du paramètre global"
              value={dlcWarningDays}
              onChange={(e) => onDlcWarningDaysChange(e.target.value)}
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              Nombre de jours avant expiration pour déclencher l'alerte.
              Si vide, le produit hérite du seuil catégorie ou établissement.
            </p>
          </div>

          {/* 6️⃣ UNITÉS DE SAISIE — SECTION INPUT CONFIG */}
          {hasInputConfigSection && (
            <div className="p-4 border rounded-lg space-y-4 border-primary/30 bg-primary/5">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <Settings2 className="h-4 w-4" />
                Unités de saisie
              </Label>

              {/* ── RECEPTION: Always auto-generated, read-only (Supplier Unit V1) ── */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">À la réception (B2B)</h4>

                {/* Toggle: allow_unit_sale — only visible if packaging exists */}
                {wizardState.hasPackaging && wizardState.packagingLevels.length > 0 && (
                  <div className="flex items-center justify-between py-2 px-3 rounded-lg border border-border bg-background">
                    <div className="space-y-0.5">
                      <span className="text-sm font-medium">Autoriser la vente à l'unité</span>
                      <p className="text-[10px] text-muted-foreground">
                        Permet la saisie sur plusieurs niveaux (ex : Carton + Boîte)
                      </p>
                    </div>
                    <Switch
                      checked={wizardState.allowUnitSale}
                      onCheckedChange={onAllowUnitSaleChange}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between py-2 px-3 rounded-lg border border-border bg-background">
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">{autoReceptionLabel}</span>
                    <p className="text-[10px] text-muted-foreground">{autoReceptionModeLabel}</p>
                  </div>
                  <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Auto
                  </Badge>
                </div>
              </div>

              {/* ── INTERNAL: User-configurable (unchanged) ── */}
              {isMonoUnit ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-muted-foreground">En interne</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{internalChoices[0]?.label}</span>
                      <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Automatique
                      </Badge>
                    </div>
                  </div>
                </div>
              ) : (
                <InputConfigSection
                  title="En interne"
                  selectionType={internalType}
                  onSelectionTypeChange={handleInternalTypeChange}
                  canMultiLevel={canMultiLevel}
                  choices={internalChoices}
                  selectedKey={internalKey}
                  onSelect={handleInternalChange}
                  partial={internalPartial}
                  onPartialChange={handleInternalPartialToggle}
                  showPartialFor={selectedInternal}
                  unitChain={internalChain}
                  onUnitChainChange={handleInternalChainChange}
                  chainableUnits={chainableUnits}
                  prefix="wiz-internal"
                />
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border-t px-6 py-4 flex justify-between">
        <Button variant="outline" onClick={onBack} aria-label="Retour à l'étape précédente">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <Button
          onClick={onNext}
          disabled={!canProceed}
          className="min-w-[120px]"
          aria-label="Aller au récapitulatif"
        >
          Récapitulatif
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// InputConfigSection — Reusable section (same logic as SingleConfigDialog)
// ═══════════════════════════════════════════════════════════════════════════

function InputConfigSection({
  title,
  selectionType,
  onSelectionTypeChange,
  canMultiLevel,
  choices,
  selectedKey,
  onSelect,
  partial,
  onPartialChange,
  showPartialFor,
  unitChain,
  onUnitChainChange,
  chainableUnits,
  prefix,
}: {
  title: string;
  selectionType: SelectionType;
  onSelectionTypeChange: (t: SelectionType) => void;
  canMultiLevel: boolean;
  choices: UnitChoice[];
  selectedKey: string;
  onSelect: (key: string) => void;
  partial: boolean;
  onPartialChange: (v: boolean) => void;
  showPartialFor: UnitChoice | undefined;
  unitChain: string[];
  onUnitChainChange: (chain: string[]) => void;
  chainableUnits: import("@/core/unitConversion").ReachableUnit[];
  prefix: string;
}) {
  if (choices.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h4>

      {/* Selection type toggle */}
      {canMultiLevel && (
        <RadioGroup
          value={selectionType}
          onValueChange={(v) => onSelectionTypeChange(v as SelectionType)}
          className="flex gap-2"
        >
          <Label
            htmlFor={`${prefix}-type-simple`}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer transition-colors flex-1 ${
              selectionType === "simple"
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <RadioGroupItem value="simple" id={`${prefix}-type-simple`} />
            <span className="font-medium">Simple</span>
          </Label>
          <Label
            htmlFor={`${prefix}-type-multi`}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer transition-colors flex-1 ${
              selectionType === "multi_level"
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <RadioGroupItem value="multi_level" id={`${prefix}-type-multi`} />
            <span className="font-medium">Combinée</span>
          </Label>
        </RadioGroup>
      )}

      {/* Simple mode */}
      {selectionType === "simple" && (
        <>
          <Select value={selectedKey} onValueChange={onSelect}>
            <SelectTrigger className="w-full h-10">
              <SelectValue placeholder="Choisir une unité…" />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice.key} value={choice.key}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {showPartialFor?.supportsPartial && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
              <div className="space-y-0.5 flex-1">
                <p className="text-xs font-medium">Quantités partielles ?</p>
                <p className="text-[10px] text-muted-foreground">Permet ¼, ½, ¾</p>
              </div>
              <Switch checked={partial} onCheckedChange={onPartialChange} />
            </div>
          )}
        </>
      )}

      {/* Multi-level mode */}
      {selectionType === "multi_level" && (
        <MultiLevelChainEditor
          unitChain={unitChain}
          onUnitChainChange={onUnitChainChange}
          chainableUnits={chainableUnits}
          prefix={prefix}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MultiLevelChainEditor — Clone from SingleConfigDialog
// ═══════════════════════════════════════════════════════════════════════════

function MultiLevelChainEditor({
  unitChain,
  onUnitChainChange,
  chainableUnits,
  prefix,
}: {
  unitChain: string[];
  onUnitChainChange: (chain: string[]) => void;
  chainableUnits: import("@/core/unitConversion").ReachableUnit[];
  prefix: string;
}) {
  const addLevel = () => {
    const usedIds = new Set(unitChain);
    const next = chainableUnits.find((u) => !usedIds.has(u.id));
    if (next) onUnitChainChange([...unitChain, next.id]);
  };

  const removeLevel = (idx: number) => {
    onUnitChainChange(unitChain.filter((_, i) => i !== idx));
  };

  const updateLevel = (idx: number, newId: string) => {
    const updated = [...unitChain];
    updated[idx] = newId;
    onUnitChainChange(updated);
  };

  return (
    <div className="space-y-2">
      {unitChain.map((unitId, idx) => (
        <div key={`${prefix}-chain-${idx}`} className="flex items-center gap-2">
          <Select
            value={unitId}
            onValueChange={(val) => updateLevel(idx, val)}
          >
            <SelectTrigger className="flex-1 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {chainableUnits.map((cu) => (
                <SelectItem key={cu.id} value={cu.id}>
                  {cu.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {unitChain.length > 2 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => removeLevel(idx)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ))}
      {unitChain.length < chainableUnits.length && (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={addLevel}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Ajouter un niveau
        </Button>
      )}
    </div>
  );
}
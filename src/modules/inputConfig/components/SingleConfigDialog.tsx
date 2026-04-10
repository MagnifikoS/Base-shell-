/**
 * Single product input configuration dialog.
 *
 * ARCHITECTURE: Purely declarative — stores mode + preferred_unit_id + unit_chain.
 * Unit resolution is the engine's job at runtime.
 *
 * UX PRINCIPLE: The user sees UNIT names (kg, pièce, pack),
 * never technical mode names (continuous, integer, fraction, multi_level).
 *
 * Phase A: Multi-level uses dynamic selects (composition libre) instead
 * of pre-calculated combos. unit_chain = ordered array of selected unit IDs.
 */

import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, Scale, Package, Plus, Trash2 } from "lucide-react";
import type { ProductForConfig, InputMode } from "../types";
import {
  buildUnitChoicesFromEngine,
  findChoiceForConfig,
  isMultiLevelPossible,
  getChainableUnits,
} from "../utils/buildUnitChoices";
import type { UnitChoice } from "../utils/buildUnitChoices";
import { useSaveInputConfig } from "../hooks/useSaveInputConfig";
import { useUnitConversions } from "@/core/unitConversion";
import { resolveProductUnitContext } from "@/core/unitConversion/resolveProductUnitContext";
import type { ConditioningConfig } from "@/modules/shared/conditioningTypes";
import type { ReachableUnit } from "@/core/unitConversion";

type SelectionType = "simple" | "multi_level";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductForConfig | null;
}

export function SingleConfigDialog({ open, onOpenChange, product }: Props) {
  const saveMutation = useSaveInputConfig();
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();

  // Resolve engine context for this product (BFS-validated reachable units)
  const engineContext = useMemo(() => {
    if (!product || dbUnits.length === 0) return null;
    return resolveProductUnitContext(
      {
        stock_handling_unit_id: product.stock_handling_unit_id,
        final_unit_id: product.final_unit_id,
        delivery_unit_id: product.delivery_unit_id,
        supplier_billing_unit_id: product.supplier_billing_unit_id,
        conditionnement_config: (product.conditionnement_config_raw as unknown as ConditioningConfig) ?? undefined,
      },
      dbUnits,
      dbConversions,
    );
  }, [product, dbUnits, dbConversions]);

  // Build unit choices from engine output
  const reachableUnits = engineContext?.allowedInventoryEntryUnits ?? [];

  const receptionChoices = useMemo(
    () => (product ? buildUnitChoicesFromEngine(product, reachableUnits, "reception") : []),
    [product, reachableUnits],
  );
  const internalChoices = useMemo(
    () => (product ? buildUnitChoicesFromEngine(product, reachableUnits, "internal") : []),
    [product, reachableUnits],
  );

  // Multi-level availability
  const canMultiLevel = useMemo(
    () => (product ? isMultiLevelPossible(product, reachableUnits) : false),
    [product, reachableUnits],
  );
  const chainableUnits = useMemo(
    () => (product ? getChainableUnits(product, reachableUnits) : []),
    [product, reachableUnits],
  );

  // ── State: Reception ──
  const [receptionType, setReceptionType] = useState<SelectionType>("simple");
  const [receptionKey, setReceptionKey] = useState<string>("");
  const [receptionPartial, setReceptionPartial] = useState(false);
  const [receptionChain, setReceptionChain] = useState<string[]>([]);

  // ── State: Internal ──
  const [internalType, setInternalType] = useState<SelectionType>("simple");
  const [internalKey, setInternalKey] = useState<string>("");
  const [internalPartial, setInternalPartial] = useState(false);
  const [internalChain, setInternalChain] = useState<string[]>([]);

  // Init from existing config or first choice
  useEffect(() => {
    if (!product || receptionChoices.length === 0 || internalChoices.length === 0) return;

    if (product.config) {
      const savedReceptionMode = product.config.reception_mode as InputMode;
      const savedInternalMode = product.config.internal_mode as InputMode;

      // Reception
      if (savedReceptionMode === "multi_level" && product.config.reception_unit_chain?.length) {
        setReceptionType("multi_level");
        setReceptionChain(product.config.reception_unit_chain);
        setReceptionKey(receptionChoices[0]?.key ?? "");
      } else {
        setReceptionType("simple");
        const rc = findChoiceForConfig(
          receptionChoices,
          savedReceptionMode,
          product.config.reception_preferred_unit_id,
        );
        setReceptionKey(rc.key);
        setReceptionChain([]);
      }
      setReceptionPartial(savedReceptionMode === "fraction");

      // Internal
      if (savedInternalMode === "multi_level" && product.config.internal_unit_chain?.length) {
        setInternalType("multi_level");
        setInternalChain(product.config.internal_unit_chain);
        setInternalKey(internalChoices[0]?.key ?? "");
      } else {
        setInternalType("simple");
        const ic = findChoiceForConfig(
          internalChoices,
          savedInternalMode,
          product.config.internal_preferred_unit_id,
        );
        setInternalKey(ic.key);
        setInternalChain([]);
      }
      setInternalPartial(savedInternalMode === "fraction");
    } else {
      setReceptionType("simple");
      setReceptionKey(receptionChoices[0].key);
      setReceptionPartial(false);
      setReceptionChain([]);
      setInternalType("simple");
      setInternalKey(internalChoices[0].key);
      setInternalPartial(false);
      setInternalChain([]);
    }
  }, [product, receptionChoices, internalChoices]);

  // Resolve the actual InputMode from selected choice + partial toggle
  const resolveMode = (choices: UnitChoice[], key: string, partial: boolean): InputMode => {
    const choice = choices.find((c) => c.key === key) ?? choices[0];
    if (!choice) return "integer";
    if (choice.supportsPartial && partial) return "fraction";
    return choice.mode;
  };

  const selectedReception = receptionChoices.find((c) => c.key === receptionKey);
  const selectedInternal = internalChoices.find((c) => c.key === internalKey);

  const handleSave = () => {
    if (!product) return;

    let receptionMode: InputMode;
    let receptionPreferredUnitId: string | null;
    let receptionUnitChain: string[] | null;

    if (receptionType === "multi_level" && receptionChain.length >= 2) {
      receptionMode = "multi_level";
      receptionPreferredUnitId = receptionChain[0]; // fallback compat
      receptionUnitChain = receptionChain;
    } else {
      receptionMode = resolveMode(receptionChoices, receptionKey, receptionPartial);
      receptionPreferredUnitId = selectedReception?.primaryUnitId ?? null;
      receptionUnitChain = null;
      // GUARD: if unit ID is still null, try first choice as fallback
      if (!receptionPreferredUnitId && receptionChoices.length > 0) {
        receptionPreferredUnitId = receptionChoices[0].primaryUnitId;
      }
    }

    let internalMode: InputMode;
    let internalPreferredUnitId: string | null;
    let internalUnitChain: string[] | null;

    if (internalType === "multi_level" && internalChain.length >= 2) {
      internalMode = "multi_level";
      internalPreferredUnitId = internalChain[0]; // fallback compat
      internalUnitChain = internalChain;
    } else {
      internalMode = resolveMode(internalChoices, internalKey, internalPartial);
      internalPreferredUnitId = selectedInternal?.primaryUnitId ?? null;
      internalUnitChain = null;
      // GUARD: if unit ID is still null, try first choice as fallback
      if (!internalPreferredUnitId && internalChoices.length > 0) {
        internalPreferredUnitId = internalChoices[0].primaryUnitId;
      }
    }

    // Build ProductForResolution from ProductForConfig
    const productForResolution = {
      id: product.id,
      nom_produit: product.nom_produit,
      final_unit_id: product.final_unit_id,
      stock_handling_unit_id: product.stock_handling_unit_id,
      delivery_unit_id: product.delivery_unit_id,
      supplier_billing_unit_id: product.supplier_billing_unit_id,
      conditionnement_config: product.conditionnement_config_raw,
    };

    saveMutation.mutate(
      {
        productIds: [product.id],
        reception_mode: receptionMode,
        reception_preferred_unit_id: receptionPreferredUnitId,
        reception_unit_chain: receptionUnitChain,
        internal_mode: internalMode,
        internal_preferred_unit_id: internalPreferredUnitId,
        internal_unit_chain: internalUnitChain,
        validationContext: {
          products: [productForResolution],
          dbUnits,
          dbConversions,
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate uppercase">{product.nom_produit}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2 overflow-y-auto max-h-[60vh]">
          {/* ── Product summary header ── */}
          <ProductSummary product={product} />

          {/* ── Reception section ── */}
          <ConfigSection
            title="Comment saisir à la réception ?"
            selectionType={receptionType}
            onSelectionTypeChange={(t) => {
              setReceptionType(t);
              if (t === "multi_level" && receptionChain.length === 0 && chainableUnits.length >= 2) {
                setReceptionChain([chainableUnits[0].id, chainableUnits[1].id]);
              }
            }}
            canMultiLevel={canMultiLevel}
            choices={receptionChoices}
            selectedKey={receptionKey}
            onSelect={(key) => {
              setReceptionKey(key);
              const newChoice = receptionChoices.find((c) => c.key === key);
              if (!newChoice?.supportsPartial) setReceptionPartial(false);
            }}
            partial={receptionPartial}
            onPartialChange={setReceptionPartial}
            showPartialFor={selectedReception}
            unitChain={receptionChain}
            onUnitChainChange={setReceptionChain}
            chainableUnits={chainableUnits}
            prefix="reception"
          />

          {/* ── Internal section ── */}
          <ConfigSection
            title="Comment saisir en interne ?"
            selectionType={internalType}
            onSelectionTypeChange={(t) => {
              setInternalType(t);
              if (t === "multi_level" && internalChain.length === 0 && chainableUnits.length >= 2) {
                setInternalChain([chainableUnits[0].id, chainableUnits[1].id]);
              }
            }}
            canMultiLevel={canMultiLevel}
            choices={internalChoices}
            selectedKey={internalKey}
            onSelect={(key) => {
              setInternalKey(key);
              const newChoice = internalChoices.find((c) => c.key === key);
              if (!newChoice?.supportsPartial) setInternalPartial(false);
            }}
            partial={internalPartial}
            onPartialChange={setInternalPartial}
            showPartialFor={selectedInternal}
            unitChain={internalChain}
            onUnitChainChange={setInternalChain}
            chainableUnits={chainableUnits}
            prefix="internal"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Product Summary ────────────────────────────────────────

function ProductSummary({ product }: { product: ProductForConfig }) {
  const hasLevels = product.packaging_levels.length > 0;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Unité interne :</span>
        <span className="font-medium">{product.final_unit ?? "—"}</span>
      </div>

      {product.equivalence_display && (
        <div className="flex items-center gap-2 text-sm">
          <Scale className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Équivalence :</span>
          <span className="font-medium">{product.equivalence_display}</span>
        </div>
      )}

      {hasLevels && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Package className="h-3.5 w-3.5" />
            <span>Conditionnement :</span>
          </div>
          <div className="flex flex-wrap items-center gap-1 ml-5">
            {product.packaging_levels.map((lvl, i) => (
              <div key={lvl.id} className="flex items-center gap-1">
                {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground/50" />}
                <span className="text-sm font-medium">
                  {lvl.type}
                  {lvl.containsQuantity != null && (
                    <span className="text-muted-foreground font-normal">
                      {" "}de {lvl.containsQuantity} {lvl.containsUnit}
                    </span>
                  )}
                </span>
              </div>
            ))}
            <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-sm font-medium">{product.final_unit ?? "unité"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Config Section (simple or multi_level) ─────────────────

function ConfigSection({
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
  chainableUnits: ReachableUnit[];
  prefix: string;
}) {
  if (choices.length === 0) return null;

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>

      {/* Selection type toggle — only show if multi_level is possible */}
      {canMultiLevel && (
        <RadioGroup
          value={selectionType}
          onValueChange={(v) => onSelectionTypeChange(v as SelectionType)}
          className="flex gap-3"
        >
          <Label
            htmlFor={`${prefix}-type-simple`}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition-colors flex-1 ${
              selectionType === "simple"
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <RadioGroupItem value="simple" id={`${prefix}-type-simple`} />
            <span className="font-medium">Saisie simple</span>
          </Label>
          <Label
            htmlFor={`${prefix}-type-multi`}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition-colors flex-1 ${
              selectionType === "multi_level"
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <RadioGroupItem value="multi_level" id={`${prefix}-type-multi`} />
            <span className="font-medium">Saisie combinée</span>
          </Label>
        </RadioGroup>
      )}

      {/* ── Simple mode: dropdown select ── */}
      {selectionType === "simple" && (
        <>
          <Select value={selectedKey} onValueChange={onSelect}>
            <SelectTrigger className="w-full">
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

          {/* Partial quantities toggle */}
          {showPartialFor?.supportsPartial && (
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Autoriser les quantités partielles ?</p>
                  <p className="text-xs text-muted-foreground">Permet de saisir ¼, ½, ¾</p>
                </div>
                <Switch
                  checked={partial}
                  onCheckedChange={onPartialChange}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Multi-level mode: dynamic selects ── */}
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

// ─── Multi-level Chain Editor ───────────────────────────────

function MultiLevelChainEditor({
  unitChain,
  onUnitChainChange,
  chainableUnits,
  prefix,
}: {
  unitChain: string[];
  onUnitChainChange: (chain: string[]) => void;
  chainableUnits: ReachableUnit[];
  prefix: string;
}) {
  const selectedIds = new Set(unitChain);

  const handleLevelChange = (index: number, newUnitId: string) => {
    const updated = [...unitChain];
    updated[index] = newUnitId;
    onUnitChainChange(updated);
  };

  const handleAddLevel = () => {
    // Find first unselected unit
    const available = chainableUnits.find((u) => !selectedIds.has(u.id));
    if (available) {
      onUnitChainChange([...unitChain, available.id]);
    }
  };

  const handleRemoveLevel = (index: number) => {
    const updated = unitChain.filter((_, i) => i !== index);
    onUnitChainChange(updated);
  };

  const canAddMore = unitChain.length < chainableUnits.length;

  return (
    <div className="space-y-2">
      {unitChain.map((unitId, index) => {
        // Available options: current selection + unselected units
        const availableForThis = chainableUnits.filter(
          (u) => u.id === unitId || !selectedIds.has(u.id),
        );

        return (
          <div key={`${prefix}-level-${index}`} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 shrink-0">
              Niveau {index + 1}
            </span>
            <Select
              value={unitId}
              onValueChange={(v) => handleLevelChange(index, v)}
            >
              <SelectTrigger className="flex-1 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableForThis.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {unitChain.length > 2 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => handleRemoveLevel(index)}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
          </div>
        );
      })}

      {canAddMore && (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={handleAddLevel}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Ajouter un niveau
        </Button>
      )}

      {/* Chain preview */}
      {unitChain.length >= 2 && (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-muted/40 text-xs text-muted-foreground">
          <span>Saisie :</span>
          {unitChain.map((id, i) => {
            const unit = chainableUnits.find((u) => u.id === id);
            return (
              <span key={id} className="flex items-center gap-1">
                {i > 0 && <ArrowRight className="h-3 w-3" />}
                <span className="font-medium text-foreground">{unit?.name ?? "?"}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Bulk product input configuration dialog.
 *
 * For bulk config, we can't show product-specific unit names since products
 * are heterogeneous. We show simplified generic choices based on the common
 * product natures in the selection.
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import type { ProductForConfig, InputMode } from "../types";
import {
  getAllowedModes,
  getCommonAllowedModes,
  getDefaultModes,
} from "../utils/configLogic";
import { useSaveInputConfig } from "../hooks/useSaveInputConfig";

/** User-facing labels for modes in bulk context (generic, no product-specific unit names) */
function getBulkModeLabel(mode: InputMode): string {
  switch (mode) {
    case "continuous":
      return "Stepper (+/-)";
    case "decimal":
      return "En poids / volume (saisie libre)";
    case "integer":
      return "En unités entières";
    case "fraction":
      return "En unités (avec ¼, ½, ¾)";
    case "multi_level":
      return "Par conditionnement";
  }
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ProductForConfig[];
}

export function BulkConfigDialog({ open, onOpenChange, products }: Props) {
  const saveMutation = useSaveInputConfig();

  const receptionModes = useMemo(
    () => getCommonAllowedModes(products, "reception"),
    [products],
  );
  const internalModes = useMemo(
    () => getCommonAllowedModes(products, "internal"),
    [products],
  );

  const defaults = useMemo(() => {
    if (products.length === 0) return null;
    return getDefaultModes(products[0].unit_family, products[0].packaging_levels_count, products[0].product_nature);
  }, [products]);

  // For bulk, we track mode + partial toggle instead of fraction directly
  const [receptionMode, setReceptionMode] = useState<InputMode>("integer");
  const [internalMode, setInternalMode] = useState<InputMode>("integer");
  const [internalPartial, setInternalPartial] = useState(false);

  useEffect(() => {
    if (defaults) {
      setReceptionMode(defaults.reception_mode === "fraction" ? "integer" : defaults.reception_mode);
      setInternalMode(defaults.internal_mode === "fraction" ? "integer" : defaults.internal_mode);
      setInternalPartial(defaults.internal_mode === "fraction");
    }
  }, [defaults]);

  // Effective mode: integer + partial → fraction
  const effectiveInternalMode: InputMode =
    internalMode === "integer" && internalPartial ? "fraction" : internalMode;

  const compatibleIds = useMemo(() => {
    return products.filter((p) => {
      const recAllowed = getAllowedModes(p.unit_family, p.packaging_levels_count, "reception", p.product_nature);
      const intAllowed = getAllowedModes(p.unit_family, p.packaging_levels_count, "internal", p.product_nature);
      return recAllowed.includes(receptionMode) && intAllowed.includes(effectiveInternalMode);
    });
  }, [products, receptionMode, effectiveInternalMode]);

  const isHeterogeneous = compatibleIds.length < products.length;

  const handleApply = () => {
    if (compatibleIds.length === 0) return;

    saveMutation.mutate(
      {
        productIds: compatibleIds.map((p) => p.id),
        reception_mode: receptionMode,
        reception_preferred_unit_id: null,
        reception_unit_chain: receptionMode === "multi_level" ? [] : null,
        internal_mode: effectiveInternalMode,
        internal_preferred_unit_id: null,
        internal_unit_chain: effectiveInternalMode === "multi_level" ? [] : null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  // Filter out fraction from displayed modes (replaced by partial toggle)
  const displayReceptionModes = (receptionModes ?? ["integer", "continuous", "multi_level"])
    .filter((m) => m !== "fraction");
  const displayInternalModes = (internalModes ?? ["integer", "continuous", "multi_level"])
    .filter((m) => m !== "fraction");

  // Show partial toggle if integer is available in internal context
  const showPartialToggle = internalMode === "integer" &&
    (internalModes ?? []).includes("fraction");

  if (products.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Configurer {products.length} produit{products.length > 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {isHeterogeneous && (
            <Alert variant="default" className="border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <AlertDescription className="text-xs">
                Sélection mixte — la configuration sera appliquée uniquement aux{" "}
                {compatibleIds.length} produit{compatibleIds.length > 1 ? "s" : ""} compatibles.
              </AlertDescription>
            </Alert>
          )}

          {/* Reception */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Comment saisir à la réception ?</h4>
            <RadioGroup
              value={receptionMode}
              onValueChange={(v) => setReceptionMode(v as InputMode)}
              className="space-y-1.5"
            >
              {displayReceptionModes.map((mode) => (
                <Label
                  key={mode}
                  htmlFor={`bulk-reception-${mode}`}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm cursor-pointer transition-colors ${
                    receptionMode === mode
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value={mode} id={`bulk-reception-${mode}`} />
                  <span className="font-medium">{getBulkModeLabel(mode)}</span>
                </Label>
              ))}
            </RadioGroup>
          </div>

          {/* Internal */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Comment saisir en interne ?</h4>
            <RadioGroup
              value={internalMode}
              onValueChange={(v) => {
                setInternalMode(v as InputMode);
                if (v !== "integer") setInternalPartial(false);
              }}
              className="space-y-1.5"
            >
              {displayInternalModes.map((mode) => (
                <Label
                  key={mode}
                  htmlFor={`bulk-internal-${mode}`}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm cursor-pointer transition-colors ${
                    internalMode === mode
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value={mode} id={`bulk-internal-${mode}`} />
                  <span className="font-medium">{getBulkModeLabel(mode)}</span>
                </Label>
              ))}
            </RadioGroup>

            {showPartialToggle && (
              <div className="flex justify-center">
              <div className="inline-flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Autoriser les quantités partielles ?</p>
                  <p className="text-xs text-muted-foreground">Permet de saisir ¼, ½, ¾</p>
                </div>
                <Switch
                  checked={internalPartial}
                  onCheckedChange={setInternalPartial}
                />
              </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={handleApply}
            disabled={compatibleIds.length === 0 || saveMutation.isPending}
          >
            {saveMutation.isPending
              ? "Enregistrement…"
              : `Appliquer à ${compatibleIds.length} produit${compatibleIds.length > 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

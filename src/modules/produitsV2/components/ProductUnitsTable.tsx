/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUCT UNITS TABLE — 5 unit rows (read-only except kitchen)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SSOT (5 lignes):
 *   - delivery_unit_id          → Unité de livraison physique
 *   - supplier_billing_unit_id  → Unité facturée fournisseur
 *   - stock_handling_unit_id    → Unité manipulation stock / inventaire
 *   - final_unit_id             → Unité interne de référence
 *   - kitchen_unit_id           → Unité cuisine (editable with explicit save)
 *
 * No hardcode. No fallback. Null → "—".
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Settings2, Check, ChevronRight } from "lucide-react";
import { useUnits, type UnitItem } from "@/hooks/useUnits";
import { toast } from "sonner";

interface ProductUnitsTableProps {
  deliveryUnitId: string | null;
  supplierBillingUnitId: string | null;
  stockHandlingUnitId: string | null;
  finalUnitId: string | null;
  kitchenUnitId: string | null;
  /** @deprecated PHASE 3: kitchen unit is now Wizard-only */
  onKitchenUnitChange?: (unitId: string | null) => void;
  onOpenWizard?: () => void;
}

interface UnitRow {
  label: string;
  unitId: string | null;
  source: string;
  editable: boolean;
}

function resolveUnitLabel(unitId: string | null, units: UnitItem[]): string | null {
  if (!unitId) return null;
  const u = units.find((u) => u.id === unitId);
  return u ? `${u.name} (${u.abbreviation})` : null;
}

export function ProductUnitsTable({
  deliveryUnitId,
  supplierBillingUnitId,
  stockHandlingUnitId,
  finalUnitId,
  kitchenUnitId,
  onKitchenUnitChange,
  onOpenWizard,
}: ProductUnitsTableProps) {
  const { units, kitchenUnits } = useUnits();

  // Local state for kitchen unit with explicit save
  const [localKitchenUnitId, setLocalKitchenUnitId] = useState<string | null>(kitchenUnitId);
  const hasKitchenChanged = localKitchenUnitId !== kitchenUnitId;

  const handleKitchenSave = () => {
    onKitchenUnitChange(localKitchenUnitId);
    toast.success("Unité cuisine enregistrée");
  };

  const rows: UnitRow[] = [
    {
      label: "Livraison",
      unitId: deliveryUnitId,
      source: "Wizard (livraison)",
      editable: false,
    },
    {
      label: "Facture",
      unitId: supplierBillingUnitId,
      source: "Wizard (facturation)",
      editable: false,
    },
    {
      label: "Stock / Inventaire",
      unitId: stockHandlingUnitId,
      source: "Wizard (stock)",
      editable: false,
    },
    {
      label: "Référence interne",
      unitId: finalUnitId,
      source: "Wizard (unité de gestion)",
      editable: false,
    },
    {
      label: "Cuisine / Recette",
      unitId: kitchenUnitId,
      source: "Wizard (cuisine)",
      editable: false,
    },
  ];

  const [open, setOpen] = useState(false);

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer select-none hover:bg-muted/30 transition-colors rounded-t-lg">
            <CardTitle className="text-base flex items-center gap-2">
              <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
              Unités du produit
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left font-medium px-4 py-2">Usage</th>
                    <th className="text-left font-medium px-4 py-2">Unité</th>
                    <th className="text-left font-medium px-4 py-2 hidden sm:table-cell">Source</th>
                    <th className="text-right font-medium px-4 py-2 w-24">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const resolved = resolveUnitLabel(row.unitId, units);
                    return (
                      <tr key={row.label} className="border-b last:border-b-0">
                        <td className="px-4 py-2.5 font-medium text-foreground">{row.label}</td>
                        <td className="px-4 py-2.5">
                          {row.editable ? (
                            <Select
                              value={localKitchenUnitId ?? "__empty__"}
                              onValueChange={(v) =>
                                setLocalKitchenUnitId(v === "__empty__" ? null : v)
                              }
                            >
                              <SelectTrigger className="h-8 w-48">
                                <SelectValue placeholder="—" />
                              </SelectTrigger>
                              <SelectContent className="bg-background z-50">
                                <SelectItem value="__empty__">—</SelectItem>
                                {kitchenUnits.map((u) => (
                                  <SelectItem key={u.id} value={u.id}>
                                    {u.name} ({u.abbreviation})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : resolved ? (
                            <span className="text-foreground">{resolved}</span>
                          ) : (
                            <span className="text-muted-foreground italic">
                              Non configuré (Wizard)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs hidden sm:table-cell">
                          {row.source}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {row.editable && hasKitchenChanged ? (
                            <Button
                              variant="default"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={handleKitchenSave}
                            >
                              <Check className="h-3 w-3 mr-1" />
                              Valider
                            </Button>
                          ) : !row.editable && !resolved && onOpenWizard ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={onOpenWizard}
                            >
                              <Settings2 className="h-3 w-3 mr-1" />
                              Configurer
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

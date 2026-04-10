/**
 * MODULE ACHAT — Grouped by Supplier (accordion)
 * 
 * Affiche les achats regroupés par fournisseur avec sections collapsibles.
 * Un seul fournisseur ouvert à la fois.
 * Total fournisseur affiché en TTC (calcul UI only).
 */

import { useState, useMemo } from "react";
import { Building2, ChevronDown, Package, Lock } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PurchaseSummaryTable } from "./PurchaseSummaryTable";
import { computeTTC } from "../utils/vatUtils";
import type { MonthlyPurchaseSummary, SupplierPurchaseGroup } from "../types";

interface Props {
  data: MonthlyPurchaseSummary[];
  isLoading: boolean;
  establishmentId: string | undefined;
  yearMonth: string;
}

interface SupplierGroupWithTTC extends SupplierPurchaseGroup {
  total_amount_ttc: number;
}

function buildGroups(data: MonthlyPurchaseSummary[]): SupplierGroupWithTTC[] {
  const map = new Map<string, SupplierGroupWithTTC>();

  for (const item of data) {
    const { ttc } = computeTTC(item.total_amount, item.category, item.supplier_name);
    const existing = map.get(item.supplier_id);
    if (existing) {
      existing.items.push(item);
      existing.total_amount += item.total_amount ?? 0;
      existing.total_amount_ttc += ttc ?? 0;
      existing.product_count += 1;
    } else {
      map.set(item.supplier_id, {
        supplier_id: item.supplier_id,
        supplier_name: item.supplier_name,
        items: [item],
        total_amount: item.total_amount ?? 0,
        total_amount_ttc: ttc ?? 0,
        product_count: 1,
      });
    }
  }

  // Trier fournisseurs par total TTC décroissant
  return [...map.values()].sort((a, b) => b.total_amount_ttc - a.total_amount_ttc);
}

const fmt2 = (v: number) =>
  v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PurchaseSummaryGroupedBySupplier({ data, isLoading, establishmentId, yearMonth }: Props) {
  const [openSupplier, setOpenSupplier] = useState<string | null>(null);

  const groups = useMemo(() => buildGroups(data), [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Chargement...
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Package className="h-12 w-12 mb-4 opacity-50" />
        <p>Aucun achat enregistré pour ce mois</p>
        <p className="text-sm mt-1">Les achats apparaîtront ici après validation des factures dans Vision AI</p>
      </div>
    );
  }

  const grandTotalHT = groups.reduce((s, g) => s + g.total_amount, 0);
  const grandTotalTTC = groups.reduce((s, g) => s + g.total_amount_ttc, 0);
  const totalProducts = groups.reduce((s, g) => s + g.product_count, 0);

  return (
    <div className="space-y-3">
      {/* Résumé global */}
      <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
        <span>{groups.length} fournisseur{groups.length > 1 ? "s" : ""} · {totalProducts} produit{totalProducts > 1 ? "s" : ""}</span>
        <Tooltip>
          <TooltipTrigger className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">HT {fmt2(grandTotalHT)} €</span>
            <span className="font-semibold text-foreground">
              TTC {fmt2(grandTotalTTC)} €
            </span>
            <Lock className="h-3 w-3 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>
            <p>Montant TTC calculé à l'affichage — non enregistré</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {groups.map((group) => {
        const isOpen = openSupplier === group.supplier_id;

        return (
          <Collapsible
            key={group.supplier_id}
            open={isOpen}
            onOpenChange={(open) => setOpenSupplier(open ? group.supplier_id : null)}
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="text-left">
                    <span className="font-medium">{group.supplier_name}</span>
                    <span className="text-sm text-muted-foreground ml-2">
                      {group.product_count} produit{group.product_count > 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-xs text-muted-foreground mr-3">
                      HT {fmt2(group.total_amount)} €
                    </span>
                    <span className="font-semibold text-lg">
                      TTC {fmt2(group.total_amount_ttc)} €
                    </span>
                  </div>
                  <ChevronDown
                    className={`h-5 w-5 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <PurchaseSummaryTable data={group.items} isLoading={false} establishmentId={establishmentId} yearMonth={yearMonth} />
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

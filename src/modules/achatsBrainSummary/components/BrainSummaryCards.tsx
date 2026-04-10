/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BRAIN SUMMARY CARDS — Indicateurs simples (Isolé, supprimable)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Package, Building2, Tag, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { BrainSummaryData } from "../types";

interface BrainSummaryCardsProps {
  data: BrainSummaryData;
}

export function BrainSummaryCards({ data }: BrainSummaryCardsProps) {
  const cards = [
    {
      label: "Produits distincts",
      value: data.totalDistinctProducts,
      icon: Package,
      color: "text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400",
    },
    {
      label: "Fournisseurs actifs",
      value: data.totalDistinctSuppliers,
      icon: Building2,
      color: "text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400",
    },
    {
      label: "Catégorie #1",
      value: data.topCategory ?? "—",
      icon: Tag,
      color: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
    {
      label: "Factures importées",
      value: data.totalImports,
      icon: FileText,
      color: "text-orange-600 bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${card.color}`}>
                <card.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{card.label}</p>
                <p className="text-lg font-semibold text-foreground truncate">
                  {card.value}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

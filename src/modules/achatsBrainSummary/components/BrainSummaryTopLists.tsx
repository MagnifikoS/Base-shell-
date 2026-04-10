/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BRAIN SUMMARY TOP LISTS — Listes Top 5 (Isolé, supprimable)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { TrendingUp, TrendingDown, ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BrainSummaryData, ProductMonthlyAggregate, ProductDelta } from "../types";

interface BrainSummaryTopListsProps {
  data: BrainSummaryData;
}

export function BrainSummaryTopLists({ data }: BrainSummaryTopListsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Produits les plus achetés */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            Produits les plus achetés
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {data.topProducts.length > 0 ? (
            <TopProductsList products={data.topProducts} />
          ) : (
            <EmptyState />
          )}
        </CardContent>
      </Card>

      {/* Plus fortes hausses - seulement si mois précédent dispo */}
      {data.hasPreviousMonth && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Plus fortes hausses
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {data.topIncreases.length > 0 ? (
              <DeltaList deltas={data.topIncreases} type="increase" />
            ) : (
              <p className="text-sm text-muted-foreground">Aucune hausse significative</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Plus fortes baisses - seulement si mois précédent dispo */}
      {data.hasPreviousMonth && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-destructive" />
              Plus fortes baisses
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {data.topDecreases.length > 0 ? (
              <DeltaList deltas={data.topDecreases} type="decrease" />
            ) : (
              <p className="text-sm text-muted-foreground">Aucune baisse significative</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TopProductsList({ products }: { products: ProductMonthlyAggregate[] }) {
  return (
    <ul className="space-y-2">
      {products.map((product, index) => (
        <li 
          key={product.product_id ?? index} 
          className="flex items-center justify-between text-sm"
        >
          <span className="truncate text-foreground" title={product.product_name}>
            {index + 1}. {product.product_name}
          </span>
          <span className="text-muted-foreground shrink-0 ml-2">
            {formatQuantityWithUnit(product.total_quantity, product.billing_unit)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DeltaList({ deltas, type }: { deltas: ProductDelta[]; type: "increase" | "decrease" }) {
  const colorClass = type === "increase" 
    ? "text-emerald-600 dark:text-emerald-400" 
    : "text-destructive";

  return (
    <ul className="space-y-2">
      {deltas.map((delta, index) => (
        <li 
          key={delta.product_id ?? index} 
          className="flex items-center justify-between text-sm"
        >
          <span className="truncate text-foreground" title={delta.product_name}>
            {index + 1}. {delta.product_name}
          </span>
          <span className={`shrink-0 ml-2 font-medium ${colorClass}`}>
            {type === "increase" ? "+" : ""}{formatDelta(delta.delta)} ({formatPercent(delta.delta_percent)})
          </span>
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <p className="text-sm text-muted-foreground">Aucune donnée disponible</p>
  );
}

function formatQuantityWithUnit(qty: number, unit: string | null): string {
  const formattedQty = qty.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return unit ? `${formattedQty} ${unit}` : `${formattedQty} —`;
}

function formatDelta(delta: number): string {
  return delta.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function formatPercent(percent: number): string {
  const sign = percent >= 0 ? "+" : "";
  return `${sign}${percent.toFixed(0)}%`;
}

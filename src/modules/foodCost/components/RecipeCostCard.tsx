/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE FOOD COST — Recipe Cost Card
 * ═══════════════════════════════════════════════════════════════
 */

import type { RecipeCostResult, CostStatus } from "../types";
import { cn } from "@/lib/utils";

interface RecipeCostCardProps {
  name: string;
  typeName: string;
  result: RecipeCostResult | undefined;
}

export function RecipeCostCard({ name, typeName, result }: RecipeCostCardProps) {
  const status = result?.status ?? "vide";
  const hasCost = status === "complet" || status === "partiel";
  const hasPortions = result?.portions != null && result.portions >= 1;
  const hasCostPerPortion = result?.costPerPortion != null;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 transition-all hover:bg-accent/30 hover:border-border
                    shadow-[0_1px_3px_0_hsl(var(--foreground)/0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground truncate">
            {name}
            {hasPortions && (
              <span className="text-muted-foreground font-normal text-sm ml-1.5">
                ({result.portions} portions)
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <p
            className={cn(
              "text-lg font-semibold tabular-nums tracking-tight",
              hasCost ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {hasCost ? `${result.totalCost.toFixed(2)} €` : "— €"}
          </p>
          {hasCostPerPortion && (
            <p className={cn(
              "text-xs tabular-nums",
              status === "partiel"
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground"
            )}>
              {status === "partiel" ? "≈ " : ""}{result.costPerPortion!.toFixed(2)} € / portion
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

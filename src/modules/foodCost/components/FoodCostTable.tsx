/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE FOOD COST — Table view (READ-ONLY, Desktop)
 * ═══════════════════════════════════════════════════════════════
 *
 * Layout:
 *   RECETTE | PORTIONS | COÛT DE REVIENT (Entier · Portion) | PRIX DE VENTE (Entier · Portion) | RATIO
 *
 * Sources of truth (unchanged):
 *   - totalCost / costPerPortion → from engine (foodCostEngine.ts)
 *   - sellingPrice + sellingPriceMode → from recipe (per_recipe | per_portion)
 *   - ratio → from engine
 */

import { cn } from "@/lib/utils";
import type { RecipeCostResult } from "../types";

interface RecipeRow {
  id: string;
  name: string;
  recipe_type_id: string;
  portions: number | null;
  selling_price: number | null;
  selling_price_mode: string;
}

interface FoodCostTableProps {
  recipes: RecipeRow[];
  costResults: Map<string, RecipeCostResult>;
  typeMap: Map<string, string>;
}

/*
 * 8-column grid — compact recipe, wider data cols, separated ratio
 *  1: Recette (shorter to bring data closer)
 *  2: Portions (56px)
 *  3: Coût Entier (104px)
 *  4: Coût Portion (104px)
 *  5: Vente Entier (104px)
 *  6: Vente Portion (104px)
 *  7: spacer (40px)
 *  8: Ratio (80px)
 */
const GRID = "grid grid-cols-[minmax(120px,1fr)_56px_104px_104px_104px_104px_56px_80px]";

export function FoodCostTable({ recipes, costResults }: FoodCostTableProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden
                    shadow-[0_1px_3px_0_hsl(var(--foreground)/0.04)]">

      {/* ── Header ── */}
      <div className="border-b border-border/40">

        {/* Row 1 — Group labels (spans cols 3-4 and 5-6) */}
        <div className={cn(GRID, "px-6")}>
          {/* cols 1-2 empty */}
          <div className="col-span-2 py-3" />

          {/* Coût de revient centered over cols 3-4 */}
          <div className="col-span-2 flex items-end justify-center border-l border-border/20 pt-3 pb-1 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
              Coût de revient
            </span>
          </div>

          {/* Prix de vente centered over cols 5-6 */}
          <div className="col-span-2 flex items-end justify-center border-l border-border/20 pt-3 pb-1 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
              Prix de vente
            </span>
          </div>

          {/* cols 7-8 empty */}
          <div className="col-span-2" />
        </div>

        {/* Row 2 — Column labels */}
        <div className={cn(GRID, "px-6 pb-3 items-center")}>
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Recette
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/45 text-center">
            Port.
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/45 text-center">
            Entier
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/45 text-center">
            Portion
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/45 text-center">
            Entier
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/45 text-center">
            Portion
          </span>
          <div />
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 text-center">
            Ratio
          </span>
        </div>
      </div>

      {/* ── Rows ── */}
      <div className="divide-y divide-border/20">
        {recipes.map((recipe) => {
          const result = costResults.get(recipe.id);
          return (
            <FoodCostRow key={recipe.id} recipe={recipe} result={result} />
          );
        })}
      </div>
    </div>
  );
}

/* ── Helpers ── */

function deriveSellPrices(result: RecipeCostResult | undefined) {
  if (!result) return { sellEntier: null, sellPortion: null };
  const sp = result.sellingPrice;
  const mode = result.sellingPriceMode;
  const portions = result.portions;
  if (sp == null || sp <= 0) return { sellEntier: null, sellPortion: null };
  if (mode === "per_portion") {
    return {
      sellPortion: sp,
      sellEntier: portions != null && portions >= 1 ? sp * portions : null,
    };
  }
  return {
    sellEntier: sp,
    sellPortion: portions != null && portions >= 1 ? sp / portions : null,
  };
}

/* ── Row ── */

function FoodCostRow({
  recipe,
  result,
}: {
  recipe: RecipeRow;
  result: RecipeCostResult | undefined;
}) {
  const status = result?.status ?? "vide";
  const hasCost = status === "complet" || status === "partiel";
  const isPartial = status === "partiel";
  const hasPortions = result?.costPerPortion != null;
  const { sellEntier, sellPortion } = deriveSellPrices(result);
  const prefix = isPartial ? "≈ " : "";

  const numCls = (active: boolean, partial: boolean) =>
    cn(
      "text-[13px] tabular-nums leading-none",
      active
        ? partial
          ? "text-amber-600 dark:text-amber-400 font-medium"
          : "text-foreground font-medium"
        : "text-muted-foreground/25",
    );

  const sellCls = (val: number | null) =>
    cn(
      "text-[13px] tabular-nums leading-none",
      val != null ? "text-foreground font-medium" : "text-muted-foreground/25",
    );

  return (
    <div className={cn(GRID, "items-center px-6 py-4 transition-colors hover:bg-muted/30")}>
      {/* Recette */}
      <div className="min-w-0 pr-2">
        <p className="text-sm font-semibold text-foreground truncate leading-tight">
          {recipe.name}
        </p>
      </div>

      {/* Portions */}
      <div className="text-center">
        <span className="text-xs tabular-nums text-muted-foreground/60">
          {recipe.portions != null && recipe.portions >= 1 ? recipe.portions : "—"}
        </span>
      </div>

      {/* Coût — Entier */}
      <div className="text-center">
        <span className={numCls(hasCost, isPartial)}>
          {hasCost ? `${prefix}${result!.totalCost.toFixed(2)}` : "—"}
        </span>
      </div>

      {/* Coût — Portion */}
      <div className="text-center">
        <span className={numCls(hasPortions, isPartial)}>
          {hasPortions ? `${prefix}${result!.costPerPortion!.toFixed(2)}` : "—"}
        </span>
      </div>

      {/* Vente — Entier */}
      <div className="text-center">
        <span className={sellCls(sellEntier)}>
          {sellEntier != null ? sellEntier.toFixed(2) : "—"}
        </span>
      </div>

      {/* Vente — Portion */}
      <div className="text-center">
        <span className={sellCls(sellPortion)}>
          {sellPortion != null ? sellPortion.toFixed(2) : "—"}
        </span>
      </div>

      {/* Spacer */}
      <div />

      {/* Ratio */}
      <div className="text-center">
        {result?.ratio != null ? (
          <span className="text-[13px] tabular-nums font-bold text-foreground leading-none">
            x{result.ratio.toFixed(1)}
          </span>
        ) : (
          <span className="text-[13px] text-muted-foreground/25 leading-none">—</span>
        )}
      </div>
    </div>
  );
}

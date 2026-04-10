/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE FOOD COST — Mobile detail drawer (READ-ONLY)
 * ═══════════════════════════════════════════════════════════════
 */

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
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

interface Props {
  open: boolean;
  onClose: () => void;
  recipe: RecipeRow | null;
  result: RecipeCostResult | undefined;
  typeName: string | null;
}

function DetailRow({
  label,
  value,
  muted,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-sm tabular-nums font-medium",
          muted && "text-muted-foreground/50",
          accent && "text-amber-600 dark:text-amber-400",
          !muted && !accent && "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function FoodCostMobileDetail({
  open,
  onClose,
  recipe,
  result,
  typeName,
}: Props) {
  if (!recipe) return null;

  const status = result?.status ?? "vide";
  const hasCost = status === "complet" || status === "partiel";
  const isPartial = status === "partiel";
  const prefix = isPartial ? "≈ " : "";

  const portions = result?.portions ?? recipe.portions ?? null;
  const isPortionable = portions != null && portions >= 1;

  const totalCost = hasCost ? result!.totalCost : null;
  const costPerPortion = result?.costPerPortion ?? null;

  const sellingPrice = result?.sellingPrice ?? null;
  const mode = result?.sellingPriceMode ?? "per_recipe";
  const hasPrice = sellingPrice != null && sellingPrice > 0;

  // Derive the "other" selling price for display
  let sellingPriceRecipe: number | null = null;
  let sellingPricePerPortion: number | null = null;

  if (hasPrice && isPortionable) {
    if (mode === "per_portion") {
      sellingPricePerPortion = sellingPrice;
      sellingPriceRecipe = sellingPrice * portions!;
    } else {
      sellingPriceRecipe = sellingPrice;
      sellingPricePerPortion = sellingPrice / portions!;
    }
  } else if (hasPrice) {
    sellingPriceRecipe = sellingPrice;
  }

  const ratio = result?.ratio ?? null;

  const fmt = (v: number | null) => (v != null ? `${prefix}${v.toFixed(2)} €` : "—");

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-1">
          <DrawerTitle className="text-base font-semibold text-foreground">
            {recipe.name}
          </DrawerTitle>
          <div className="flex items-center gap-2 mt-0.5">
            {typeName && (
              <span className="text-xs text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
                {typeName}
              </span>
            )}
            {isPortionable && (
              <span className="text-xs text-muted-foreground">
                {portions} portion{portions! > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </DrawerHeader>

        <div className="px-4 pb-6 pt-2">
          {/* Cost section */}
          <div className="space-y-0 divide-y divide-border/30">
            <DetailRow
              label="Coût recette"
              value={totalCost != null ? `${prefix}${totalCost.toFixed(2)} €` : "—"}
              muted={totalCost == null}
              accent={isPartial && totalCost != null}
            />

            {isPortionable && (
              <DetailRow
                label="Coût / portion"
                value={fmt(costPerPortion)}
                muted={costPerPortion == null}
                accent={isPartial && costPerPortion != null}
              />
            )}
          </div>

          {/* Separator */}
          <div className="h-px bg-border/60 my-3" />

          {/* Selling price section */}
          <div className="space-y-0 divide-y divide-border/30">
            <DetailRow
              label="Prix de vente recette"
              value={sellingPriceRecipe != null ? `${sellingPriceRecipe.toFixed(2)} €` : "—"}
              muted={sellingPriceRecipe == null}
            />

            {isPortionable && (
              <DetailRow
                label="Prix de vente / portion"
                value={
                  sellingPricePerPortion != null
                    ? `${sellingPricePerPortion.toFixed(2)} €`
                    : "—"
                }
                muted={sellingPricePerPortion == null}
              />
            )}
          </div>

          {/* Separator */}
          <div className="h-px bg-border/60 my-3" />

          {/* Ratio */}
          <div className="flex items-center justify-between py-2.5">
            <span className="text-sm font-medium text-muted-foreground">Ratio</span>
            {ratio != null ? (
              <span
                className={cn(
                  "text-lg tabular-nums font-bold",
                  isPartial
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-foreground"
                )}
              >
                {isPartial ? "≈ " : ""}x{ratio.toFixed(1)}
              </span>
            ) : (
              <span className="text-lg text-muted-foreground/40 font-bold">—</span>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODAL — Synthèse Évolution des Prix (THE BRAIN)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Affichage UI-only basé sur brain_events (subject = price_evolution).
 * Aucune écriture, aucun calcul métier, aucune recommandation.
 * 
 * ROLLBACK: Supprimer ce fichier — aucun autre module impacté.
 */

import { Brain, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { PriceEvolutionSynthesis } from "../hooks/usePriceEvolutionEvents";

interface BrainPriceEvolutionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  synthesis: PriceEvolutionSynthesis;
  yearMonth: string;
}

/**
 * Formate le mois pour affichage
 */
function formatMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  const months = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
  ];
  const monthIndex = parseInt(month, 10) - 1;
  return `${months[monthIndex] ?? month} ${year}`;
}

/**
 * Formate un prix avec unité optionnelle
 */
function formatPrice(price: number, unit?: string | null): string {
  const formattedPrice = price.toLocaleString("fr-FR", { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
  return unit ? `${formattedPrice} € / ${unit}` : `${formattedPrice} €`;
}

export function BrainPriceEvolutionModal({
  open,
  onOpenChange,
  synthesis,
  yearMonth,
}: BrainPriceEvolutionModalProps) {
  const {
    summaryText,
    totalProducts,
    stableCount,
    variableCount,
    topVariables,
    topIncreases,
    topDecreases,
  } = synthesis;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <span>Analyse d'évolution des prix — Synthèse</span>
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {formatMonth(yearMonth)}
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6">
            {/* Bloc A — Synthèse texte */}
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-sm leading-relaxed text-foreground">
                {summaryText}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {totalProducts} produit{totalProducts > 1 ? "s" : ""} observé{totalProducts > 1 ? "s" : ""} • {stableCount} stable{stableCount > 1 ? "s" : ""} • {variableCount} variable{variableCount > 1 ? "s" : ""}
              </p>
            </div>

            {/* Bloc B — Produits instables */}
            {topVariables.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    <h3 className="text-sm font-medium">
                      Produits à prix instable ce mois-ci
                    </h3>
                  </div>
                  <ul className="space-y-1.5">
                    {topVariables.map((item) => (
                      <li
                        key={item.productId}
                        className="text-sm text-muted-foreground flex items-center gap-2"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
                        <span className="truncate">{item.productName}</span>
                        <span className="text-xs text-muted-foreground/70 shrink-0">
                          ({formatPrice(item.minPrice, item.billingUnit)} – {formatPrice(item.maxPrice, item.billingUnit)})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {/* Bloc C — Top hausses / baisses */}
            {(topIncreases.length > 0 || topDecreases.length > 0) && (
              <>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  {/* Top hausses */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingUp className="h-4 w-4 text-destructive" />
                      <h3 className="text-sm font-medium">Top hausses</h3>
                    </div>
                    {topIncreases.length > 0 ? (
                      <ul className="space-y-1.5">
                        {topIncreases.map((item) => (
                          <li
                            key={item.productId}
                            className="text-sm text-muted-foreground flex items-center gap-2"
                          >
                            <TrendingUp className="h-3 w-3 text-destructive shrink-0" />
                            <span className="truncate">{item.productName}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        Aucune hausse notable
                      </p>
                    )}
                  </div>

                  {/* Top baisses */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingDown className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-medium">Top baisses</h3>
                    </div>
                    {topDecreases.length > 0 ? (
                      <ul className="space-y-1.5">
                        {topDecreases.map((item) => (
                          <li
                            key={item.productId}
                            className="text-sm text-muted-foreground flex items-center gap-2"
                          >
                            <TrendingDown className="h-3 w-3 text-primary shrink-0" />
                            <span className="truncate">{item.productName}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        Aucune baisse notable
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Message si aucune variation */}
            {topVariables.length === 0 && topIncreases.length === 0 && topDecreases.length === 0 && (
              <>
                <Separator />
                <p className="text-sm text-muted-foreground text-center py-4">
                  Aucune variation significative détectée sur cette période.
                </p>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

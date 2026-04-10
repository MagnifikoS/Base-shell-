/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODAL — Historique des prix d'un produit (Drill-down)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Affichage UI-only basé sur brain_events (subject = price_evolution).
 * Aucune écriture, aucun calcul métier, aucune recommandation.
 *
 * ROLLBACK: Supprimer ce fichier — aucun autre module impacté.
 */

import { TrendingUp, Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProductPriceHistory } from "../hooks/useProductPriceHistory";
import { THE_BRAIN_DISABLED } from "@/modules/theBrain";

interface ProductPriceHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string | null;
  productName: string;
  /** Unité fournisseur résolue (label) */
  billingUnit?: string | null;
}

/**
 * Formate le mois pour affichage (YYYY-MM → "Jan. 2026")
 */
function formatMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  const months = [
    "Jan.",
    "Fév.",
    "Mars",
    "Avr.",
    "Mai",
    "Juin",
    "Juil.",
    "Août",
    "Sept.",
    "Oct.",
    "Nov.",
    "Déc.",
  ];
  const monthIndex = parseInt(month, 10) - 1;
  return `${months[monthIndex] ?? month} ${year}`;
}

/**
 * Formate un prix pour affichage compact
 */
function formatPrice(price: number): string {
  return price.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ProductPriceHistoryModal({
  open,
  onOpenChange,
  productId,
  productName,
  billingUnit,
}: ProductPriceHistoryModalProps) {
  const { data, isLoading } = useProductPriceHistory(productId);

  // Si THE BRAIN est désactivé
  if (THE_BRAIN_DISABLED) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              Évolution des prix
            </DialogTitle>
          </DialogHeader>
          <div className="py-8 text-center text-muted-foreground text-sm">
            <p>Analyse indisponible</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const unitLabel = billingUnit ? `€/${billingUnit}` : "€";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="pb-2">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <TrendingUp className="h-4 w-4 text-primary" />
            {productName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
            <Info className="h-3 w-3" />
            Prix observés sur factures validées
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh]">
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground text-sm">Chargement...</div>
          ) : !data?.isAvailable || data.months.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              <p>Aucune observation pour ce produit</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs font-medium text-muted-foreground w-24">
                    Mois
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground text-right">
                    1er
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground text-right">
                    Dernier
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground text-right">
                    Min
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground text-right">
                    Max
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground text-right w-16">
                    Nb
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.months.map((month) => (
                  <TableRow key={month.yearMonth} className="hover:bg-muted/30">
                    <TableCell className="text-sm font-medium py-2.5 whitespace-nowrap">
                      {formatMonth(month.yearMonth)}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono py-2.5">
                      {formatPrice(month.firstPrice)}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono py-2.5">
                      {formatPrice(month.lastPrice)}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono text-muted-foreground py-2.5">
                      {formatPrice(month.minPrice)}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono text-muted-foreground py-2.5">
                      {formatPrice(month.maxPrice)}
                    </TableCell>
                    <TableCell className="text-sm text-right py-2.5">
                      {month.observationsCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>

        {/* Footer avec unité */}
        {data?.isAvailable && data.months.length > 0 && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground text-right">Prix en {unitLabel}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

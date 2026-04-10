/**
 * PriceChangePopup — Informational dialog shown ONCE per unacked price alert
 * when a product is added to a commande cart.
 *
 * Non-blocking: "OK" dismisses, "Voir l'alerte" navigates to Alertes Prix tab.
 */
import { ArrowUp, ArrowDown, TrendingUp } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { PriceAlert } from "../types";

interface Props {
  alert: PriceAlert | null;
  onDismiss: () => void;
  onViewAlerts?: () => void;
}

export function PriceChangePopup({ alert, onDismiss, onViewAlerts }: Props) {
  if (!alert) return null;

  const isUp = alert.variation_pct > 0;

  return (
    <AlertDialog open={!!alert} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-amber-500" />
            Prix mis à jour
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p className="text-sm text-foreground font-medium">
                {alert.product_name}
              </p>
              <p className="text-xs text-muted-foreground">
                Fournisseur : {alert.supplier_name}
              </p>
              <div className="flex items-center justify-center gap-4 py-2">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Ancien</p>
                  <p className="text-lg tabular-nums font-semibold line-through opacity-60">
                    {alert.old_price.toFixed(2)} €
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Nouveau</p>
                  <p className="text-lg tabular-nums font-semibold">
                    {alert.new_price.toFixed(2)} €
                  </p>
                </div>
                <div className="text-center">
                  <span
                    className={`inline-flex items-center gap-0.5 font-bold text-sm ${
                      isUp ? "text-destructive" : "text-emerald-600"
                    }`}
                  >
                    {isUp ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                    {Math.abs(alert.variation_pct).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row gap-2">
          {onViewAlerts && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onDismiss();
                onViewAlerts();
              }}
            >
              Voir l'alerte
            </Button>
          )}
          <AlertDialogAction onClick={onDismiss}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TOLERANCE WARNING DIALOG — Shared component (Réception + Retrait)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Affiche un warning non-hardcodé quand la quantité sort de la plage de tolérance.
 * Deux actions : Corriger (retour) ou Confirmer quand même.
 */

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";
import type { ToleranceWarning } from "../utils/toleranceCheck";

interface Props {
  open: boolean;
  productName: string;
  warning: ToleranceWarning;
  context: "réception" | "retrait";
  onCorrect: () => void;
  onConfirmAnyway: () => void;
}

export function ToleranceWarningDialog({
  open,
  productName,
  warning,
  context,
  onCorrect,
  onConfirmAnyway,
}: Props) {
  const rangeText = warning.isBelow
    ? `minimum attendu : ${warning.min} ${warning.tolUnitAbbr}`
    : `maximum attendu : ${warning.max} ${warning.tolUnitAbbr}`;

  const verb = context === "réception" ? "reçu" : "sorti";

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500 dark:text-amber-400 shrink-0" />
            Quantité hors tolérance
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p className="font-medium text-foreground">{productName}</p>

              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-1.5 text-left">
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Tolérance :</span>{" "}
                  {warning.min != null && (
                    <>
                      min {warning.min} {warning.tolUnitAbbr}
                    </>
                  )}
                  {warning.min != null && warning.max != null && " / "}
                  {warning.max != null && (
                    <>
                      max {warning.max} {warning.tolUnitAbbr}
                    </>
                  )}
                </p>
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Saisi :</span>{" "}
                  {warning.qtyInTolUnit} {warning.tolUnitAbbr}
                </p>
                {warning.tolUnitAbbr !== warning.canonicalAbbr && (
                  <p className="text-muted-foreground text-xs">
                    = {warning.canonicalTotal} {warning.canonicalAbbr}
                  </p>
                )}
              </div>

              <p className="text-muted-foreground">
                {warning.isBelow
                  ? `La quantité est en dessous du ${rangeText}.`
                  : `La quantité dépasse le ${rangeText}.`}
              </p>

              <p className="font-medium text-foreground">
                Tu confirmes avoir bien {verb} {warning.qtyInTolUnit} {warning.tolUnitAbbr}{" "}
                de {productName} ?
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <AlertDialogCancel onClick={onCorrect} className="w-full">
            Corriger la quantité
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmAnyway} className="w-full">
            Confirmer quand même
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

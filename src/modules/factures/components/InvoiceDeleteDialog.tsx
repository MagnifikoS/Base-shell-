/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE FACTURES — Invoice Delete Dialog (2-Step Confirmation)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Dialog de suppression de facture avec DOUBLE CONFIRMATION.
 * Aligné sur le pattern SupplierDeleteDialog pour la cohérence.
 * 
 * ⚠️ SÉCURITÉ:
 * - Ce dialog est le SEUL point d'entrée autorisé pour deleteInvoice()
 * - La suppression nécessite 2 confirmations explicites
 * - Voir docs/data-deletion-policy.md
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, Trash2, FileText } from "lucide-react";
import type { Invoice } from "../types";

interface InvoiceDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
  onDelete: () => Promise<void>;
}

export function InvoiceDeleteDialog({
  open,
  onOpenChange,
  invoice,
  onDelete,
}: InvoiceDeleteDialogProps) {
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleClose = (newOpen: boolean) => {
    if (!newOpen) {
      setShowFinalConfirm(false);
    }
    onOpenChange(newOpen);
  };

  const handleFinalDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
      handleClose(false);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!invoice) return null;

  const formattedDate = new Date(invoice.invoice_date).toLocaleDateString("fr-FR");
  const formattedAmount = invoice.amount_eur.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 2: Confirmation finale (suppression définitive)
  // ═══════════════════════════════════════════════════════════════════════════
  if (showFinalConfirm) {
    return (
      <AlertDialog open={open} onOpenChange={handleClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Suppression définitive
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Cette action est <strong className="text-foreground">IRRÉVERSIBLE</strong>.
                </p>
                <p>Vous allez supprimer définitivement :</p>
                <ul className="list-disc list-inside text-sm space-y-1 bg-muted/50 p-3 rounded-lg">
                  <li>
                    Facture <strong className="text-foreground">{invoice.invoice_number || "—"}</strong>
                  </li>
                  <li>Date : {formattedDate}</li>
                  <li>Montant : {formattedAmount}</li>
                  <li>Le fichier PDF associé</li>
                </ul>
                <p className="font-medium text-foreground pt-2">
                  Êtes-vous absolument sûr ?
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={() => setShowFinalConfirm(false)}
              disabled={isDeleting}
            >
              Annuler
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleFinalDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Supprimer définitivement
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 1: Première confirmation (vérification des informations)
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Supprimer cette facture ?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>Vérifiez les informations de la facture à supprimer :</p>
              <div className="bg-muted/50 p-3 rounded-lg space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">Référence :</span>{" "}
                  <strong className="text-foreground">{invoice.invoice_number || "—"}</strong>
                </p>
                <p>
                  <span className="text-muted-foreground">Date :</span>{" "}
                  <span className="text-foreground">{formattedDate}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Montant :</span>{" "}
                  <span className="text-foreground font-medium">{formattedAmount}</span>
                </p>
              </div>
              <div className="flex items-start gap-2 text-sm text-warning bg-warning/10 p-3 rounded-lg">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  La suppression est définitive. Le fichier PDF sera également supprimé.
                </span>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          {/* IMPORTANT: ne pas utiliser AlertDialogAction ici (ferme le dialog automatiquement) */}
          <Button
            type="button"
            variant="destructive"
            onClick={() => setShowFinalConfirm(true)}
          >
            Continuer
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

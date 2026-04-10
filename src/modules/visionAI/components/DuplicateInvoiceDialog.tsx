import * as React from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, FileText, X, Eye, RefreshCw } from "lucide-react";
import type { DuplicateInvoiceResult } from "@/modules/analyseFacture";

interface DuplicateInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  duplicateResult: DuplicateInvoiceResult | null;
  /** Called when user wants to import a different invoice (triggers file picker) */
  onImportNew?: () => void;
  /** Called when user wants to continue and review the extraction results */
  onContinueReview?: () => void;
  /** Called when user wants to replace the existing invoice with the new extraction */
  onReplace?: () => void;
}

/**
 * Popup affiché quand une facture doublon est détectée.
 *
 * Actions disponibles:
 * - "Voir l'extraction" → dismiss popup, continue to review extracted data
 * - "Remplacer" → delete old invoice, save new one
 * - "Importer autre facture" → reset + file picker
 * - Croix (X) → ferme le popup
 */
export const DuplicateInvoiceDialog = React.forwardRef<HTMLDivElement, DuplicateInvoiceDialogProps>(
  function DuplicateInvoiceDialog(
    { open, onOpenChange, duplicateResult, onImportNew, onContinueReview, onReplace },
    _ref
  ) {
    // Only show if check was performed AND duplicate confirmed
    if (duplicateResult?.status !== "checked" || duplicateResult?.isDuplicate !== true) return null;

    const handleClose = () => {
      onOpenChange(false);
    };

    const handleImportNew = () => {
      onImportNew?.();
      onOpenChange(false);
    };

    const handleContinueReview = () => {
      onContinueReview?.();
      onOpenChange(false);
    };

    const handleReplace = () => {
      onReplace?.();
      onOpenChange(false);
    };

    const getReasonLabel = (reason: string | null): string => {
      switch (reason) {
        case "exact_match":
          return "Correspondance exacte";
        case "robust_match":
          return "Correspondance forte";
        case "fuzzy_match":
          return "Correspondance probable";
        default:
          return "Doublon détecté";
      }
    };

    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        {/* Overlay opaque pour masquer le contenu derrière */}
        <div className="fixed inset-0 bg-background z-[70]" aria-hidden="true" />
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
          <div className="relative">
            {/* Close button (X) */}
            <button
              type="button"
              className="absolute top-4 right-4 z-10 h-7 w-7 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
              onClick={handleClose}
              aria-label="Fermer"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>

            <AlertDialogHeader>
              <div className="flex items-center gap-3 mb-2 pr-8">
                <div className="h-12 w-12 rounded-full bg-warning/20 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="h-6 w-6 text-warning" />
                </div>
                <AlertDialogTitle className="text-xl">Facture déjà importée</AlertDialogTitle>
              </div>
              <AlertDialogDescription asChild>
                <div className="text-base pt-2 space-y-3">
                  <p>Cette facture semble déjà exister dans votre base.</p>

                  <div className="bg-muted p-3 rounded-lg space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {getReasonLabel(duplicateResult.reason)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground font-medium">
                      {duplicateResult.explanation}
                    </p>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Vous pouvez voir l'extraction, remplacer l'ancienne facture, ou importer un
                    autre fichier.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter className="mt-4 flex-col gap-2 sm:flex-col">
              {/* Primary: Continue to review the extraction */}
              {onContinueReview && (
                <Button onClick={handleContinueReview} className="w-full gap-2">
                  <Eye className="h-4 w-4" />
                  Voir l'extraction
                </Button>
              )}

              {/* Replace the existing invoice */}
              {onReplace && (
                <Button onClick={handleReplace} variant="outline" className="w-full gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Remplacer l'ancienne facture
                </Button>
              )}

              {/* Import a different file */}
              <Button
                onClick={handleImportNew}
                variant="ghost"
                className="w-full gap-2 text-muted-foreground"
              >
                <FileText className="h-4 w-4" />
                Importer autre facture
              </Button>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
);

DuplicateInvoiceDialog.displayName = "DuplicateInvoiceDialog";

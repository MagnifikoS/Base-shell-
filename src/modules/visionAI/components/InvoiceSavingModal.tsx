/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — InvoiceSavingModal (Step 3 of 3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Progress modal displayed during invoice save operation.
 *
 * STATES:
 * - uploading: PDF upload to storage
 * - saving: Invoice creation in DB
 * - success: Check mark + done
 * - error: Error message + Retry/Cancel buttons
 *
 * IMPORTANT: This modal does NOT trigger the save — it only displays status.
 * The actual save is triggered by VisionAI.tsx via validateRequestId.
 */

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, Upload, Database } from "lucide-react";

export type InvoiceSavingStatus = "idle" | "uploading" | "saving" | "success" | "error";

interface InvoiceSavingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: InvoiceSavingStatus;
  errorMessage?: string;
  invoiceNumber?: string | null;
  supplierName?: string | null;
  /** Retry the save operation */
  onRetry: () => void;
  /** Cancel and return to products modal (don't lose data) */
  onCancel: () => void;
  /** Close after success (triggers fullReset) */
  onSuccess: () => void;
}

export function InvoiceSavingModal({
  open,
  onOpenChange: _onOpenChange,
  status,
  errorMessage,
  invoiceNumber,
  supplierName,
  onRetry,
  onCancel,
  onSuccess,
}: InvoiceSavingModalProps) {
  // Don't allow closing during active operations
  const canClose = status === "success" || status === "error";

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && canClose) {
      if (status === "success") {
        onSuccess();
      } else {
        onCancel();
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden border-0">
        <div className="flex flex-col items-center justify-center py-12 px-8 text-center">
          {/* UPLOADING STATE */}
          {status === "uploading" && (
            <>
              <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                <Upload className="h-10 w-10 text-primary animate-pulse" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">Envoi du document...</h2>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Upload en cours</span>
              </div>
            </>
          )}

          {/* SAVING STATE */}
          {status === "saving" && (
            <>
              <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                <Database className="h-10 w-10 text-primary animate-pulse" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">Enregistrement...</h2>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Création de la facture</span>
              </div>
            </>
          )}

          {/* SUCCESS STATE */}
          {status === "success" && (
            <>
              <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                <CheckCircle2 className="h-14 w-14 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Facture enregistrée</h2>
              <p className="text-muted-foreground mb-1">
                {invoiceNumber && (
                  <span className="font-medium text-foreground">{invoiceNumber}</span>
                )}
                {invoiceNumber && supplierName && " • "}
                {supplierName && <span>{supplierName}</span>}
              </p>
              <p className="text-sm text-muted-foreground mb-8">
                La facture a été archivée avec succès.
              </p>
              <Button onClick={onSuccess} size="lg" className="w-full max-w-xs">
                Continuer
              </Button>
            </>
          )}

          {/* ERROR STATE */}
          {status === "error" && (
            <>
              <div className="h-24 w-24 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
                <XCircle className="h-14 w-14 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Erreur d'enregistrement
              </h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                {errorMessage || "Une erreur est survenue lors de l'enregistrement de la facture."}
              </p>
              <div className="flex flex-col gap-2 w-full max-w-xs">
                <Button onClick={onRetry} size="lg">
                  Réessayer
                </Button>
                <Button onClick={onCancel} variant="outline" size="lg">
                  Annuler
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

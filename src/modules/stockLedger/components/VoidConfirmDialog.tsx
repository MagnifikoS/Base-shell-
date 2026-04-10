/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VOID CONFIRM DIALOG — Confirmation before voiding a POSTED document
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  open: boolean;
  onClose: () => void;
  documentType: string;
  linesCount: number;
  isVoiding: boolean;
  onConfirm: (reason: string) => void;
}

export function VoidConfirmDialog({
  open,
  onClose,
  documentType,
  linesCount,
  isVoiding,
  onConfirm,
}: Props) {
  const [reason, setReason] = useState("");

  const handleConfirm = () => {
    if (!reason.trim()) return;
    onConfirm(reason.trim());
  };

  const label =
    documentType === "RECEIPT"
      ? "réception"
      : documentType === "WITHDRAWAL"
        ? "retrait"
        : "document";

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Annuler cette {label} ?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Cette action créera des mouvements inverses pour annuler les{" "}
                <strong>{linesCount} ligne(s)</strong> de cette {label}. Le stock estimé sera
                recalculé.
              </p>
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">
                  Motif d'annulation (obligatoire) :
                </p>
                <Textarea
                  placeholder="Ex: Erreur de saisie, livraison retournée..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isVoiding}>Retour</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isVoiding || !reason.trim()}
          >
            {isVoiding && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Confirmer l'annulation
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

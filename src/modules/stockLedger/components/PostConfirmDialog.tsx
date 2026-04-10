/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST CONFIRM DIALOG — Confirmation before posting + error display
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Handles:
 * - Standard confirmation with recap
 * - LOCK_CONFLICT → reload message
 * - NO_ACTIVE_SNAPSHOT → inventory message
 * - Other errors → actionable message
 *
 * STOCK ZERO V1: NEGATIVE_STOCK flow removed — backend clamps silently.
 * ═══════════════════════════════════════════════════════════════════════════
 */

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
import type { PostResult, PostError } from "../hooks/usePostDocument";

// ═══════════════════════════════════════════════════════════════════════════
// RPC ERROR → Actionable message mapping
// ═══════════════════════════════════════════════════════════════════════════

function getActionableErrorMessage(postError: PostResult): string {
  const errorCode = postError.error as PostError | undefined;
  const guard = (postError.details?.guard as string | undefined) ?? errorCode;
  const rawMessage = postError.details?.message as string | undefined;

  switch (guard) {
    case "NO_ACTIVE_SNAPSHOT":
    case "NO_ACTIVE_SNAPSHOT_FOR_PRODUCT_ZONE":
      return "Pas d'inventaire de référence pour la zone du produit. Effectuez un inventaire physique d'abord.";
    case "PRODUCT_NO_ZONE":
      return "Un ou plusieurs produits n'ont pas de zone de stockage assignée. Configurez-les dans le catalogue produits (Wizard).";
    case "FAMILY_MISMATCH":
      return "Incompatibilité d'unité pour un produit. L'unité a changé depuis le dernier inventaire. Reconfigurez le produit et refaites l'inventaire.";
    case "LOCK_CONFLICT":
      return "Le document a été modifié par un autre utilisateur. Fermez cette fenêtre et rechargez la page.";
    case "NO_LINES":
      return "Le document ne contient aucune ligne. Ajoutez au moins un produit avant de poster.";
    case "NOT_DRAFT":
      return "Ce document a déjà été posté ou annulé. Rechargez la page.";
    case "DOCUMENT_NOT_FOUND":
      return "Le document est introuvable. Il a peut-être été supprimé.";
    default:
      return rawMessage
        ? `Erreur technique : ${rawMessage}`
        : "Erreur lors de la validation. Vérifiez la configuration des produits et zones.";
  }
}

interface CartRecapLine {
  product_name: string;
  quantity: number;
  unit_label: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  linesCount: number;
  zoneName: string;
  supplierName?: string;
  documentType?: "RECEIPT" | "WITHDRAWAL" | "ADJUSTMENT";
  isPosting: boolean;
  postError: PostResult | null;
  onConfirm: () => void;
  /** @deprecated Stock Zéro Simple V2 — no longer used */
  onForceOverride?: (reason: string) => void;
  /** For recap mode — lines to display */
  cartLines?: CartRecapLine[];
}

export function PostConfirmDialog({
  open,
  onClose,
  linesCount,
  zoneName,
  supplierName,
  documentType,
  isPosting,
  postError,
  onConfirm,
  cartLines,
}: Props) {
  // STOCK ZERO V1: No more NEGATIVE_STOCK override flow
  // Any non-null error = blocking error (no confirm button)
  const isBlockingError = postError != null && postError.error !== undefined;


  // Lines to display in recap
  const recapLines = cartLines ?? [];

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isBlockingError ? (
              <span className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Erreur de validation
              </span>
            ) : documentType === "WITHDRAWAL" ? (
              "Confirmer le retrait ?"
            ) : (
              `Confirmer la réception${supplierName ? ` de ${supplierName}` : ""} ?`
            )}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {isBlockingError && postError ? (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500 dark:text-amber-400 mt-0.5 shrink-0" />
                  <p>{getActionableErrorMessage(postError)}</p>
                </div>
              ) : (
                <p>
                  Vous allez poster <strong>{linesCount} ligne(s)</strong>
                  {supplierName && (
                    <>
                      {" "}
                      pour le fournisseur <strong>{supplierName}</strong>
                    </>
                  )}{" "}
                  dans la zone <strong>{zoneName}</strong>. Cette action est irréversible
                  (correction possible via annulation).
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPosting}>Annuler</AlertDialogCancel>
          {isBlockingError ? null : (
            <Button onClick={onConfirm} disabled={isPosting}>
              {isPosting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Confirmer
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

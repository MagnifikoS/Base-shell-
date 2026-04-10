/**
 * Confirmation dialog for deleting a badge event
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";

interface BadgeDeleteConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isDeleting: boolean;
  employeeName: string;
  eventType: "clock_in" | "clock_out" | "reset_day";
  time: string;
}

export function BadgeDeleteConfirm({
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
  employeeName,
  eventType,
  time,
}: BadgeDeleteConfirmProps) {
  const isResetDay = eventType === "reset_day";
  const eventLabel = isResetDay 
    ? "tous les pointages" 
    : eventType === "clock_in" 
      ? "l'arrivée" 
      : "le départ";

  const title = isResetDay ? "Réinitialiser la badgeuse ?" : "Supprimer le pointage ?";
  const description = isResetDay
    ? <>Vous allez supprimer <strong>{time}</strong> de <strong>{employeeName}</strong> pour aujourd'hui.<br /><br />Le salarié pourra re-badger après réinitialisation.</>
    : <>Vous allez supprimer {eventLabel} de <strong>{employeeName}</strong> à <strong>{time}</strong>.<br /><br />Le salarié pourra re-badger après suppression.</>;
  const buttonLabel = isResetDay ? "Réinitialiser" : "Supprimer";
  const loadingLabel = isResetDay ? "Réinitialisation..." : "Suppression...";
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[90vw] rounded-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {loadingLabel}
              </>
            ) : (
              buttonLabel
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

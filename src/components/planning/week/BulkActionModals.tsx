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
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

// ============================================================================
// Delete Week Confirm Modal
// ============================================================================

interface DeleteWeekConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
  hasValidatedDays: boolean;
}

export function DeleteWeekConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
  hasValidatedDays,
}: DeleteWeekConfirmModalProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer la semaine</AlertDialogTitle>
          <AlertDialogDescription>
            {hasValidatedDays ? (
              <>
                Certains jours sont validés et ne seront pas affectés.
                <br />
                Seuls les shifts et congés (repos, CP, absences) des jours <strong>non validés</strong> seront supprimés.
              </>
            ) : (
              <>
                Tous les shifts et congés (repos, CP, absences) de cette semaine seront supprimés.
                <br />
                Cette action est irréversible.
              </>
            )}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Supprimer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ============================================================================
// Delete Employee Row Confirm Modal
// ============================================================================

interface DeleteEmployeeRowConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
  employeeName: string;
  hasValidatedDays: boolean;
}

export function DeleteEmployeeRowConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
  employeeName,
  hasValidatedDays,
}: DeleteEmployeeRowConfirmModalProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer les shifts de {employeeName}</AlertDialogTitle>
          <AlertDialogDescription>
            {hasValidatedDays ? (
              <>
                Certains jours sont validés et ne seront pas affectés.
                <br />
                Seuls les shifts des jours <strong>non validés</strong> de {employeeName} seront supprimés.
              </>
            ) : (
              <>
                Tous les shifts de {employeeName} pour cette semaine seront supprimés.
                <br />
                Cette action est irréversible.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Supprimer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ============================================================================
// Copy Previous Week Modal
// ============================================================================

interface CopyPreviousWeekModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mode: "merge" | "replace") => void;
  isLoading: boolean;
  employeeName: string;
}

export function CopyPreviousWeekModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
  employeeName,
}: CopyPreviousWeekModalProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Copier la semaine précédente</AlertDialogTitle>
          <AlertDialogDescription>
            Les shifts de {employeeName} de la semaine précédente seront copiés vers cette semaine.
            <br />
            <strong>Remplacer</strong> : supprime d'abord les shifts existants.
            <br />
            <strong>Fusionner</strong> : garde les jours avec des shifts, ne remplit que les vides.
            <br />
            <br />
            Les jours avec congé/absence seront ignorés.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:flex-row sm:justify-end gap-2">
          <AlertDialogCancel disabled={isLoading}>Annuler</AlertDialogCancel>
          <Button
            variant="outline"
            onClick={() => onConfirm("merge")}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Fusionner
          </Button>
          <Button
            variant="default"
            onClick={() => onConfirm("replace")}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Remplacer
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

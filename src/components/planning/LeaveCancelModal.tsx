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
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

interface LeaveCancelModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeName: string;
  date: string;
  leaveType: "cp" | "absence" | "rest" | "am";
  onConfirm: () => void;
  isLoading?: boolean;
}

export function LeaveCancelModal({
  isOpen,
  onClose,
  employeeName,
  date,
  leaveType,
  onConfirm,
  isLoading = false,
}: LeaveCancelModalProps) {
  const formattedDate = date ? format(parseISO(date), "EEEE d MMMM yyyy", { locale: fr }) : "";

  const typeLabel = leaveType === "cp" ? "Congé payé" : leaveType === "rest" ? "Repos" : leaveType === "am" ? "Arrêt maladie" : "Absence";

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Annuler {typeLabel} ?</AlertDialogTitle>
          <AlertDialogDescription>
            Voulez-vous annuler le {typeLabel.toLowerCase()} de <strong>{employeeName}</strong> pour
            le <strong className="capitalize">{formattedDate}</strong> ?
            <br />
            <br />
            Cette action permettra de planifier un shift sur ce jour.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Non, garder</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isLoading}>
            {isLoading ? "Annulation..." : "Oui, annuler le " + typeLabel.toLowerCase()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

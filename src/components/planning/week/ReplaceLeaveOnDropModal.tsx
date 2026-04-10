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

interface ReplaceLeaveOnDropModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  leaveType: "cp" | "absence" | "rest" | "am";
  employeeName: string;
  date: string;
  isLoading?: boolean;
}

export function ReplaceLeaveOnDropModal({
  isOpen,
  onClose,
  onConfirm,
  leaveType,
  employeeName,
  date,
  isLoading = false,
}: ReplaceLeaveOnDropModalProps) {
  const leaveLabel = leaveType === "cp" ? "CP" : leaveType === "rest" ? "Repos" : leaveType === "am" ? "AM" : "Absence";
  
  // Format date for display
  const formattedDate = new Date(date + "T00:00:00").toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remplacer {leaveLabel} ?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>{employeeName}</strong> a un <strong>{leaveLabel}</strong> marqué le{" "}
            <strong>{formattedDate}</strong>.
            <br />
            <br />
            Voulez-vous annuler le {leaveLabel} et créer le shift à la place ?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isLoading}>
            {isLoading ? "En cours..." : `Remplacer et créer le shift`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

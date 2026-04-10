import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface SuspendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: (endDate: string) => void;
}

export function SuspendDialog({
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: SuspendDialogProps) {
  const [endDate, setEndDate] = useState("");

  const handleConfirm = () => {
    if (!endDate) {
      toast.error("La date de fin de contrat est requise");
      return;
    }
    onConfirm(endDate);
  };

  // Reset date when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setEndDate("");
    }
    onOpenChange(newOpen);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Fin de contrat</AlertDialogTitle>
          <AlertDialogDescription>
            Cette action va suspendre l'accès du salarié à l'application. Vous pourrez le
            réintégrer ultérieurement si nécessaire.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-4">
          <Label htmlFor="suspend_end_date">Date de fin de contrat *</Label>
          <Input
            id="suspend_end_date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-2"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isPending || !endDate}
            className="bg-destructive hover:bg-destructive/90"
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmer la fin de contrat
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

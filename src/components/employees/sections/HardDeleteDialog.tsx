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
import { Loader2, AlertTriangle } from "lucide-react";

interface HardDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  employeeName: string;
  onConfirm: () => void;
}

const CONFIRM_TEXT = "SUPPRIMER";

export function HardDeleteDialog({
  open,
  onOpenChange,
  isPending,
  employeeName,
  onConfirm,
}: HardDeleteDialogProps) {
  const [confirmInput, setConfirmInput] = useState("");

  const isConfirmValid = confirmInput === CONFIRM_TEXT;

  const handleConfirm = () => {
    if (!isConfirmValid) return;
    onConfirm();
  };

  // Reset input when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setConfirmInput("");
    }
    onOpenChange(newOpen);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Suppression définitive (RGPD)
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>
              Vous êtes sur le point de supprimer <strong>définitivement</strong> toutes les données RH de{" "}
              <strong>{employeeName || "ce salarié"}</strong>.
            </p>
            <p className="text-destructive font-medium">
              Cette action est irréversible. Seront supprimés :
            </p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>Tous les documents (fichiers et métadonnées)</li>
              <li>Toutes les informations RH (contrat, salaire, coordonnées)</li>
            </ul>
            <p className="text-sm text-muted-foreground mt-2">
              Note : Le compte utilisateur ne sera pas supprimé.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-4">
          <Label htmlFor="confirm_delete">
            Tapez <strong>{CONFIRM_TEXT}</strong> pour confirmer
          </Label>
          <Input
            id="confirm_delete"
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={CONFIRM_TEXT}
            className="mt-2"
            autoComplete="off"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isPending || !isConfirmValid}
            className="bg-destructive hover:bg-destructive/90"
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Supprimer définitivement
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

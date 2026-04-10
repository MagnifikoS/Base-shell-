/**
 * ResumeOrNewDraftDialog — Asks user to resume existing draft or start fresh
 */

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FileEdit, Plus } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onResume: () => void;
  onNewFromScratch: () => void;
  supplierName: string;
}

export function ResumeOrNewDraftDialog({
  open,
  onClose,
  onResume,
  onNewFromScratch,
  supplierName,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Brouillon en cours</AlertDialogTitle>
          <AlertDialogDescription>
            Vous avez déjà une commande en brouillon
            {supplierName ? ` pour ${supplierName}` : ""}.
            Souhaitez-vous la reprendre ou en créer une nouvelle ?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onNewFromScratch} className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Nouvelle commande
          </Button>
          <Button onClick={onResume} className="flex items-center gap-2">
            <FileEdit className="h-4 w-4" />
            Reprendre le brouillon
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

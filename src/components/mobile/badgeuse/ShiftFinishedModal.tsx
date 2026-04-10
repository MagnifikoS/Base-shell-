import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Clock, CalendarClock } from "lucide-react";

interface ShiftFinishedModalProps {
  nextShift: { start_time: string; end_time: string; sequence_index: number } | null;
  onClose: () => void;
}

/**
 * Modal displayed when user attempts to clock in after their shift has ended.
 * Shows next shift info if available.
 */
export function ShiftFinishedModal({ nextShift, onClose }: ShiftFinishedModalProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="rounded-2xl max-w-sm p-0 gap-0">
        {/* Header */}
        <DialogHeader className="p-4 border-b border-border space-y-0">
          <div className="flex items-center gap-2 text-destructive">
            <Clock className="h-5 w-5" />
            <DialogTitle className="text-base font-semibold">Shift terminé</DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            Votre shift est terminé, pointage impossible
          </DialogDescription>
        </DialogHeader>

        {/* Content */}
        <div className="p-6 text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <Clock className="h-8 w-8 text-destructive" />
          </div>

          <div>
            <p className="text-lg font-medium">Votre shift est déjà terminé</p>
            <p className="text-sm text-muted-foreground mt-2">
              Il n'est plus possible de pointer l'arrivée pour ce shift.
            </p>
          </div>

          {/* Next shift info */}
          {nextShift && (
            <div className="bg-muted/50 rounded-lg p-4 flex items-center gap-3">
              <CalendarClock className="h-5 w-5 text-primary shrink-0" />
              <div className="text-left">
                <p className="text-sm font-medium">Prochain shift</p>
                <p className="text-sm text-muted-foreground">
                  {nextShift.start_time} - {nextShift.end_time}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <DialogFooter className="p-4 border-t border-border sm:justify-center">
          <Button className="w-full" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

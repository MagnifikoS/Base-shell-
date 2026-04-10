import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Clock } from "lucide-react";

interface EarlyDepartureModalProps {
  plannedEnd: string;
  onCancel: () => void;
  onConfirmEarly: () => void;
  isLoading?: boolean;
}

/**
 * Modal displayed when user attempts to clock out before their shift ends.
 * Offers two choices: cancel (error) or confirm early departure.
 */
export function EarlyDepartureModal({
  plannedEnd,
  onCancel,
  onConfirmEarly,
  isLoading = false,
}: EarlyDepartureModalProps) {
  // Format time for display (extract HH:MM from ISO or time string)
  const formatTime = (timeStr: string) => {
    try {
      // If it's an ISO string, extract time
      if (timeStr.includes("T")) {
        return timeStr.split("T")[1]?.substring(0, 5) || timeStr;
      }
      // If it's already HH:MM:SS or HH:MM
      return timeStr.substring(0, 5);
    } catch {
      return timeStr;
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        className="rounded-2xl max-w-sm p-0 gap-0"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (isLoading) e.preventDefault();
        }}
      >
        {/* Header */}
        <DialogHeader className="p-4 border-b border-border space-y-0">
          <div className="flex items-center gap-2 text-orange-500 dark:text-orange-400">
            <AlertTriangle className="h-5 w-5" />
            <DialogTitle className="text-base font-semibold">Départ anticipé</DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            Confirmer le départ avant la fin du shift
          </DialogDescription>
        </DialogHeader>

        {/* Content */}
        <div className="p-6 text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
            <Clock className="h-8 w-8 text-orange-500 dark:text-orange-400" />
          </div>

          <div>
            <p className="text-lg font-medium">
              Votre shift se termine à{" "}
              <span className="text-orange-500 dark:text-orange-400 font-bold">
                {formatTime(plannedEnd)}
              </span>
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Souhaitez-vous vraiment pointer votre départ maintenant ?
            </p>
          </div>
        </div>

        {/* Actions */}
        <DialogFooter className="p-4 space-y-3 border-t border-border flex-col sm:flex-col sm:space-x-0">
          <Button variant="outline" className="w-full" onClick={onCancel} disabled={isLoading}>
            Erreur, annuler
          </Button>
          <Button
            className="w-full bg-orange-500 dark:bg-orange-600 hover:bg-orange-600 dark:hover:bg-orange-500 text-white"
            onClick={onConfirmEarly}
            disabled={isLoading}
          >
            {isLoading ? "Enregistrement..." : "Je finis plus tôt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

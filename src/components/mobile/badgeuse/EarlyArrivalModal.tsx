/**
 * Modal for informing about early arrival (info-only, no confirmation)
 * Shows when badge is earlier than allowed limit before shift start
 * 
 * V2: Simplified to info-only popup - no "Confirmer" button
 * The employee must re-badge at the correct time.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface EarlyArrivalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shiftStart: string;
  minutesEarly: number;
  /** @deprecated No longer used - kept for backwards compatibility */
  earlyLimit?: number;
  /** @deprecated No longer used - info-only modal */
  onConfirm?: () => void;
  /** Called when user clicks OK */
  onCancel: () => void;
}

export function EarlyArrivalModal({
  open,
  onOpenChange,
  shiftStart,
  minutesEarly,
  onCancel,
}: EarlyArrivalModalProps) {
  const handleOk = () => {
    onCancel();
    onOpenChange(false);
  };

  // Format minutes as "X h Y" or "Y min"
  const formatDuration = (minutes: number): string => {
    if (minutes >= 60) {
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return m > 0 ? `${h} h ${m}` : `${h} h`;
    }
    return `${minutes} min`;
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Arrivée trop tôt</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            {shiftStart ? (
              <>
                <p>
                  Vous êtes arrivé <strong>{formatDuration(minutesEarly)}</strong> avant le début 
                  du service prévu à <strong>{shiftStart}</strong>.
                </p>
                <p className="text-muted-foreground">
                  Merci de rebadger à l'heure de votre service.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                Merci de rebadger à l'heure de votre service.
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={handleOk}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

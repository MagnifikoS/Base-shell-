/**
 * Modal displayed when BADGE_TOO_EARLY is triggered.
 * Asks user: "Is this an extra (overtime)?"
 *
 * - "Oui, c'est un extra" → creates an extra request via badge-events with early_extra_confirmed=true
 * - "Non" → shows the existing EarlyArrivalModal with "Arrivée trop tôt" message
 *
 * SSOT: Uses same backend flow as clock_out extras (extra_events with status="pending")
 */

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Clock, AlertTriangle, Loader2 } from "lucide-react";

interface EarlyArrivalChoiceModalProps {
  open: boolean;
  shiftStart: string; // HH:mm format
  minutesEarly: number;
  onClose: () => void;
  onConfirmExtra: () => void; // User chose "Oui, c'est un extra"
  onDeclineExtra: () => void; // User chose "Non" → show EarlyArrivalModal
  isLoading?: boolean;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h${String(remainingMinutes).padStart(2, "0")}`;
}

export function EarlyArrivalChoiceModal({
  open,
  shiftStart,
  minutesEarly,
  onClose,
  onConfirmExtra,
  onDeclineExtra,
  isLoading = false,
}: EarlyArrivalChoiceModalProps) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="max-w-sm rounded-2xl p-0 gap-0 border-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onPointerDownCapture={(e) => {
          e.stopPropagation();
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 p-4 border-b border-border text-amber-500 dark:text-amber-400">
          <AlertTriangle className="h-5 w-5" />
          <span className="font-semibold">Arrivée en avance</span>
        </div>

        {/* Content */}
        <div className="p-6 text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center bg-amber-100 dark:bg-amber-900/30">
            <Clock className="h-8 w-8 text-amber-500 dark:text-amber-400" />
          </div>

          <div>
            <p className="text-lg font-medium">{formatDuration(minutesEarly)} en avance</p>
            <p className="text-sm text-muted-foreground mt-2">
              {shiftStart ? (
                <>
                  Votre service est prévu à <span className="font-medium">{shiftStart}</span>.
                  <br />
                  Est-ce un extra ?
                </>
              ) : (
                <>
                  Vous êtes en avance par rapport à votre service.
                  <br />
                  Est-ce un extra ?
                </>
              )}
            </p>
          </div>
        </div>

        {/* Actions - 2 choices */}
        <div className="p-4 space-y-3 border-t border-border">
          {/* No - show "Arrivée trop tôt" modal */}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={(e) => {
              e.stopPropagation();
              onDeclineExtra();
            }}
            disabled={isLoading}
          >
            Non
          </Button>

          {/* Yes - create extra request */}
          <Button
            type="button"
            className="w-full text-white bg-amber-500 dark:bg-amber-600 hover:bg-amber-600 dark:hover:bg-amber-500"
            onClick={(e) => {
              e.stopPropagation();
              onConfirmExtra();
            }}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Envoi en cours...
              </>
            ) : (
              "Oui, c'est un extra"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

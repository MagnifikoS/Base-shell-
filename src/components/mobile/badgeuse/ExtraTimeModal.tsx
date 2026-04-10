/**
 * Modal displayed when user clocks out significantly after shift end.
 * V6 UNIFIED: Supports both shift-based extra and leave-based extra
 * - Shift-based: extra time after planned end
 * - Leave-based: ALL worked time is extra (planned_end is null)
 */

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Clock, AlertTriangle } from "lucide-react";
import { minutesToXhYY } from "@/lib/time/paris";

interface ExtraTimeModalProps {
  open: boolean;
  extraMinutes?: number;
  plannedEnd?: string | null;
  isLeaveExtra?: boolean; // V6: true if this is a leave-day extra
  onClose: () => void;
  onNoExtra: () => void;
  onYesExtra: () => void;
  isLoading?: boolean;
}

export function ExtraTimeModal({
  open,
  extraMinutes = 0,
  plannedEnd = "",
  isLeaveExtra = false,
  onClose,
  onNoExtra,
  onYesExtra,
  isLoading = false,
}: ExtraTimeModalProps) {
  if (!open) return null;

  const isLeaveMode = isLeaveExtra || !plannedEnd;

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
          <span className="font-semibold">Heures supplémentaires ?</span>
        </div>

        {/* Content */}
        <div className="p-6 text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center bg-amber-100 dark:bg-amber-900/30">
            <Clock className="h-8 w-8 text-amber-500 dark:text-amber-400" />
          </div>

          <div>
            <p className="text-lg font-medium">{minutesToXhYY(extraMinutes)} travaillées</p>
            <p className="text-sm text-muted-foreground mt-2">
              {isLeaveMode ? (
                <>
                  Tu étais en congé/repos aujourd'hui.
                  <br />
                  As-tu effectué des heures supplémentaires ?
                </>
              ) : (
                <>
                  Ton shift devait se terminer à <span className="font-medium">{plannedEnd}</span>.
                  <br />
                  As-tu effectué des heures supplémentaires ?
                </>
              )}
            </p>
          </div>
        </div>

        {/* Actions - 2 choices */}
        <div className="p-4 space-y-3 border-t border-border">
          {/* No extra - use planned end time */}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={(e) => {
              e.stopPropagation();
              onNoExtra();
            }}
            disabled={isLoading}
          >
            Non, je ne fais pas d'extra
          </Button>

          {/* Yes extra - use real time */}
          <Button
            type="button"
            className="w-full text-white bg-amber-500 dark:bg-amber-600 hover:bg-amber-600 dark:hover:bg-amber-500"
            onClick={(e) => {
              e.stopPropagation();
              onYesExtra();
            }}
            disabled={isLoading}
          >
            {isLoading ? "Enregistrement..." : "Oui, c'est un extra"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

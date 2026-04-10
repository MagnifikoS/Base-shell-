/**
 * LeaveConflictDialog - Modal popup for leave conflict errors
 * 
 * Displays a clear explanation when user tries to declare an absence
 * for dates that are already:
 * - Approved (validated in personnel_leaves)
 * - Pending (already requested in personnel_leave_requests)
 * 
 * Uses the blocking dialog pattern for consistent UX
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
import { AlertTriangle, Calendar, Clock } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export interface LeaveConflictData {
  conflicts_approved: string[];
  conflicts_pending: string[];
}

interface LeaveConflictDialogProps {
  open: boolean;
  onClose: () => void;
  conflictData: LeaveConflictData | null;
}

function formatDateShort(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T12:00:00Z");
    return format(date, "d MMM yyyy", { locale: fr });
  } catch {
    return dateStr;
  }
}

export function LeaveConflictDialog({
  open,
  onClose,
  conflictData,
}: LeaveConflictDialogProps) {
  if (!conflictData) return null;

  const hasApproved = conflictData.conflicts_approved.length > 0;
  const hasPending = conflictData.conflicts_pending.length > 0;

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Conflit de dates
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-left">
              <p>
                Impossible de créer la demande. Certaines dates sont déjà occupées :
              </p>

              {hasApproved && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2 text-destructive font-medium text-sm">
                    <Calendar className="h-4 w-4" />
                    Dates déjà validées
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {conflictData.conflicts_approved.map((date) => (
                      <span
                        key={date}
                        className="px-2 py-0.5 bg-destructive/20 text-destructive rounded text-xs font-medium"
                      >
                        {formatDateShort(date)}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Ces absences ont déjà été approuvées dans le planning.
                  </p>
                </div>
              )}

              {hasPending && (
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2 text-warning font-medium text-sm">
                    <Clock className="h-4 w-4" />
                    Dates déjà demandées
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {conflictData.conflicts_pending.map((date) => (
                      <span
                        key={date}
                        className="px-2 py-0.5 bg-warning/20 text-warning rounded text-xs font-medium"
                      >
                        {formatDateShort(date)}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Une demande est en attente de validation pour ces dates.
                  </p>
                </div>
              )}

              <p className="text-sm">
                Choisissez des dates différentes ou annulez d'abord la demande existante.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>
            Compris
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

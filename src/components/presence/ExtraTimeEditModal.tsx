/**
 * ExtraTimeEditModal - Simple modal to edit the time of an extra event
 * UI only: calls useAdminBadgeMutations.updateBadge() (same as badgeuse)
 * 
 * LOCKS:
 * - Never write to extra_events directly
 * - Always pass dayDate from extraEvent.day_date (not today)
 * - Backend handles recalculation of effective_at + extra sync
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Clock, Check } from "lucide-react";
import { useAdminBadgeMutations } from "@/hooks/presence/useAdminBadgeMutations";
import { formatParisHHMM, buildParisISO } from "@/lib/time/paris";
import { toast } from "sonner";

interface ExtraTimeEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The badge_event_id linked to this extra */
  badgeEventId: string;
  /** The day_date of the extra (YYYY-MM-DD) - REQUIRED for historical edits */
  dayDate: string;
  /** Current occurred_at of the badge event (ISO string) for pre-fill */
  currentOccurredAt?: string | null;
  /** Establishment ID for correct scope */
  establishmentId?: string;
  /** Optional label for context */
  label?: string;
}

export function ExtraTimeEditModal({
  open,
  onOpenChange,
  badgeEventId,
  dayDate,
  currentOccurredAt,
  establishmentId,
  label = "Heure de fin",
}: ExtraTimeEditModalProps) {
  const { updateBadge, isUpdating } = useAdminBadgeMutations(establishmentId);

  // Pre-fill with current time if available
  const initialTime = currentOccurredAt ? formatParisHHMM(currentOccurredAt) : "";
  const [timeValue, setTimeValue] = useState(initialTime);

  // Reset time when modal opens with new data
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && currentOccurredAt) {
      setTimeValue(formatParisHHMM(currentOccurredAt));
    }
    onOpenChange(isOpen);
  };

  const handleValidate = async () => {
    if (!timeValue.trim()) {
      toast.error("Veuillez saisir une heure");
      return;
    }

    // Build ISO timestamp from dayDate + timeValue (Paris timezone safe)
    const occurredAt = buildParisISO(dayDate, timeValue);

    const result = await updateBadge.mutateAsync({
      badgeEventId,
      occurredAt,
      dayDate, // OPTION B: Pass dayDate for historical edits
    });

    if (result.kind === "error") {
      // BADGE_CONFLICT and FUTURE_BADGE_BLOCKED are handled by global BlockingDialog
      if (result.code !== "BADGE_CONFLICT" && result.code !== "FUTURE_BADGE_BLOCKED") {
        toast.error(result.message);
      }
      return;
    }

    if (result.kind === "warning" && result.warning === "EXTRA_SUSPECTED") {
      // For simplicity, auto-confirm the extra (admin is already editing an extra)
      const confirmResult = await updateBadge.mutateAsync({
        badgeEventId,
        occurredAt,
        dayDate,
        extra_confirmed: true,
        force_planned_end: false, // Keep the new time as extra
      });

      if (confirmResult.kind === "error") {
        // BADGE_CONFLICT and FUTURE_BADGE_BLOCKED are handled by global BlockingDialog
        if (confirmResult.code !== "BADGE_CONFLICT" && confirmResult.code !== "FUTURE_BADGE_BLOCKED") {
          toast.error(confirmResult.message);
        }
        return;
      }
    }

    toast.success("Horaire modifié");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-lg">Modifier l'horaire</DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-primary" />
              {label}
            </Label>
            <Input
              type="time"
              value={timeValue}
              onChange={(e) => setTimeValue(e.target.value)}
              className="text-center text-lg"
              disabled={isUpdating}
              autoFocus
            />
            <p className="text-xs text-muted-foreground text-center">
              Date : {new Date(dayDate + "T12:00:00").toLocaleDateString("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
            <p className="text-xs text-muted-foreground/70 italic text-center">
              Un badge représente un événement passé ou présent.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isUpdating}
          >
            Annuler
          </Button>
          <Button onClick={handleValidate} disabled={isUpdating}>
            {isUpdating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-2" />
            )}
            Valider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

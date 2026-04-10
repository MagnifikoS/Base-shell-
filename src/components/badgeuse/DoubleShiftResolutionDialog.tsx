/**
 * DoubleShiftResolutionDialog — V14 Double-shift forgotten clock-out resolution
 *
 * Shown when the backend detects DOUBLE_SHIFT_DETECTED:
 * - Session 1 has clock_in but no clock_out
 * - Current time is past shift 1 end and near shift 2 start
 *
 * Offers two resolution options:
 * 1. "J'ai oublie de pointer la sortie" → auto-insert clock_out at planned end, then clock_in now
 * 2. "Mon planning a ete modifie" → ask user to contact manager
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertTriangle, Clock } from "lucide-react";
import { Label } from "@/components/ui/label";

export interface DoubleShiftResolutionDialogProps {
  open: boolean;
  openClockInTime: string;
  plannedEndTime: string | null;
  nextShiftStart: string | null;
  nextShiftEnd: string | null;
  onResolveForget: () => void;
  onResolvePlanningChanged: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

type ResolutionChoice = "forgot_clockout" | "planning_changed";

export function DoubleShiftResolutionDialog({
  open,
  openClockInTime,
  plannedEndTime,
  nextShiftStart,
  nextShiftEnd,
  onResolveForget,
  onResolvePlanningChanged,
  onCancel,
  isLoading = false,
}: DoubleShiftResolutionDialogProps) {
  const [choice, setChoice] = useState<ResolutionChoice>("forgot_clockout");

  const handleConfirm = () => {
    if (choice === "forgot_clockout") {
      onResolveForget();
    } else {
      onResolvePlanningChanged();
    }
  };

  const shiftLabel = plannedEndTime
    ? `${openClockInTime}-${plannedEndTime}`
    : `depuis ${openClockInTime}`;

  const nextShiftLabel =
    nextShiftStart && nextShiftEnd ? `${nextShiftStart}-${nextShiftEnd}` : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isLoading) onCancel();
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
            <DialogTitle className="text-base font-semibold">
              Pointage sans sortie precedente
            </DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            Resoudre un oubli de pointage de sortie pour le shift precedent
          </DialogDescription>
        </DialogHeader>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="text-center space-y-2">
            <div className="mx-auto w-14 h-14 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
              <Clock className="h-7 w-7 text-orange-500 dark:text-orange-400" />
            </div>
            <p className="text-sm text-muted-foreground">
              Vous aviez pointe votre arrivee a{" "}
              <span className="font-semibold text-foreground">{openClockInTime}</span> mais aucune
              sortie n'a ete enregistree.
            </p>
            {plannedEndTime && (
              <p className="text-sm text-muted-foreground">
                Le planning prevoit un shift{" "}
                <span className="font-semibold text-foreground">{shiftLabel}</span>.
              </p>
            )}
            {nextShiftLabel && (
              <p className="text-sm text-muted-foreground">
                Prochain shift :{" "}
                <span className="font-semibold text-foreground">{nextShiftLabel}</span>
              </p>
            )}
          </div>

          {/* Resolution options */}
          <RadioGroup
            value={choice}
            onValueChange={(val: string) => setChoice(val as ResolutionChoice)}
            className="space-y-3"
          >
            {/* Option 1: Forgot clock-out */}
            <div
              className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                choice === "forgot_clockout" ? "border-primary bg-primary/5" : "border-border"
              }`}
              onClick={() => setChoice("forgot_clockout")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setChoice("forgot_clockout");
              }}
            >
              <RadioGroupItem value="forgot_clockout" id="forgot_clockout" className="mt-0.5" />
              <div>
                <Label htmlFor="forgot_clockout" className="text-sm font-medium cursor-pointer">
                  J'ai oublie de pointer la sortie
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  {plannedEndTime
                    ? `Enregistrer sortie a ${plannedEndTime} et entree maintenant`
                    : "Enregistrer sortie et entree maintenant"}
                </p>
              </div>
            </div>

            {/* Option 2: Planning changed */}
            <div
              className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                choice === "planning_changed" ? "border-primary bg-primary/5" : "border-border"
              }`}
              onClick={() => setChoice("planning_changed")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setChoice("planning_changed");
              }}
            >
              <RadioGroupItem value="planning_changed" id="planning_changed" className="mt-0.5" />
              <div>
                <Label htmlFor="planning_changed" className="text-sm font-medium cursor-pointer">
                  Mon planning a ete modifie
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Contactez votre responsable pour corriger
                </p>
              </div>
            </div>
          </RadioGroup>
        </div>

        {/* Actions */}
        <DialogFooter className="p-4 space-y-3 border-t border-border flex-col sm:flex-col sm:space-x-0">
          <Button
            variant="outline"
            className="w-full"
            onClick={onCancel}
            disabled={isLoading}
            aria-label="Annuler la resolution"
          >
            Annuler
          </Button>
          <Button
            className="w-full"
            onClick={handleConfirm}
            disabled={isLoading}
            aria-label="Confirmer la resolution"
          >
            {isLoading ? "Traitement..." : "Confirmer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

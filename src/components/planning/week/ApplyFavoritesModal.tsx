/**
 * ApplyFavoritesModal — Dialog for applying saved favorite weekly schedules
 *
 * - Shows list of employees who have a saved favorite
 * - If target days have existing shifts: offer merge/replace choice
 * - If target days are empty: apply directly
 * - Uses existing createShift and deleteShift mutations (no backend bypass)
 */
import { useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Star, Loader2, AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useCreateShift } from "../hooks/useCreateShift";
import { useDeleteShift } from "../hooks/useDeleteShift";
import { useQueryClient } from "@tanstack/react-query";
import type { PlanningShift, PlanningEmployee } from "../types/planning.types";
import type { NamedFavorite as FavoriteTemplate } from "../hooks/usePlanningFavorites";

type ApplyMode = "merge" | "replace";

interface ApplyFavoritesModalProps {
  isOpen: boolean;
  onClose: () => void;
  establishmentId: string;
  weekStart: string;
  employees: PlanningEmployee[];
  shiftsByEmployee: Record<string, PlanningShift[]>;
  /** Map: userId -> FavoriteTemplate (only employees with favorites) */
  favoritesByEmployee: Record<string, FavoriteTemplate>;
  /** Resolve a favorite into concrete date/time pairs for the current week */
  resolveFavoriteForWeek: (
    userId: string,
    weekStart: string
  ) => Array<{ shiftDate: string; startTime: string; endTime: string }> | null;
}

export function ApplyFavoritesModal({
  isOpen,
  onClose,
  establishmentId,
  weekStart,
  employees,
  shiftsByEmployee,
  favoritesByEmployee,
  resolveFavoriteForWeek,
}: ApplyFavoritesModalProps) {
  const [applyMode, setApplyMode] = useState<ApplyMode>("merge");
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());

  const createShiftMutation = useCreateShift();
  const deleteShiftMutation = useDeleteShift();
  const queryClient = useQueryClient();

  // Employees that have favorites
  const employeesWithFavorites = useMemo(() => {
    return employees.filter((emp) => !!favoritesByEmployee[emp.user_id]);
  }, [employees, favoritesByEmployee]);

  // Check if any selected employee has existing shifts in the target week
  const hasExistingShiftsForSelected = useMemo(() => {
    return Array.from(selectedUserIds).some((userId) => {
      const shifts = shiftsByEmployee[userId];
      return shifts && shifts.length > 0;
    });
  }, [selectedUserIds, shiftsByEmployee]);

  // Toggle employee selection
  const toggleEmployee = useCallback((userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  // Select/deselect all
  const toggleAll = useCallback(() => {
    if (selectedUserIds.size === employeesWithFavorites.length) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(employeesWithFavorites.map((e) => e.user_id)));
    }
  }, [selectedUserIds, employeesWithFavorites]);

  const handleClose = useCallback(() => {
    if (isProcessing) return;
    setSelectedUserIds(new Set());
    setApplyMode("merge");
    onClose();
  }, [isProcessing, onClose]);

  // Reset selections when modal opens
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        // Pre-select all employees with favorites
        setSelectedUserIds(new Set(employeesWithFavorites.map((e) => e.user_id)));
        setApplyMode("merge");
      } else {
        handleClose();
      }
    },
    [employeesWithFavorites, handleClose]
  );

  // Apply favorites for selected employees
  const handleApply = useCallback(async () => {
    if (selectedUserIds.size === 0) return;
    setIsProcessing(true);

    let successCount = 0;
    let failedCount = 0;

    for (const userId of selectedUserIds) {
      const resolved = resolveFavoriteForWeek(userId, weekStart);
      if (!resolved) continue;

      const existingShifts = shiftsByEmployee[userId] || [];

      // In replace mode, delete existing shifts first
      if (applyMode === "replace" && existingShifts.length > 0) {
        for (const shift of existingShifts) {
          try {
            await deleteShiftMutation.mutateAsync({
              establishmentId,
              weekStart,
              employeeId: userId,
              shiftId: shift.id,
            });
          } catch {
            // Continue even if individual delete fails (backend may reject validated days)
          }
        }
      }

      // Group existing shifts by date for merge mode detection
      const existingShiftDates = new Set(
        (applyMode === "merge" ? existingShifts : []).map((s) => s.shift_date)
      );

      // Create shifts from favorite template
      for (const { shiftDate, startTime, endTime } of resolved) {
        // In merge mode, skip days that already have shifts
        if (applyMode === "merge" && existingShiftDates.has(shiftDate)) {
          continue;
        }

        try {
          await createShiftMutation.mutateAsync({
            establishmentId,
            weekStart,
            userId,
            shiftDate,
            startTime,
            endTime,
          });
          successCount++;
        } catch {
          failedCount++;
        }
      }
    }

    // Report results
    if (failedCount > 0) {
      toast.warning(
        `Favoris appliques : ${successCount} shift${successCount > 1 ? "s" : ""} cree${successCount > 1 ? "s" : ""}, ${failedCount} echoue${failedCount > 1 ? "s" : ""}`,
        { duration: 5000 }
      );
    } else if (successCount > 0) {
      toast.success(
        `${successCount} shift${successCount > 1 ? "s" : ""} cree${successCount > 1 ? "s" : ""} depuis les favoris`
      );
    } else {
      toast.info("Aucun shift a appliquer (jours deja remplis ou favoris vides)");
    }

    // Invalidate to get fresh data
    queryClient.invalidateQueries({
      queryKey: ["planning-week", establishmentId, weekStart],
    });

    setIsProcessing(false);
    handleClose();
  }, [
    selectedUserIds,
    resolveFavoriteForWeek,
    weekStart,
    shiftsByEmployee,
    applyMode,
    deleteShiftMutation,
    createShiftMutation,
    establishmentId,
    queryClient,
    handleClose,
  ]);

  // Empty state
  if (isOpen && employeesWithFavorites.length === 0) {
    return (
      <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500" />
              Appliquer les plannings favoris
            </AlertDialogTitle>
            <AlertDialogDescription>
              Aucun favori enregistre. Cliquez sur l'etoile a cote du nom d'un salarie dans le
              planning pour enregistrer son planning de la semaine comme favori.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Fermer
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-md">
        {!isProcessing ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500" />
                Appliquer les plannings favoris
              </AlertDialogTitle>
              <AlertDialogDescription>
                Selectionnez les salaries dont vous souhaitez appliquer le planning favori.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {/* Employee checklist */}
            <div className="py-2 space-y-2 max-h-[280px] overflow-y-auto">
              {/* Select all */}
              <div className="flex items-center space-x-3 p-2 rounded-lg border bg-muted/30">
                <Checkbox
                  id="select-all"
                  checked={selectedUserIds.size === employeesWithFavorites.length}
                  onCheckedChange={toggleAll}
                />
                <Label htmlFor="select-all" className="font-medium text-sm cursor-pointer">
                  Tout selectionner ({employeesWithFavorites.length})
                </Label>
              </div>

              {employeesWithFavorites.map((emp) => {
                const fav = favoritesByEmployee[emp.user_id];
                const shiftCount = fav?.shifts?.length ?? 0;
                return (
                  <div
                    key={emp.user_id}
                    className="flex items-center space-x-3 p-2 rounded-lg border hover:bg-muted/50 cursor-pointer"
                    onClick={() => toggleEmployee(emp.user_id)}
                  >
                    <Checkbox
                      id={`fav-${emp.user_id}`}
                      checked={selectedUserIds.has(emp.user_id)}
                      onCheckedChange={() => toggleEmployee(emp.user_id)}
                    />
                    <div className="flex-1 min-w-0">
                      <Label
                        htmlFor={`fav-${emp.user_id}`}
                        className="font-medium text-sm cursor-pointer truncate block"
                      >
                        {emp.full_name || "Sans nom"}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {shiftCount} shift{shiftCount > 1 ? "s" : ""} / semaine
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Mode selection (only show if there are existing shifts) */}
            {hasExistingShiftsForSelected && (
              <div className="py-2 border-t">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium">
                    Des shifts existent deja cette semaine
                  </span>
                </div>
                <RadioGroup
                  value={applyMode}
                  onValueChange={(v) => setApplyMode(v as ApplyMode)}
                  className="space-y-2"
                >
                  <div className="flex items-start space-x-3 p-2 rounded-lg border hover:bg-muted/50 cursor-pointer">
                    <RadioGroupItem value="merge" id="fav-merge" className="mt-0.5" />
                    <div className="flex-1">
                      <Label htmlFor="fav-merge" className="font-medium text-sm cursor-pointer">
                        Completer les jours vides
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Garde les shifts existants, ne remplit que les jours sans shift
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3 p-2 rounded-lg border hover:bg-muted/50 cursor-pointer">
                    <RadioGroupItem value="replace" id="fav-replace" className="mt-0.5" />
                    <div className="flex-1">
                      <Label htmlFor="fav-replace" className="font-medium text-sm cursor-pointer">
                        Remplacer les jours existants
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Supprime les shifts existants et applique le favori
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </div>
            )}

            <AlertDialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Annuler
              </Button>
              <Button onClick={handleApply} disabled={selectedUserIds.size === 0}>
                Appliquer les favoris
              </Button>
            </AlertDialogFooter>
          </>
        ) : (
          <div className="flex items-center justify-center gap-3 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Application en cours...</span>
          </div>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

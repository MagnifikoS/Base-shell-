import { useCallback, useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { toast } from "sonner";
import { useBlockingDialog } from "@/contexts/BlockingDialogContext";
import { PlanningWeekHeader } from "./PlanningWeekHeader";
import { PlanningWeekRow } from "./PlanningWeekRow";
import { FavoriteSaveDialog } from "./FavoriteSaveDialog";
import { FavoriteApplyDialog } from "./FavoriteApplyDialog";
import { LeaveMarkModal } from "../LeaveMarkModal";
import { LeaveCancelModal } from "../LeaveCancelModal";
import { DeleteWeekConfirmModal } from "./BulkActionModals";
import { usePermissions } from "@/hooks/usePermissions";
import { useValidateDay } from "../hooks/useValidatePlanning";
import { useDeleteWeekShifts } from "../hooks/usePlanningBulkActions";
import { useCreateShift } from "../hooks/useCreateShift";
import { useDeleteShift } from "../hooks/useDeleteShift";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";
import {
  usePersonnelLeavesRange,
  usePersonnelLeavesMutations,
  buildLeavesMap,
  type PersonnelLeave,
} from "@/hooks/personnel/usePersonnelLeaves";
import { supabase } from "@/integrations/supabase/client";
import type { PlanningWeekData, PlanningShift, EmployeesByTeam } from "../types/planning.types";
import { usePlanningFavorites } from "../hooks/usePlanningFavorites";

interface PlanningWeekGridProps {
  data: PlanningWeekData;
  /** Controlled: when true, opens the V2 FavoriteApplyDialog */
  applyFavoritesOpen?: boolean;
  /** Callback when apply-favorites dialog closes */
  onApplyFavoritesClose?: () => void;
}

export function PlanningWeekGrid({
  data,
  applyFavoritesOpen = false,
  onApplyFavoritesClose,
}: PlanningWeekGridProps) {
  const { isAdmin, can } = usePermissions();
  const canManagePlanning = isAdmin || can("planning", "write");
  const { showBlockingDialog } = useBlockingDialog();

  // ✅ GOLD RULE: Use RPC get_service_day_now for "today" - SINGLE SOURCE OF TRUTH
  const { data: serviceDay } = useServiceDayToday(data.establishment.id);

  // Calculate week end date (weekStart + 6 days)
  const weekEnd = useMemo(() => {
    const start = new Date(data.weekStart + "T00:00:00");
    return format(addDays(start, 6), "yyyy-MM-dd");
  }, [data.weekStart]);

  // Fetch leaves for the week (1 query)
  const { data: leaves = [] } = usePersonnelLeavesRange({
    establishmentId: data.establishment.id,
    dateFrom: data.weekStart,
    dateTo: weekEnd,
  });

  // Build quick-access map: "userId|date" -> leave
  const leavesMap = useMemo(() => buildLeavesMap(leaves), [leaves]);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2 R-EXTRA: Balances are now calculated on-the-fly in getWeek.ts
  // No more useRextraBalances hook - use data.rextraBalanceByEmployee directly
  // ═══════════════════════════════════════════════════════════════════════════
  const rextraBalances = data.rextraBalanceByEmployee ?? {};

  // Mutations
  const { createLeave, cancelLeave, cancelLeaveAsync, isCreating, isCanceling } =
    usePersonnelLeavesMutations();
  const validateDayMutation = useValidateDay();
  const deleteWeekMutation = useDeleteWeekShifts();

  // Modal states
  const [markModalOpen, setMarkModalOpen] = useState(false);
  const [markModalData, setMarkModalData] = useState<{
    userId: string;
    employeeName: string;
    date: string;
  } | null>(null);

  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelModalData, setCancelModalData] = useState<{
    leave: PersonnelLeave;
    employeeName: string;
    date: string;
  } | null>(null);

  // Delete week modal
  const [deleteWeekModalOpen, setDeleteWeekModalOpen] = useState(false);

  // Badge day state - track which specific day is being badged (null = none)
  const [badgingDayDate, setBadgingDayDate] = useState<string | null>(null);

  // Handlers — wrapped in useCallback to stabilize references for memo'd PlanningWeekRow
  const handleOpenMarkModal = useCallback((userId: string, employeeName: string, date: string) => {
    setMarkModalData({ userId, employeeName, date });
    setMarkModalOpen(true);
  }, []);

  const handleCloseMarkModal = useCallback(() => {
    setMarkModalOpen(false);
    setMarkModalData(null);
  }, []);

  const handleConfirmMark = (leaveType: "cp" | "absence" | "am", reason?: string) => {
    if (!markModalData) return;
    createLeave(
      {
        establishmentId: data.establishment.id,
        userId: markModalData.userId,
        leaveDate: markModalData.date,
        leaveType,
        reason,
        weekStart: data.weekStart,
      },
      {
        onSuccess: () => handleCloseMarkModal(),
      }
    );
  };

  const handleOpenCancelModal = useCallback(
    (leave: PersonnelLeave, employeeName: string, date: string) => {
      setCancelModalData({ leave, employeeName, date });
      setCancelModalOpen(true);
    },
    []
  );

  const handleCloseCancelModal = useCallback(() => {
    setCancelModalOpen(false);
    setCancelModalData(null);
  }, []);

  const handleConfirmCancel = useCallback(() => {
    if (!cancelModalData) return;
    cancelLeave(
      {
        userId: cancelModalData.leave.user_id,
        leaveDate: cancelModalData.leave.leave_date,
        leaveType: cancelModalData.leave.leave_type,
        establishmentId: data.establishment.id,
        weekStart: data.weekStart,
      },
      {
        onSuccess: () => {
          setCancelModalOpen(false);
          setCancelModalData(null);
        },
      }
    );
  }, [cancelModalData, cancelLeave, data.establishment.id, data.weekStart]);

  // Validation handlers - Toggle: if validated, unvalidate; else validate
  const handleValidateDay = useCallback(
    (date: string) => {
      const isCurrentlyValidated = data.validation.validatedDays[date] === true;
      validateDayMutation.mutate({
        establishmentId: data.establishment.id,
        weekStart: data.weekStart,
        date,
        validated: !isCurrentlyValidated, // Toggle
      });
    },
    [data.validation.validatedDays, data.establishment.id, data.weekStart, validateDayMutation]
  );

  const handleDeleteWeek = useCallback(() => {
    deleteWeekMutation.mutate(
      { establishmentId: data.establishment.id, weekStart: data.weekStart },
      { onSuccess: () => setDeleteWeekModalOpen(false) }
    );
  }, [deleteWeekMutation, data.establishment.id, data.weekStart]);

  // Badge all employees for a specific day
  const handleBadgeDay = useCallback(
    async (date: string) => {
      if (badgingDayDate) return; // Already badging another day

      setBadgingDayDate(date);
      try {
        const { data: result, error } = await supabase.functions.invoke("badgeuse-backfill", {
          body: {
            establishment_id: data.establishment.id,
            start_date: date,
            end_date: date,
            mode: "skip",
            preview: false,
          },
        });

        if (error) {
          if (import.meta.env.DEV) console.error("Badge day error:", error);
          toast.error("Erreur lors du badgeage du jour");
          return;
        }

        if (result?.created_count > 0) {
          toast.success(
            `${result.created_count} pointage${result.created_count > 1 ? "s" : ""} créé${result.created_count > 1 ? "s" : ""}`
          );
        } else if (result?.skipped_count > 0) {
          toast.info(
            `${result.skipped_count} pointage${result.skipped_count > 1 ? "s" : ""} déjà existant${result.skipped_count > 1 ? "s" : ""}`
          );
        } else {
          // Use blocking dialog for business-blocking message
          showBlockingDialog({
            title: "Badge non pris en compte",
            message: "Hors délais.",
          });
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error("Badge day error:", err);
        toast.error("Erreur lors du badgeage du jour");
      } finally {
        setBadgingDayDate(null);
      }
    },
    [badgingDayDate, data.establishment.id, showBlockingDialog]
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PLANNING FAVORITES V2: Named favorites (max 2 per employee, localStorage)
  // ═══════════════════════════════════════════════════════════════════════════
  const {
    getFavorites,
    saveFavorite,
    replaceFavorite,
    matchesFavorite,
    employeesWithFavorites,
    resolveFavoriteForWeek,
  } = usePlanningFavorites(data.establishment.id);

  // Mutations for apply-favorite flow
  const createShiftForApply = useCreateShift();
  const deleteShiftForApply = useDeleteShift();

  // Save-favorite dialog state
  const [saveFavDialogOpen, setSaveFavDialogOpen] = useState(false);
  const [saveFavUserId, setSaveFavUserId] = useState<string | null>(null);

  // Apply-favorite dialog state — controlled by parent via props
  const [isApplyingFavorite, setIsApplyingFavorite] = useState(false);

  const handleOpenSaveFavorite = useCallback(
    (userId: string) => {
      const shifts = data.shiftsByEmployee[userId] || [];
      if (shifts.length === 0) {
        toast.error("Aucun shift a enregistrer comme favori");
        return;
      }
      setSaveFavUserId(userId);
      setSaveFavDialogOpen(true);
    },
    [data.shiftsByEmployee]
  );

  const handleSaveFavorite = useCallback(
    (name: string) => {
      if (!saveFavUserId) return;
      const shifts = data.shiftsByEmployee[saveFavUserId] || [];
      saveFavorite(saveFavUserId, name, shifts, data.weekStart);
      toast.success(`Favori "${name}" enregistre`);
    },
    [saveFavUserId, data.shiftsByEmployee, data.weekStart, saveFavorite]
  );

  const handleReplaceFavorite = useCallback(
    (index: number, name: string) => {
      if (!saveFavUserId) return;
      const shifts = data.shiftsByEmployee[saveFavUserId] || [];
      replaceFavorite(saveFavUserId, index, name, shifts, data.weekStart);
      toast.success(`Favori "${name}" remplace`);
    },
    [saveFavUserId, data.shiftsByEmployee, data.weekStart, replaceFavorite]
  );

  // Apply-favorite flow
  const employees = data.employees;
  const applyFavoriteEntries = useMemo(() => {
    return employeesWithFavorites
      .map((userId) => {
        const emp = employees.find((e) => e.user_id === userId);
        if (!emp) return null;
        return {
          employee: emp,
          favorites: getFavorites(userId),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }, [employeesWithFavorites, employees, getFavorites]);

  const getExistingShiftsForApply = useCallback(
    (userId: string): PlanningShift[] => {
      return data.shiftsByEmployee[userId] || [];
    },
    [data.shiftsByEmployee]
  );

  const handleApplyFavorite = useCallback(
    async (userId: string, favoriteIndex: number) => {
      setIsApplyingFavorite(true);
      try {
        const resolved = resolveFavoriteForWeek(userId, favoriteIndex, data.weekStart);
        if (!resolved?.length) {
          toast.error("Favori vide ou introuvable");
          return;
        }

        // Delete existing shifts first
        const existingShifts = data.shiftsByEmployee[userId] || [];
        for (const shift of existingShifts) {
          await deleteShiftForApply.mutateAsync({
            establishmentId: data.establishment.id,
            weekStart: data.weekStart,
            employeeId: userId,
            shiftId: shift.id,
          });
        }

        // Create new shifts from template
        for (const resolved_shift of resolved) {
          await createShiftForApply.mutateAsync({
            establishmentId: data.establishment.id,
            weekStart: data.weekStart,
            userId,
            shiftDate: resolved_shift.shiftDate,
            startTime: resolved_shift.startTime,
            endTime: resolved_shift.endTime,
          });
        }

        const favName = getFavorites(userId)[favoriteIndex]?.name ?? "Favori";
        toast.success(
          `Favori "${favName}" applique pour ${data.employees.find((e) => e.user_id === userId)?.full_name ?? "employe"}`
        );
      } catch (err) {
        if (import.meta.env.DEV) console.error("Apply favorite error:", err);
        toast.error("Erreur lors de l'application du favori");
      } finally {
        setIsApplyingFavorite(false);
      }
    },
    [
      resolveFavoriteForWeek,
      data.weekStart,
      data.shiftsByEmployee,
      data.establishment.id,
      data.employees,
      deleteShiftForApply,
      createShiftForApply,
      getFavorites,
    ]
  );

  // Check if any days are validated
  const hasAnyValidatedDay = Object.values(data.validation.validatedDays).some((v) => v === true);

  // Grouper les employés par team (memoized)
  // Exclude "Sans équipe" (null team), put "Direction" last
  const employeesByTeam = useMemo<EmployeesByTeam[]>(() => {
    const groups = new Map<string | null, EmployeesByTeam>();

    for (const emp of data.employees) {
      // Skip employees without a team
      if (!emp.team_id || !emp.team_name) continue;

      const key = emp.team_id;
      if (!groups.has(key)) {
        groups.set(key, {
          teamId: emp.team_id,
          teamName: emp.team_name,
          employees: [],
        });
      }
      groups.get(key)!.employees.push(emp);
    }

    // Sort: alphabetical, but "Direction" goes last
    const sorted = Array.from(groups.values()).sort((a, b) => {
      const aIsDirection = a.teamName?.toLowerCase() === "direction";
      const bIsDirection = b.teamName?.toLowerCase() === "direction";

      if (aIsDirection && !bIsDirection) return 1;
      if (!aIsDirection && bIsDirection) return -1;
      return (a.teamName || "").localeCompare(b.teamName || "");
    });

    return sorted;
  }, [data.employees]);

  return (
    <div
      className="flex flex-col flex-1 overflow-auto bg-background border rounded-md"
      role="grid"
      aria-label="Planning de la semaine"
    >
      {/* Header sticky */}
      <div className="sticky top-0 z-20 bg-background">
        <PlanningWeekHeader
          weekStart={data.weekStart}
          validatedDays={data.validation.validatedDays}
          weekValidated={data.validation.weekValidated}
          canManagePlanning={canManagePlanning}
          onValidateDay={handleValidateDay}
          isValidatingDay={validateDayMutation.isPending}
          onDeleteWeek={() => setDeleteWeekModalOpen(true)}
          isDeletingWeek={deleteWeekMutation.isPending}
          onBadgeDay={handleBadgeDay}
          badgingDayDate={badgingDayDate}
          serviceDay={serviceDay}
        />
      </div>

      {/* Corps de la grille */}
      <div className="flex-1">
        {employeesByTeam.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            Aucun salarié actif dans cet établissement
          </div>
        ) : (
          employeesByTeam.map((group) => (
            <div key={group.teamId || "no-team"}>
              {/* Bandeau team */}
              <div className="flex border-b bg-muted/40 sticky top-[41px] z-10">
                <div className="w-48 flex-shrink-0 px-3 py-1.5 border-r sticky left-0 bg-muted/40 z-10">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {group.teamName || "Sans équipe"}
                  </span>
                </div>
                <div className="flex-1" />
                <div className="w-20 flex-shrink-0 sticky right-0 bg-muted/40" />
              </div>

              {/* Lignes employés */}
              {group.employees.map((emp) => (
                <PlanningWeekRow
                  key={emp.user_id}
                  employee={emp}
                  weekStart={data.weekStart}
                  shifts={data.shiftsByEmployee[emp.user_id] || []}
                  totalMinutes={data.totalsByEmployee[emp.user_id] || 0}
                  establishmentId={data.establishment.id}
                  openingByDate={data.openingByDate}
                  canManagePlanning={canManagePlanning}
                  leavesMap={leavesMap}
                  onMarkLeave={handleOpenMarkModal}
                  onCancelLeave={handleOpenCancelModal}
                  createLeave={createLeave}
                  isMarkingLeave={isCreating}
                  cancelLeaveAsync={cancelLeaveAsync}
                  isCancelingLeave={isCanceling}
                  weekValidated={data.validation.weekValidated}
                  validatedDays={data.validation.validatedDays}
                  serviceDay={serviceDay}
                  // PHASE 1 R-EXTRA
                  rextraBalance={rextraBalances[emp.user_id] ?? 0}
                  rextraByDate={data.rextraByEmployeeByDate?.[emp.user_id] ?? {}}
                  // PLANNING FAVORITES V2
                  hasFavoriteMatch={
                    matchesFavorite(emp.user_id, data.shiftsByEmployee[emp.user_id] || []).matches
                  }
                  matchedFavoriteName={
                    matchesFavorite(emp.user_id, data.shiftsByEmployee[emp.user_id] || [])
                      .matchedName
                  }
                  favoriteCount={getFavorites(emp.user_id).length}
                  onSaveFavorite={canManagePlanning ? handleOpenSaveFavorite : undefined}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Mark Leave Modal */}
      <LeaveMarkModal
        isOpen={markModalOpen}
        onClose={handleCloseMarkModal}
        employeeName={markModalData?.employeeName || ""}
        date={markModalData?.date || ""}
        onConfirm={handleConfirmMark}
        isLoading={isCreating}
      />

      {/* Cancel Leave Modal */}
      <LeaveCancelModal
        isOpen={cancelModalOpen}
        onClose={handleCloseCancelModal}
        employeeName={cancelModalData?.employeeName || ""}
        date={cancelModalData?.date || ""}
        leaveType={cancelModalData?.leave.leave_type || "absence"}
        onConfirm={handleConfirmCancel}
        isLoading={isCanceling}
      />

      {/* Delete Week Modal */}
      <DeleteWeekConfirmModal
        isOpen={deleteWeekModalOpen}
        onClose={() => setDeleteWeekModalOpen(false)}
        onConfirm={handleDeleteWeek}
        isLoading={deleteWeekMutation.isPending}
        hasValidatedDays={hasAnyValidatedDay}
      />

      {/* Favorite Save Dialog */}
      <FavoriteSaveDialog
        isOpen={saveFavDialogOpen}
        onClose={() => {
          setSaveFavDialogOpen(false);
          setSaveFavUserId(null);
        }}
        employeeName={
          saveFavUserId
            ? (data.employees.find((e) => e.user_id === saveFavUserId)?.full_name ?? "Sans nom")
            : ""
        }
        existingFavorites={saveFavUserId ? getFavorites(saveFavUserId) : []}
        onSave={handleSaveFavorite}
        onReplace={handleReplaceFavorite}
      />

      {/* Favorite Apply Dialog — controlled by parent via applyFavoritesOpen prop */}
      <FavoriteApplyDialog
        isOpen={applyFavoritesOpen}
        onClose={() => onApplyFavoritesClose?.()}
        entries={applyFavoriteEntries}
        getExistingShifts={getExistingShiftsForApply}
        onApply={handleApplyFavorite}
        isApplying={isApplyingFavorite}
      />
    </div>
  );
}

import { useState, useMemo, useCallback, useRef, memo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Star } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useBlockingDialog } from "@/contexts/BlockingDialogContext";
import { getWeekDates, formatMinutesToHours } from "@/lib/planning-engine/format";
import { PlanningWeekCell } from "./PlanningWeekCell";
import { ShiftManagementDialog } from "./ShiftManagementDialog";
import { CopyPreviousWeekModal } from "./BulkActionModals";
import { useCreateShift } from "../hooks/useCreateShift";
import { useDeleteShift } from "../hooks/useDeleteShift";
import { useUpdateShift } from "../hooks/useUpdateShift";
import { usePlanningDragDrop } from "../hooks/usePlanningDragDrop";
import { useCopyPreviousWeek } from "../hooks/usePlanningBulkActions";
import { useRextraMutations } from "@/modules/rextra";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import type { PersonnelLeave } from "@/hooks/personnel/usePersonnelLeaves";
import type {
  PlanningEmployee,
  PlanningShift,
  PlanningOpeningWindow,
} from "../types/planning.types";
import {
  type PendingDropIntent,
  parseDragPayload,
  getDropBlockingError,
  ReplaceLeaveOnDropController,
} from "./row";

interface PlanningWeekRowProps {
  employee: PlanningEmployee;
  weekStart: string;
  shifts: PlanningShift[];
  totalMinutes: number;
  establishmentId: string;
  openingByDate: Record<string, PlanningOpeningWindow>;
  canManagePlanning: boolean;
  leavesMap: Map<string, PersonnelLeave>;
  onMarkLeave: (userId: string, employeeName: string, date: string) => void;
  onCancelLeave: (leave: PersonnelLeave, employeeName: string, date: string) => void;
  createLeave: (
    params: {
      establishmentId: string;
      userId: string;
      leaveDate: string;
      leaveType: "cp" | "absence" | "rest" | "am";
      weekStart: string;
    },
    options?: { onSuccess?: () => void }
  ) => void;
  isMarkingLeave: boolean;
  cancelLeaveAsync: (params: {
    userId: string;
    leaveDate: string;
    leaveType: "cp" | "absence" | "rest" | "am";
    establishmentId: string;
    weekStart: string;
  }) => Promise<{ success: boolean }>;
  isCancelingLeave: boolean;
  weekValidated?: boolean;
  validatedDays?: Record<string, boolean>;
  /** ✅ GOLD RULE: Service day from RPC get_service_day_now - SINGLE SOURCE OF TRUTH for "today" */
  serviceDay?: string;
  /** PHASE 1 R-EXTRA: Balance in minutes for this employee */
  rextraBalance?: number;
  /** PHASE 1 R-EXTRA: Map of R.Extra minutes by date for this employee */
  rextraByDate?: Record<string, number>;
  /** Whether the current week's shifts match a saved favorite */
  hasFavoriteMatch?: boolean;
  /** Name of the matched favorite (if any) */
  matchedFavoriteName?: string;
  /** How many favorites this employee has saved */
  favoriteCount?: number;
  /** Callback to open save-favorite dialog for this employee */
  onSaveFavorite?: (userId: string) => void;
}

export const PlanningWeekRow = memo(function PlanningWeekRow({
  employee,
  weekStart,
  shifts,
  totalMinutes,
  establishmentId,
  openingByDate,
  canManagePlanning,
  leavesMap,
  onMarkLeave,
  onCancelLeave,
  createLeave,
  isMarkingLeave,
  cancelLeaveAsync,
  isCancelingLeave,
  weekValidated = false,
  validatedDays = {},
  serviceDay,
  rextraBalance = 0,
  rextraByDate = {},
  hasFavoriteMatch = false,
  matchedFavoriteName,
  favoriteCount = 0,
  onSaveFavorite,
}: PlanningWeekRowProps) {
  const dates = getWeekDates(weekStart);
  // ✅ GOLD RULE: Use serviceDay prop from RPC - SINGLE SOURCE OF TRUTH (no browser timezone)
  const todayStr = serviceDay ?? "";
  const employeeName = employee.full_name || "Sans nom";

  // Weekend dates (Saturday=6, Sunday=0)
  const weekendDates = useMemo(() => {
    const set = new Set<string>();
    for (const d of dates) {
      const day = new Date(d + "T00:00:00").getDay();
      if (day === 0 || day === 6) set.add(d);
    }
    return set;
  }, [dates]);

  // Blocking dialog for unified future badge UX
  const { showBlockingDialog } = useBlockingDialog();

  // Copy previous week modal state
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const copyPreviousWeekMutation = useCopyPreviousWeek();

  // Check if copy is blocked (week validated or any day validated)
  const hasAnyValidatedDay = Object.values(validatedDays).some((v) => v === true);
  const isCopyBlocked = weekValidated || hasAnyValidatedDay;

  const handleCopyClick = useCallback(() => {
    setCopyModalOpen(true);
  }, []);

  // Dialog state
  const [managementDialogOpen, setManagementDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [prefillStartTime, setPrefillStartTime] = useState<string | null>(null);
  const [prefillEndTime, setPrefillEndTime] = useState<string | null>(null);
  const [prefillErrorMessage, setPrefillErrorMessage] = useState<string | null>(null);

  // DnD state
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [pendingDropIntent, setPendingDropIntent] = useState<PendingDropIntent | null>(null);
  const [isReplacingLeave, setIsReplacingLeave] = useState(false);

  // Badge confirmation state for updates
  const [pendingUpdate, setPendingUpdate] = useState<{
    shiftId: string;
    startTime: string;
    endTime: string;
  } | null>(null);
  const [badgeWarningOpen, setBadgeWarningOpen] = useState(false);
  const [badgeCount, setBadgeCount] = useState(0);

  // Quick-badge state (backfill single shift)
  const [isBadgingShift, setIsBadgingShift] = useState(false);

  // PHASE 1 R-EXTRA: Mutations (modal is now in ShiftManagementCore)
  const rextraMutations = useRextraMutations();

  // Mutations
  const createShiftMutation = useCreateShift();
  const deleteShiftMutation = useDeleteShift();
  const updateShiftMutation = useUpdateShift();

  // Optimistic DnD
  const { handleOptimisticDrop } = usePlanningDragDrop(establishmentId, weekStart);

  // Query client for leave DnD optimistic updates
  const queryClient = useQueryClient();
  const leaveDndPendingRef = useRef(false);

  // Format R-Extra balance for display
  const rextraBalanceDisplay = useMemo(() => {
    if (rextraBalance <= 0) return null;
    const h = Math.floor(rextraBalance / 60);
    const m = rextraBalance % 60;
    return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
  }, [rextraBalance]);

  // Memoized shifts by date
  const shiftsByDate = useMemo(() => {
    const map: Record<string, PlanningShift[]> = {};
    for (const date of dates) map[date] = [];
    for (const shift of shifts) {
      if (map[shift.shift_date]) map[shift.shift_date].push(shift);
    }
    for (const date of dates) {
      map[date].sort((a, b) => a.start_time.localeCompare(b.start_time));
    }
    return map;
  }, [dates, shifts]);

  // Helpers
  const getLeaveForDate = useCallback(
    (date: string): PersonnelLeave | undefined => {
      return leavesMap.get(`${employee.user_id}|${date}`);
    },
    [leavesMap, employee.user_id]
  );

  const closeDialog = useCallback(() => {
    setManagementDialogOpen(false);
    setSelectedDate(null);
    setPrefillStartTime(null);
    setPrefillEndTime(null);
    setPrefillErrorMessage(null);
  }, []);

  // Handlers
  const handleCellClick = (date: string) => {
    if (!canManagePlanning) return;
    setPrefillStartTime(null);
    setPrefillEndTime(null);
    setPrefillErrorMessage(null);
    setSelectedDate(date);
    setManagementDialogOpen(true);
  };

  const handleMarkLeaveFromDialog = (leaveType: "cp" | "absence" | "rest" | "am") => {
    if (!selectedDate) return;
    createLeave(
      { establishmentId, userId: employee.user_id, leaveDate: selectedDate, leaveType, weekStart },
      {
        onSuccess: () => {
          setPrefillErrorMessage(null);
        },
      }
    );
  };

  const handleCreate = async (startTime: string, endTime: string) => {
    if (!selectedDate) return;
    const existingLeave = getLeaveForDate(selectedDate);

    const doCreateShift = () => {
      createShiftMutation.mutate(
        {
          establishmentId,
          weekStart,
          userId: employee.user_id,
          shiftDate: selectedDate,
          startTime,
          endTime,
        },
        {
          onSuccess: () => {
            setPrefillErrorMessage(null);
            closeDialog();
          },
          onError: (error) =>
            setPrefillErrorMessage(error.message || "Erreur lors de la création."),
        }
      );
    };

    if (existingLeave) {
      try {
        await cancelLeaveAsync({
          userId: existingLeave.user_id,
          leaveDate: existingLeave.leave_date,
          leaveType: existingLeave.leave_type,
          establishmentId,
          weekStart,
        });
        doCreateShift();
      } catch {
        return;
      }
    } else {
      doCreateShift();
    }
  };

  const handleUpdate = async (shiftId: string, startTime: string, endTime: string) => {
    if (!selectedDate) return;

    // Check if badge events exist for this employee/date before updating
    const { data: badges, error: badgeError } = await supabase
      .from("badge_events")
      .select("id")
      .eq("user_id", employee.user_id)
      .eq("day_date", selectedDate)
      .eq("establishment_id", establishmentId);

    if (!badgeError && badges && badges.length > 0) {
      // Show warning dialog - user must confirm
      setPendingUpdate({ shiftId, startTime, endTime });
      setBadgeCount(badges.length);
      setBadgeWarningOpen(true);
      return;
    }

    // No badges - proceed directly
    await executeUpdate(shiftId, startTime, endTime);
  };

  const executeUpdate = async (shiftId: string, startTime: string, endTime: string) => {
    try {
      await updateShiftMutation.mutateAsync({
        establishmentId,
        weekStart,
        employeeId: employee.user_id,
        shiftId,
        startTime,
        endTime,
      });
      setPrefillErrorMessage(null);
      closeDialog();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Erreur inconnue";
      const friendlyMessage = mapShiftErrorToFriendlyMessage(errorMessage);
      setPrefillErrorMessage(friendlyMessage);
    }
  };

  const handleConfirmBadgeUpdate = async () => {
    if (!pendingUpdate || !selectedDate) return;
    setBadgeWarningOpen(false);

    // Use edge function admin_reset_day to delete all badge_events for this employee/date/establishment
    // This bypasses RLS and handles extra_events cleanup properly
    const { data, error: resetError } = await supabase.functions.invoke("badge-events", {
      body: {
        action: "admin_reset_day",
        target_user_id: employee.user_id,
        establishment_id: establishmentId,
        day_date: selectedDate,
      },
    });

    if (resetError) {
      if (import.meta.env.DEV)
        console.error("Failed to reset badge events via edge function:", resetError);
      toast.error("Impossible de supprimer les pointages. Réessayez.");
      setPendingUpdate(null);
      setBadgeCount(0);
      return;
    }

    // Check response for errors
    if (data && !data.success) {
      if (import.meta.env.DEV) console.error("Badge reset failed:", data);
      toast.error(data.error || "Impossible de supprimer les pointages.");
      setPendingUpdate(null);
      setBadgeCount(0);
      return;
    }

    const deletedCount = data?.deleted_count || badgeCount;
    toast.success(`${deletedCount} pointage(s) supprimé(s)`);

    // Now proceed with the shift update
    await executeUpdate(pendingUpdate.shiftId, pendingUpdate.startTime, pendingUpdate.endTime);
    setPendingUpdate(null);
    setBadgeCount(0);
  };

  const handleCancelBadgeUpdate = () => {
    setBadgeWarningOpen(false);
    setPendingUpdate(null);
    setBadgeCount(0);
  };

  // Helper to map backend errors to user-friendly messages
  const mapShiftErrorToFriendlyMessage = (errorMessage: string): string => {
    if (errorMessage.includes("START_TIME_LOCKED_BY_CLOCK_IN")) {
      return "L'heure d'arrivée ne peut plus être modifiée : le salarié a déjà badgé son entrée.";
    }
    if (errorMessage.includes("SHIFT_OVERLAPS_WORKED_TIME")) {
      return "Ce shift chevauche le temps de travail déjà badgé (entrée et sortie).";
    }
    if (errorMessage.includes("Shift overlaps with existing shift")) {
      return "Ce shift chevauche un autre shift existant.";
    }
    if (errorMessage.includes("Maximum 2 shifts per day")) {
      return "Maximum 2 shifts par jour atteint.";
    }
    if (errorMessage.includes("DAY_VALIDATED")) {
      return "Ce jour est validé. Décochez la validation pour modifier.";
    }
    return errorMessage || "Erreur lors de la modification.";
  };

  const handleDelete = (shiftId: string) => {
    deleteShiftMutation.mutate(
      { establishmentId, weekStart, employeeId: employee.user_id, shiftId },
      {
        onSuccess: () => {
          setPrefillErrorMessage(null);
          closeDialog();
        },
        onError: (error) =>
          setPrefillErrorMessage(error.message || "Erreur lors de la suppression."),
      }
    );
  };

  // Switch from leave to shift mode: cancel leave so user can create a shift
  const handleSwitchToShiftMode = async () => {
    if (!selectedDate) return;
    const leave = getLeaveForDate(selectedDate);
    if (!leave) return;
    try {
      await cancelLeaveAsync({
        userId: leave.user_id,
        leaveDate: leave.leave_date,
        leaveType: leave.leave_type,
        establishmentId,
        weekStart,
      });
      setPrefillErrorMessage(null);
    } catch {
      // Error handled by mutation
    }
  };

  // Quick-badge handler: Uses backfill edge function for a single day
  const handleBadgeShift = async (shift: PlanningShift) => {
    if (isBadgingShift) return;

    setIsBadgingShift(true);
    try {
      const { data, error } = await supabase.functions.invoke("badgeuse-backfill", {
        body: {
          establishment_id: establishmentId,
          start_date: shift.shift_date,
          end_date: shift.shift_date,
          mode: "skip",
          preview: false,
        },
      });

      if (error) {
        if (import.meta.env.DEV) console.error("Badge shift error:", error);
        setPrefillErrorMessage("Erreur lors du pré-remplissage du badge.");
        return;
      }

      if (data?.created_count > 0) {
        // Success - show toast and close dialog
        toast.success(
          `Badge créé (${data.created_count} pointage${data.created_count > 1 ? "s" : ""})`
        );
        setPrefillErrorMessage(null);
        closeDialog();
      } else if (data?.skipped_count > 0) {
        toast.info("Badge déjà existant pour ce jour");
        closeDialog();
      } else {
        // No badges created - check if shift is in the future (PHASE 0 blocking)
        // Compare shift end time to current service day time
        // If today's date matches shift date but shift end is in future → blocking dialog
        const now = new Date();
        const [shiftEndH, shiftEndM] = shift.end_time.split(":").map(Number);

        // Check if the shift date is today or in the future
        const isShiftDateToday = todayStr === shift.shift_date;
        const isShiftDateFuture = shift.shift_date > todayStr;

        // For today: check if shift end time is in the future
        const parisNow = new Intl.DateTimeFormat("fr-FR", {
          timeZone: "Europe/Paris",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).formatToParts(now);
        const nowH = parseInt(parisNow.find((p) => p.type === "hour")?.value || "0", 10);
        const nowM = parseInt(parisNow.find((p) => p.type === "minute")?.value || "0", 10);
        const nowMinutes = nowH * 60 + nowM;
        const shiftEndMinutes = shiftEndH * 60 + shiftEndM;

        const isShiftEndInFuture =
          isShiftDateFuture || (isShiftDateToday && shiftEndMinutes > nowMinutes);

        if (isShiftEndInFuture) {
          // ✅ Unified blocking popup for future badges (same as PlanningWeekGrid)
          showBlockingDialog({
            title: "Badge non pris en compte",
            message: "Hors délais.",
          });
          closeDialog();
        } else {
          setPrefillErrorMessage("Aucun badge créé - vérifiez le shift.");
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("Badge shift exception:", err);
      setPrefillErrorMessage("Erreur inattendue lors du badge.");
    } finally {
      setIsBadgingShift(false);
    }
  };

  // DnD handlers
  const handleDragEnter = (date: string) => setDragOverDate(date);
  const handleDragLeave = () => setDragOverDate(null);

  const handleDrop = (targetDate: string, e: React.DragEvent) => {
    setDragOverDate(null);
    const payload = parseDragPayload(e);
    if (!payload) return;

    // ═══════════════════════════════════════════════════════
    // LEAVE D&D: Move a leave from source date to target date
    // ═══════════════════════════════════════════════════════
    if (payload.isLeave) {
      // Only same-employee leave copies are supported
      if (payload.fromEmployeeId !== employee.user_id) {
        toast.error("Impossible de déplacer un congé vers un autre employé.");
        return;
      }
      // No-op: dropping on same date
      if (payload.sourceDate === targetDate) return;
      // Prevent concurrent leave DnD
      if (leaveDndPendingRef.current) return;

      // Map leaveType from drag payload back to DB type
      const dbLeaveType: "cp" | "absence" | "rest" | "am" =
        payload.leaveType === "repos" ? "rest" : (payload.leaveType as "cp" | "absence" | "am");

      // Check if target already has a leave
      const existingTargetLeave = getLeaveForDate(targetDate);
      if (existingTargetLeave) {
        toast.error("Un congé existe déjà sur cette journée.");
        return;
      }

      // ── Optimistic update on the leaves cache (COPY: keep source, add target) ──
      const leavesPartialKey = ["personnel-leaves", establishmentId];
      const leaveSnapshots: Array<{ queryKey: readonly unknown[]; data: PersonnelLeave[] }> = [];

      const entries = queryClient.getQueriesData<PersonnelLeave[]>({
        queryKey: leavesPartialKey,
      });
      for (const [queryKey, data] of entries) {
        if (data) {
          leaveSnapshots.push({ queryKey, data });
          // COPY: keep all existing leaves, just add new one at target
          const updated = [...data];
          updated.push({
            id: `temp-leave-${Date.now()}`,
            user_id: employee.user_id,
            leave_date: targetDate,
            leave_type: dbLeaveType,
            status: "approved",
            reason: null,
          });
          queryClient.setQueryData(queryKey, updated);
        }
      }

      const revertLeaveCache = () => {
        for (const { queryKey, data } of leaveSnapshots) {
          queryClient.setQueryData(queryKey, data);
        }
      };

      const invalidateLeaves = () => {
        queryClient.invalidateQueries({ queryKey: leavesPartialKey });
        queryClient.invalidateQueries({
          queryKey: ["planning-week", establishmentId, weekStart],
        });
      };

      // ── API call: COPY = only mark_leave at target (source stays) ──
      leaveDndPendingRef.current = true;

      const executeLeaveDnd = async () => {
        try {
          const { data: markData, error: markError } = await supabase.functions.invoke(
            "planning-week",
            {
              body: {
                action: "mark_leave",
                establishment_id: establishmentId,
                user_id: employee.user_id,
                leave_date: targetDate,
                leave_type: dbLeaveType,
              },
            }
          );
          if (markError) throw new Error(markError.message || "Erreur marquage congé");
          if (markData?.error) throw new Error(markData.error);
        } catch {
          revertLeaveCache();
          toast.error("Impossible de dupliquer le congé");
        } finally {
          invalidateLeaves();
          leaveDndPendingRef.current = false;
        }
      };

      executeLeaveDnd();
      return;
    }

    // ═══════════════════════════════════════════════════════
    // SHIFT D&D (existing logic)
    // ═══════════════════════════════════════════════════════
    const leave = getLeaveForDate(targetDate);
    if (leave) {
      setPendingDropIntent({ targetDate, payload, leave });
      return;
    }

    const blockingError = getDropBlockingError(targetDate, openingByDate, shiftsByDate);
    if (blockingError) {
      setPrefillStartTime(payload.start_time);
      setPrefillEndTime(payload.end_time);
      setPrefillErrorMessage(blockingError);
      setSelectedDate(targetDate);
      setManagementDialogOpen(true);
      return;
    }

    // Use optimistic DnD: instant visual update, API call in background
    handleOptimisticDrop({
      targetDate,
      payload,
      targetUserId: employee.user_id,
    });
  };

  const handleConfirmReplaceLeave = async () => {
    if (!pendingDropIntent) return;
    setIsReplacingLeave(true);

    try {
      await cancelLeaveAsync({
        userId: pendingDropIntent.leave.user_id,
        leaveDate: pendingDropIntent.leave.leave_date,
        leaveType: pendingDropIntent.leave.leave_type,
        establishmentId,
        weekStart,
      });
      // Use optimistic DnD after leave is cancelled
      handleOptimisticDrop({
        targetDate: pendingDropIntent.targetDate,
        payload: pendingDropIntent.payload,
        targetUserId: employee.user_id,
      });
      setIsReplacingLeave(false);
      setPendingDropIntent(null);
    } catch {
      setIsReplacingLeave(false);
      setPendingDropIntent(null);
    }
  };

  return (
    <>
      <div
        className="flex border-b hover:bg-muted/10 transition-colors"
        onDragLeave={handleDragLeave}
      >
        {/* Employee name - sticky left */}
        <div
          className={cn(
            "w-48 flex-shrink-0 px-3 py-2 border-r bg-background sticky left-0 z-10 flex items-center gap-2",
            rextraBalanceDisplay && "bg-emerald-50 dark:bg-emerald-950/30"
          )}
        >
          <span
            className={cn(
              "text-sm font-medium truncate",
              rextraBalanceDisplay ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"
            )}
          >
            {employeeName}
          </span>
          {rextraBalanceDisplay && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-emerald-500 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 flex-shrink-0"
            >
              {rextraBalanceDisplay}
            </Badge>
          )}
          {canManagePlanning && (
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 flex-shrink-0"
                      disabled={isCopyBlocked || copyPreviousWeekMutation.isPending}
                      onClick={handleCopyClick}
                      aria-label="Copier la semaine précédente"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isCopyBlocked
                      ? "Impossible : jour(s) ou semaine validé(s)"
                      : copyPreviousWeekMutation.isPending
                        ? "Copie en cours..."
                        : "Copier la semaine précédente"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {onSaveFavorite && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 flex-shrink-0"
                        onClick={() => onSaveFavorite(employee.user_id)}
                        aria-label={
                          hasFavoriteMatch
                            ? `Favori actif : ${matchedFavoriteName ?? "Favori"}`
                            : favoriteCount > 0
                              ? `${favoriteCount} favori(s) enregistre(s)`
                              : "Enregistrer comme favori"
                        }
                      >
                        <Star
                          className={cn(
                            "h-3.5 w-3.5",
                            hasFavoriteMatch
                              ? "fill-yellow-500 text-yellow-500"
                              : favoriteCount > 0
                                ? "fill-yellow-200 text-yellow-400"
                                : "text-muted-foreground"
                          )}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {hasFavoriteMatch
                        ? `Favori actif : ${matchedFavoriteName ?? "Favori"}`
                        : favoriteCount > 0
                          ? `${favoriteCount} favori(s) — Cliquer pour gerer`
                          : "Enregistrer comme favori"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </>
          )}
        </div>

        {/* Day cells */}
        {dates.map((date) => {
          const isWeekend = weekendDates.has(date);
          const isToday = date === todayStr;
          const leave = getLeaveForDate(date);
          const hasConflict = leave && (shiftsByDate[date] || []).length > 0;

          return (
            <div
              key={date}
              className="w-[160px] flex-shrink-0"
              onDragEnter={() => handleDragEnter(date)}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(date, e);
              }}
            >
              <PlanningWeekCell
                shifts={shiftsByDate[date]}
                isWeekend={isWeekend}
                isToday={isToday}
                onClick={() => handleCellClick(date)}
                onShiftDragStart={() => {}}
                canManagePlanning={canManagePlanning}
                isDragOver={dragOverDate === date}
                leave={leave}
                hasConflict={hasConflict}
                onMarkLeave={
                  canManagePlanning && !leave
                    ? () => onMarkLeave(employee.user_id, employeeName, date)
                    : undefined
                }
                onCancelLeave={
                  canManagePlanning && leave
                    ? () => onCancelLeave(leave, employeeName, date)
                    : undefined
                }
                rextraMinutes={rextraByDate[date] ?? 0}
                employeeId={employee.user_id}
                cellDate={date}
              />
            </div>
          );
        })}

        {/* Total hours - sticky right */}
        <div className="w-[72px] flex-shrink-0 px-1 py-2 text-center bg-background sticky right-0 z-10 flex items-center justify-center border-l">
          <span className="text-sm font-semibold text-foreground">
            {formatMinutesToHours(totalMinutes)}
          </span>
        </div>
      </div>

      {/* Shift Management Dialog */}
      <ShiftManagementDialog
        isOpen={managementDialogOpen}
        onClose={closeDialog}
        onSaveSuccess={() => {
          closeDialog();
        }}
        employeeName={employeeName}
        shiftDate={selectedDate || ""}
        existingShifts={selectedDate ? shiftsByDate[selectedDate] || [] : []}
        openingWindow={selectedDate ? openingByDate[selectedDate] : undefined}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        isCreating={createShiftMutation.isPending}
        isUpdating={updateShiftMutation.isPending}
        isDeleting={deleteShiftMutation.isPending}
        prefillStartTime={prefillStartTime}
        prefillEndTime={prefillEndTime}
        errorMessage={prefillErrorMessage}
        onClearError={() => setPrefillErrorMessage(null)}
        onMarkLeave={canManagePlanning ? handleMarkLeaveFromDialog : undefined}
        isMarkingLeave={isMarkingLeave}
        existingLeaveType={
          selectedDate ? (getLeaveForDate(selectedDate)?.leave_type ?? null) : null
        }
        onCancelLeave={
          canManagePlanning && selectedDate && getLeaveForDate(selectedDate)
            ? () => {
                const leave = getLeaveForDate(selectedDate);
                if (leave) {
                  cancelLeaveAsync({
                    userId: leave.user_id,
                    leaveDate: leave.leave_date,
                    leaveType: leave.leave_type,
                    establishmentId,
                    weekStart,
                  }).then(() => {
                    setPrefillErrorMessage(null);
                  });
                }
              }
            : undefined
        }
        isCancelingLeave={isCancelingLeave}
        onBadgeShift={canManagePlanning ? handleBadgeShift : undefined}
        isBadging={isBadgingShift}
        rextraBalanceMinutes={rextraBalance}
        existingRextraMinutes={selectedDate ? (rextraByDate[selectedDate] ?? 0) : 0}
        onSetRextra={(minutes) => {
          if (!selectedDate) return;
          rextraMutations.setRextra({
            establishmentId,
            userId: employee.user_id,
            eventDate: selectedDate,
            minutes,
            weekStart,
          });
        }}
        onClearRextra={() => {
          if (!selectedDate) return;
          rextraMutations.clearRextra({
            establishmentId,
            userId: employee.user_id,
            eventDate: selectedDate,
            weekStart,
          });
        }}
        isSettingRextra={rextraMutations.isSettingRextra}
        isClearingRextra={rextraMutations.isClearingRextra}
        keepOpenAfterOperation={false}
        onSwitchToShiftMode={canManagePlanning ? handleSwitchToShiftMode : undefined}
      />

      {/* Replace Leave on Drop Modal */}
      <ReplaceLeaveOnDropController
        pendingDropIntent={pendingDropIntent}
        employeeName={employeeName}
        isReplacingLeave={isReplacingLeave}
        isCancelingLeave={isCancelingLeave}
        onClose={() => setPendingDropIntent(null)}
        onConfirm={handleConfirmReplaceLeave}
      />

      {/* Copy Previous Week Modal */}
      <CopyPreviousWeekModal
        isOpen={copyModalOpen}
        onClose={() => setCopyModalOpen(false)}
        onConfirm={(mode) => {
          copyPreviousWeekMutation.mutate(
            {
              establishmentId,
              weekStart,
              userId: employee.user_id,
              mode,
            },
            {
              onSuccess: () => setCopyModalOpen(false),
            }
          );
        }}
        isLoading={copyPreviousWeekMutation.isPending}
        employeeName={employeeName}
      />

      {/* Badge Warning Dialog for Update */}
      <AlertDialog open={badgeWarningOpen} onOpenChange={setBadgeWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer les pointages ?</AlertDialogTitle>
            <AlertDialogDescription>
              {badgeCount} pointage(s) existe(nt) pour ce jour. Pour modifier ce shift, les
              pointages seront <strong>supprimés</strong>.
              <br />
              <br />
              Vous devrez refaire les pointages manuellement après modification.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelBadgeUpdate}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmBadgeUpdate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer et modifier
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* NOTE: R-Extra modal is now handled inside ShiftManagementDialog via ShiftManagementCore */}
    </>
  );
});

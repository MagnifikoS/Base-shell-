/**
 * Single employee card in the presence list
 * Shows: name, ALL sessions (shifts), status, late minutes, quick delete action
 * V5: Uses BadgeEditModalMulti for multi-shift editing in one modal
 */

import { useState, memo } from "react";
import { Trash2, ChevronRight, Clock, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BadgeEditModalMulti } from "./BadgeEditModalMulti";
import { BadgeDeleteConfirm } from "./BadgeDeleteConfirm";
import { useAdminBadgeMutations } from "@/hooks/presence/useAdminBadgeMutations";
import { formatLateMinutes } from "@/lib/presence/presence.compute";
import { minutesToXhYY } from "@/lib/time/paris";
import type { PresenceEmployeeCard, PresenceSession } from "@/lib/presence/presence.compute";

interface PresenceEmployeeRowProps {
  employee: PresenceEmployeeCard;
  /** Service day from usePresenceData - SINGLE SOURCE OF TRUTH */
  serviceDay?: string;
  /** Desktop passes resetDay handler with correct establishmentId */
  onResetDay?: (params: { targetUserId: string }) => Promise<unknown>;
  /** Desktop passes isResetting state */
  isResettingOverride?: boolean;
  /** Desktop passes establishmentId for BadgeEditModalMulti */
  establishmentId?: string;
}

export const PresenceEmployeeRow = memo(function PresenceEmployeeRow({
  employee,
  serviceDay,
  onResetDay,
  isResettingOverride,
  establishmentId,
}: PresenceEmployeeRowProps) {
  const [showEditModal, setShowEditModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // ✅ Fallback mobile: use hook directly if no handler passed
  const fallbackMutations = useAdminBadgeMutations(establishmentId);
  const resetDayFn = onResetDay ?? fallbackMutations.resetDay.mutateAsync;
  const isResetting = isResettingOverride ?? fallbackMutations.isResetting;

  // Show reset button if employee has ANY badge events
  const hasAnyBadgeEvents = employee.allEvents && employee.allEvents.length > 0;

  const handleQuickReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasAnyBadgeEvents) {
      setShowResetConfirm(true);
    }
  };

  const confirmReset = async () => {
    try {
      await resetDayFn({ targetUserId: employee.userId });
      setShowResetConfirm(false);
    } catch (_err) {
      // Error already handled by mutation's onError/toast
    }
  };

  /**
   * Open edit modal - now opens multi-shift modal with ALL sessions
   */
  const handleCardClick = () => {
    setShowEditModal(true);
  };

  // Determine overall status using UI flags (no "pending" enum)
  const hasPresent = employee.sessions.some((s) => s.status === "present");
  // All shifts not started yet (none finished without clock_in, none present)
  const allNotStartedYet = employee.sessions.every((s) => s.isNotStartedYet);
  // At least one finished without clock_in = true absence
  const _hasAbsence = employee.sessions.some((s) => s.isFinishedWithoutClockIn);
  // At least one shift finished without clock_out (forgotten departure)
  const hasForgottenClockOut = employee.sessions.some((s) => s.isFinishedWithoutClockOut);
  // Use totalLateMinutes (SUM of all sessions) - fallback to cumulativeLateMinutes for backwards compat
  const totalLate = employee.totalLateMinutes ?? employee.cumulativeLateMinutes;

  // V5: Badge-only employees (no planning, only badge events)
  const isBadgeOnly = employee.source === "badge_only";

  // V13: Anomaly flags (V15: hasAnyMismatch removed — doublon retard/départ anticipé)
  const hasPlanningModification = employee.hasPlanningModification ?? false;
  const hasForgottenArrival = employee.sessions.some(
    (s) => s.status === "unknown" && !s.clockIn && s.clockOut
  );

  // UI display priority: badge_only > forgotten_clock_out > present > pending (no badge) > absent
  const displayStatus = isBadgeOnly
    ? "badge_only"
    : hasForgottenClockOut
      ? "forgotten_clock_out"
      : hasPresent
        ? "present"
        : allNotStartedYet
          ? "pending"
          : "absent";

  // Card styling based on status
  // - present: green border + background
  // - forgotten_clock_out: red border + background (needs attention!)
  // - badge_only: purple border + background
  // - pending (no badge yet): no special border (neutral/white)
  // - absent: muted border
  const cardStatusClasses =
    displayStatus === "badge_only"
      ? "border-l-4 border-l-purple-500 bg-purple-50 dark:bg-purple-950/20"
      : displayStatus === "forgotten_clock_out"
        ? "border-l-4 border-l-destructive bg-destructive/10"
        : displayStatus === "present"
          ? "border-l-4 border-l-green-500 bg-green-50 dark:bg-green-950/30"
          : displayStatus === "pending"
            ? "" // No special styling = white/neutral card
            : "border-l-4 border-l-muted-foreground/30";

  return (
    <>
      <div
        className={`flex items-center gap-3 p-4 bg-card border border-border rounded-xl cursor-pointer hover:bg-accent/50 transition-colors ${cardStatusClasses}`}
        onClick={handleCardClick}
      >
        {/* Employee info */}
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{employee.fullName}</div>

          {/* All sessions */}
          {employee.sessions.map((session, idx) => (
            <SessionRow key={session.sequenceIndex} session={session} isFirst={idx === 0} />
          ))}
        </div>

        {/* Status badge + late indicator */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge
            variant={
              displayStatus === "present" || displayStatus === "badge_only"
                ? "default"
                : displayStatus === "forgotten_clock_out"
                  ? "destructive"
                  : "secondary"
            }
            className={
              displayStatus === "badge_only"
                ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                : displayStatus === "forgotten_clock_out"
                  ? "" // Uses destructive variant styling
                  : displayStatus === "present"
                    ? "bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-900/30 dark:text-green-400"
                    : displayStatus === "pending"
                      ? "bg-muted text-muted-foreground"
                      : ""
            }
          >
            {displayStatus === "badge_only"
              ? "Hors planning"
              : displayStatus === "forgotten_clock_out"
                ? "Oubli sortie"
                : displayStatus === "present"
                  ? "Présent"
                  : displayStatus === "pending"
                    ? "À venir"
                    : "Absent"}
          </Badge>
          {totalLate > 0 && (
            <span className="text-xs font-medium text-destructive">
              Retard: {formatLateMinutes(totalLate)}
            </span>
          )}
          {hasForgottenArrival && (
            <span className="text-xs font-medium text-orange-600 dark:text-orange-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Arrivée non enregistrée
            </span>
          )}
          {hasPlanningModification && (
            <span className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
              <Info className="h-3 w-3" />
              Planning modifié
            </span>
          )}
        </div>

        {/* Quick reset (if has any badge events) */}
        {hasAnyBadgeEvents && (
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={handleQuickReset}
            disabled={isResetting}
            aria-label={`Réinitialiser les pointages de ${employee.fullName}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}

        {/* Chevron for detail */}
        <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
      </div>

      {/* Multi-shift Edit Modal */}
      <BadgeEditModalMulti
        open={showEditModal}
        onOpenChange={setShowEditModal}
        employeeCard={employee}
        establishmentId={establishmentId}
        serviceDay={serviceDay}
      />

      {/* Quick Reset Confirm */}
      {hasAnyBadgeEvents && (
        <BadgeDeleteConfirm
          open={showResetConfirm}
          onOpenChange={setShowResetConfirm}
          onConfirm={confirmReset}
          isDeleting={isResetting}
          employeeName={employee.fullName}
          eventType="reset_day"
          time={`${employee.allEvents.length} pointage(s)`}
        />
      )}
    </>
  );
});

/**
 * Sub-component for displaying a single session within the card
 */
interface SessionRowProps {
  session: PresenceSession;
  isFirst: boolean;
}

function SessionRow({ session, isFirst }: SessionRowProps) {
  const isPresent = session.status === "present";
  const isBadgeOnly = session.plannedStart === "--:--";
  const isOrphanClockOut = session.status === "unknown" && !session.clockIn && session.clockOut;

  return (
    <div
      className={`text-sm text-muted-foreground ${!isFirst ? "mt-1 pt-1 border-t border-border/50" : ""}`}
    >
      {isBadgeOnly ? (
        // Badge-only session: show badge times only
        <div className="flex items-center gap-2">
          <Clock className="h-3 w-3 text-purple-500 dark:text-purple-400" />
          <span>A: {session.clockIn || "--:--"}</span>
          {session.clockOut && <span>• D: {session.clockOut}</span>}
        </div>
      ) : (
        // Normal planned session
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span>
              Prévu: {session.plannedStart} - {session.plannedEnd}
            </span>
            {session.lateMinutes > 0 && (
              <span className="text-xs text-destructive">
                +{minutesToXhYY(session.lateMinutes)}
              </span>
            )}
            {session.earlyDepartureMinutes > 0 && (
              <span className="text-xs text-orange-600 dark:text-orange-400">
                -{minutesToXhYY(session.earlyDepartureMinutes)}
              </span>
            )}
            {session.planningModifiedAfterBadge && (
              <span
                className="text-xs text-blue-600 dark:text-blue-400"
                title="Le planning a été modifié après les pointages"
              >
                <Info className="h-3 w-3 inline" />
              </span>
            )}
          </div>
          {isPresent && (
            <div className="flex items-center gap-2 mt-0.5">
              <Clock className="h-3 w-3 text-primary" />
              <span>A: {session.clockIn}</span>
              {session.clockOut && <span>• D: {session.clockOut}</span>}
            </div>
          )}
          {isOrphanClockOut && (
            <div className="flex items-center gap-2 mt-0.5">
              <AlertTriangle className="h-3 w-3 text-orange-500" />
              <span className="text-xs text-orange-600 dark:text-orange-400">
                Arrivée non enregistrée (prévue à {session.plannedStart})
              </span>
              {session.clockOut && <span className="text-xs">D: {session.clockOut}</span>}
            </div>
          )}
          {session.isFinishedWithoutClockOut && (
            <div className="flex items-center gap-2 mt-0.5">
              <AlertTriangle className="h-3 w-3 text-destructive" />
              <span className="text-xs text-destructive">
                Départ non enregistré (prévu à {session.plannedEnd})
              </span>
              {session.clockIn && <span className="text-xs">A: {session.clockIn}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Desktop Presence Page - displays today's presence
 * V3.3: Admin view for presence (tabs handled by parent Badgeuse page)
 * V3.3.1: Accepts establishmentId prop to filter by admin-selected establishment
 * V4: Added day part filter (morning/midday/evening)
 * V6: PHASE 2.7 - Removed local usePresenceRealtime (now global in AppLayout)
 * V8: Removed unused forwardRef (ResponsiveRoute does not pass refs)
 */

import { useState, useEffect, useMemo } from "react";
import { Users, RefreshCw, AlertTriangle } from "lucide-react";
import { PrintButton } from "@/components/ui/PrintButton";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { usePresenceData } from "@/hooks/presence/usePresenceData";
import { useAdminBadgeMutations } from "@/hooks/presence/useAdminBadgeMutations";
import { useDayPartFilter, type DayPartKey } from "@/hooks/presence/useDayPartFilter";
import { PresenceEmployeeRow } from "@/components/mobile/presence/PresenceEmployeeRow";
import { DayPartFilterBar } from "@/components/presence/DayPartFilterBar";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { filterByScope } from "@/lib/rbac/scope";
import type { PresenceEmployeeCard } from "@/lib/presence/presence.compute";

interface DesktopPresencePageProps {
  establishmentId?: string | null;
}

export function DesktopPresencePage({ establishmentId }: DesktopPresencePageProps) {
  const { employees, isLoading, error, refetch, today } = usePresenceData({
    establishmentId: establishmentId ?? undefined,
  });

  // RBAC scope filtering (PER-MGR-007)
  const { user } = useAuth();
  const { getScope, teamIds, establishmentIds, isAdmin } = usePermissions();

  // ✅ Instantiate mutations ONCE with admin establishmentId
  const adminMutations = useAdminBadgeMutations(establishmentId ?? undefined);

  // Day part filter
  const {
    options,
    initialPart,
    filter,
    isLoading: partsLoading,
    hasParts,
  } = useDayPartFilter(establishmentId);
  const [selectedPart, setSelectedPart] = useState<DayPartKey>("morning");

  // Auto-select current day part on mount
  useEffect(() => {
    if (!partsLoading && hasParts) {
      setSelectedPart(initialPart);
    }
  }, [partsLoading, hasParts, initialPart]);

  // Apply RBAC scope filtering on employees (PER-MGR-007)
  const scopeFilteredEmployees = useMemo(() => {
    if (!user || !employees.length) return employees;
    if (isAdmin) return employees;

    return filterByScope<PresenceEmployeeCard>({
      scope: getScope("presence"),
      userId: user.id,
      myTeamIds: teamIds,
      selectedEstablishmentId: establishmentId ?? null,
      myEstablishmentIds: establishmentIds,
      items: employees,
      getUserId: (emp) => emp.userId,
      getTeamId: (emp) => emp.teamId,
    });
  }, [employees, user, isAdmin, getScope, teamIds, establishmentIds, establishmentId]);

  // Filtered employees (day part filter applied AFTER scope filter)
  const filteredEmployees = useMemo(() => {
    return filter(scopeFilteredEmployees, selectedPart);
  }, [scopeFilteredEmployees, selectedPart, filter]);

  // Format today for display
  const formattedDate = new Date(today).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Count employees with at least one present session
  const presentCount = filteredEmployees.filter((e) =>
    e.sessions.some((s) => s.status === "present")
  ).length;
  const totalCount = filteredEmployees.length;

  // Guard: no establishment selected (after hooks)
  if (!establishmentId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">Choisis un établissement</p>
      </div>
    );
  }

  // Full-page error state when data completely failed to load
  if (error && !isLoading && employees.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <p className="text-lg font-medium text-destructive">Erreur de chargement</p>
        <p className="text-sm text-muted-foreground">
          {error.message || "Une erreur est survenue"}
        </p>
        <Button variant="outline" onClick={() => refetch()}>
          Réessayer
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Présence du jour</h2>
          <p className="text-sm text-muted-foreground capitalize">{formattedDate}</p>
        </div>
        <div className="flex items-center gap-2">
          <PrintButton />
          <Button variant="ghost" size="icon" onClick={() => refetch()} aria-label="Actualiser">
            <RefreshCw className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Day Part Filter */}
      {hasParts && (
        <DayPartFilterBar
          options={options}
          selected={selectedPart}
          onSelect={setSelectedPart}
          isLoading={partsLoading}
        />
      )}

      {/* Summary */}
      <div className="flex items-center gap-4 p-4 bg-primary/5 rounded-xl">
        <Users className="h-8 w-8 text-primary" />
        <div>
          <div className="text-2xl font-bold">
            {presentCount} / {totalCount}
          </div>
          <div className="text-sm text-muted-foreground">salariés présents</div>
        </div>
      </div>

      {/* Glossaire presence */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          Retard <HelpTooltip text="Arrivée après l'heure planifiée" />
        </span>
        <span className="flex items-center gap-1">
          Départ anticipé <HelpTooltip text="Départ avant l'heure planifiée de fin" />
        </span>
        <span className="flex items-center gap-1">
          Absence <HelpTooltip text="Journée complète non travaillée" />
        </span>
        <span className="flex items-center gap-1">
          Oubli pointage <HelpTooltip text="Arrivée ou départ non enregistré pour un shift" />
        </span>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center justify-between">
          <p className="text-sm text-destructive">{error.message || "Une erreur est survenue"}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Réessayer
          </Button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && <TableSkeleton rows={6} columns={3} />}

      {/* Employee list */}
      {!isLoading && filteredEmployees.length === 0 ? (
        <EmptyState
          icon={<Users className="h-12 w-12" />}
          title={
            employees.length === 0
              ? "Aucun salarié planifié aujourd'hui"
              : "Aucun salarié pour cette période"
          }
          description="Vérifiez le planning ou sélectionnez une autre période."
        />
      ) : (
        <div className="space-y-3 max-w-2xl">
          {filteredEmployees.map((employee) => (
            <PresenceEmployeeRow
              key={employee.userId}
              employee={employee}
              serviceDay={today}
              onResetDay={adminMutations.resetDay.mutateAsync}
              isResettingOverride={adminMutations.isResetting}
              establishmentId={establishmentId ?? undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

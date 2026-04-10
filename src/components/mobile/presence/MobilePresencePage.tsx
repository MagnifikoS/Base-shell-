/**
 * Mobile admin page: Presence overview with tabs (Présence, Extra, Retard, Absence)
 * V3.X: Added Retard + Absence tabs
 * V4: Added day part filter (morning/midday/evening)
 * V6: PHASE 2.7 - Removed local usePresenceRealtime (now global in AppLayout)
 */

import { useState, useEffect, useMemo } from "react";
import { MobileLayout } from "@/components/mobile/MobileLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePresenceData } from "@/hooks/presence/usePresenceData";
import { useDayPartFilter, type DayPartKey } from "@/hooks/presence/useDayPartFilter";
import { PresenceEmployeeRow } from "./PresenceEmployeeRow";
import { DayPartFilterBar } from "@/components/presence/DayPartFilterBar";
import { ExtraTab } from "@/components/presence/ExtraTab";
import { RetardTab } from "@/components/presence/RetardTab";
import { AbsenceTab } from "@/components/presence/AbsenceTab";
import { Loader2, Users, Clock, RefreshCw, AlertTriangle, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { filterByScope } from "@/lib/rbac/scope";
import type { PresenceEmployeeCard } from "@/lib/presence/presence.compute";

export function MobilePresencePage() {
  const { employees, isLoading, error, refetch, today } = usePresenceData();
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id ?? null;

  // RBAC scope filtering (PER-MGR-007)
  const { user } = useAuth();
  const { getScope, teamIds, establishmentIds, isAdmin } = usePermissions();

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
      selectedEstablishmentId: establishmentId,
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

  return (
    <MobileLayout>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Présence</h1>
          <Button variant="ghost" size="icon" onClick={() => refetch()} aria-label="Actualiser">
            <RefreshCw className="h-5 w-5" />
          </Button>
        </div>

        <Tabs defaultValue="presence" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="presence" className="flex items-center gap-1 text-xs px-2">
              <Users className="h-3 w-3" />
              Présence
            </TabsTrigger>
            <TabsTrigger value="extra" className="flex items-center gap-1 text-xs px-2">
              <Clock className="h-3 w-3" />
              Extra
            </TabsTrigger>
            <TabsTrigger value="retard" className="flex items-center gap-1 text-xs px-2">
              <AlertTriangle className="h-3 w-3" />
              Retard
            </TabsTrigger>
            <TabsTrigger value="absence" className="flex items-center gap-1 text-xs px-2">
              <UserX className="h-3 w-3" />
              Absence
            </TabsTrigger>
          </TabsList>

          {/* Présence Tab */}
          <TabsContent value="presence" className="mt-4">
            <div className="space-y-4">
              {/* Day Part Filter */}
              {hasParts && (
                <DayPartFilterBar
                  options={options}
                  selected={selectedPart}
                  onSelect={setSelectedPart}
                  isLoading={partsLoading}
                />
              )}

              {/* Date */}
              <p className="text-sm text-muted-foreground capitalize">{formattedDate}</p>

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

              {/* Error state */}
              {error && (
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl">
                  <p className="text-sm text-destructive">{error.message}</p>
                </div>
              )}

              {/* Loading state */}
              {isLoading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}

              {/* Employee list */}
              {!isLoading && filteredEmployees.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">
                    {employees.length === 0
                      ? "Aucun salarié planifié aujourd'hui"
                      : "Aucun salarié pour cette période"}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredEmployees.map((employee) => (
                    <PresenceEmployeeRow
                      key={employee.userId}
                      employee={employee}
                      serviceDay={today}
                      establishmentId={establishmentId ?? undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Extra Tab */}
          <TabsContent value="extra" className="mt-4">
            <ExtraTab establishmentId={establishmentId} />
          </TabsContent>

          {/* Retard Tab */}
          <TabsContent value="retard" className="mt-4">
            <RetardTab establishmentId={establishmentId} />
          </TabsContent>

          {/* Absence Tab */}
          <TabsContent value="absence" className="mt-4">
            <AbsenceTab establishmentId={establishmentId} />
          </TabsContent>
        </Tabs>
      </div>
    </MobileLayout>
  );
}

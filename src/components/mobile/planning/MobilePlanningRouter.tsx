/**
 * MobilePlanningRouter
 *
 * UNIQUE point de décision pour le planning mobile basé sur le SCOPE RBAC:
 * - scope "establishment" ou "org" → AdminEmployeeSelector puis AdminEmployeePlanningView
 * - scope "team" ou "self" → MobilePlanning (vue individuelle)
 *
 * PHASE 2.7: Removed local usePlanningRealtime (now global in AppLayout)
 * PHASE 2.8: Replaced isAdmin with getScope("planning") for RBAC-driven access
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { usePlanningWeek } from "@/components/planning/hooks/usePlanningWeek";
import { usePrefetchAdjacentWeeks } from "./hooks/usePrefetchAdjacentWeeks";
import { getMonday } from "@/lib/planning-engine/format";
import { MobilePlanning } from "./MobilePlanning";
import { AdminEmployeeSelector } from "./admin/AdminEmployeeSelector";
import { AdminEmployeePlanningView } from "./admin/AdminEmployeePlanningView";

interface SelectedEmployee {
  userId: string;
  fullName: string;
}

// ══════════════════════════════════════════════════════════════
// SESSION STORAGE HELPERS (safe access, scoped per establishment)
// ══════════════════════════════════════════════════════════════
const STORAGE_KEY_EMPLOYEE = (estId: string) => `planning-admin-employee-${estId}`;
const STORAGE_KEY_WEEK = (estId: string) => `planning-admin-week-${estId}`;

function safeSessionGet<T>(key: string, fallback: T): T {
  try {
    const value = sessionStorage.getItem(key);
    if (!value) return fallback;
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function safeSessionSet(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sessionStorage unavailable, fail silently
  }
}

function safeSessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // sessionStorage unavailable, fail silently
  }
}

export function MobilePlanningRouter() {
  const { getScope, can } = usePermissions();
  const { activeEstablishment } = useEstablishment();
  const selectedEstablishmentId = activeEstablishment?.id ?? null;

  // ══════════════════════════════════════════════════════════════
  // RBAC-DRIVEN ADMIN VIEW:
  // - scope "establishment" or "org" → can see all employees (admin view)
  // - scope "team" → see team members only (currently: fallback to self view)
  // - scope "self" → see only own planning (employee view)
  // ══════════════════════════════════════════════════════════════
  const planningScope = getScope("planning");
  const hasAdminView = planningScope === "establishment" || planningScope === "org";

  // DIAGNOSTIC: Log temporaire pour confirmer le fix (à supprimer après validation)
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[MobilePlanningRouter] DIAGNOSTIC", {
      selectedEstablishmentId,
      planningScope,
      hasAdminView,
      canRead: can("planning", "read"),
    });
  }

  // ══════════════════════════════════════════════════════════════
  // ÉTAT ADMIN: persisté en sessionStorage (scopé par établissement)
  // Hooks MUST be called unconditionally - use guards inside
  // ══════════════════════════════════════════════════════════════
  const [selectedEmployee, setSelectedEmployee] = useState<SelectedEmployee | null>(() => {
    if (!selectedEstablishmentId) return null;
    return safeSessionGet<SelectedEmployee | null>(
      STORAGE_KEY_EMPLOYEE(selectedEstablishmentId),
      null
    );
  });

  // Track previous establishment ID to detect changes
  const prevEstablishmentIdRef = useRef<string | null>(selectedEstablishmentId);

  // ══════════════════════════════════════════════════════════════
  // NIVEAU 2: weekStart = source unique au Router (persisté)
  // ══════════════════════════════════════════════════════════════
  const [weekStart, setWeekStart] = useState(() => {
    if (!selectedEstablishmentId) return getMonday(new Date());
    return safeSessionGet<string>(STORAGE_KEY_WEEK(selectedEstablishmentId), getMonday(new Date()));
  });

  // ══════════════════════════════════════════════════════════════
  // NIVEAU 2: FETCH UNIQUE - admin view gère ici, self/team dans MobilePlanning
  // Uses hasAdminView (RBAC scope) instead of isAdmin
  // ══════════════════════════════════════════════════════════════
  const {
    data: planningData,
    isLoading,
    error,
  } = usePlanningWeek(
    hasAdminView ? selectedEstablishmentId : null,
    hasAdminView ? weekStart : null
  );

  // ══════════════════════════════════════════════════════════════
  // NIVEAU 3: PREFETCH SEMAINES ADJACENTES (-1 / +1)
  // Non-bloquant, silencieux, annulable
  // ══════════════════════════════════════════════════════════════
  usePrefetchAdjacentWeeks({
    establishmentId: selectedEstablishmentId,
    weekStart,
    enabled: hasAdminView && !!selectedEstablishmentId && !!planningData,
  });

  // ══════════════════════════════════════════════════════════════
  // PERSIST: Sauvegarde en sessionStorage à chaque changement
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!selectedEstablishmentId) return;
    safeSessionSet(STORAGE_KEY_EMPLOYEE(selectedEstablishmentId), selectedEmployee);
  }, [selectedEmployee, selectedEstablishmentId]);

  useEffect(() => {
    if (!selectedEstablishmentId) return;
    safeSessionSet(STORAGE_KEY_WEEK(selectedEstablishmentId), weekStart);
  }, [weekStart, selectedEstablishmentId]);

  // ══════════════════════════════════════════════════════════════
  // Reset selectedEmployee on establishment change (admin only)
  // + Nettoie sessionStorage de l'ancien établissement
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    const currentId = selectedEstablishmentId;
    const prevId = prevEstablishmentIdRef.current;

    // Only reset if establishment actually changed (not on initial mount)
    if (prevId !== null && currentId !== null && prevId !== currentId) {
      // Reset state for new establishment
      setSelectedEmployee(null);
      setWeekStart(getMonday(new Date()));
      // Clean up old establishment's sessionStorage
      safeSessionRemove(STORAGE_KEY_EMPLOYEE(prevId));
      safeSessionRemove(STORAGE_KEY_WEEK(prevId));
    }

    // Update ref for next comparison
    prevEstablishmentIdRef.current = currentId;
  }, [selectedEstablishmentId]);

  // Memoized callback to avoid re-renders in AdminEmployeeSelector
  const handleSelectEmployee = useCallback((userId: string, fullName: string) => {
    setSelectedEmployee({ userId, fullName });
  }, []);

  // Memoized callback for back navigation
  const handleBack = useCallback(() => {
    setSelectedEmployee(null);
  }, []);

  // ══════════════════════════════════════════════════════════════
  // GUARD: Si aucun établissement, déléguer à MobilePlanning qui gère ce cas
  // ══════════════════════════════════════════════════════════════
  if (!selectedEstablishmentId) {
    return <MobilePlanning />;
  }

  // Non-admin view (self/team scope): MobilePlanning tel quel
  // (MobilePlanning gère son propre fetch indépendamment)
  if (!hasAdminView) {
    return <MobilePlanning />;
  }

  // Admin view sans sélection: liste des salariés
  if (!selectedEmployee) {
    return (
      <AdminEmployeeSelector
        onSelectEmployee={handleSelectEmployee}
        employees={planningData?.employees ?? []}
        isLoading={isLoading}
        error={error}
        weekStart={weekStart}
        onWeekChange={setWeekStart}
        validation={planningData?.validation}
        establishmentId={selectedEstablishmentId}
      />
    );
  }

  // Admin view avec sélection: planning du salarié
  return (
    <AdminEmployeePlanningView
      employeeUserId={selectedEmployee.userId}
      employeeFullName={selectedEmployee.fullName}
      onBack={handleBack}
      planningData={planningData}
      isLoading={isLoading}
      error={error}
      weekStart={weekStart}
      setWeekStart={setWeekStart}
    />
  );
}

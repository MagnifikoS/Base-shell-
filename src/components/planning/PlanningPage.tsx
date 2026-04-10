import { useState, useMemo, useEffect, useCallback } from "react";
import { usePlanningWeek } from "./hooks/usePlanningWeek";
import { PlanningTopBar } from "./layout/PlanningTopBar";
import { PlanningWeekGrid } from "./week/PlanningWeekGrid";
import { PlanningEntryPage, type DepartmentKey, DEPARTMENTS } from "./PlanningEntryPage";
import { CopyWeekBulkModal } from "./week/CopyWeekBulkModal";
import { getMonday } from "@/lib/planning-engine/format";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Building2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { filterByScope } from "@/lib/rbac/scope";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";
import { usePrefetchAdjacentWeeks } from "@/components/mobile/planning/hooks/usePrefetchAdjacentWeeks";
import type { PlanningWeekData, PlanningEmployee } from "./types/planning.types";

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1 : Mode d'affichage UI (entry → general | department)
// Aucun hook métier modifié, filtrage visuel uniquement
// ═══════════════════════════════════════════════════════════════════════════
type ViewMode = "entry" | "general" | DepartmentKey;

export function PlanningPage() {
  const { user } = useAuth();
  const {
    activeEstablishmentId: selectedEstablishmentId,
    activeEstablishment,
    setActiveEstablishment,
    accessibleEstablishments,
  } = useEstablishmentAccess();
  const selectedEstablishmentLabel = activeEstablishment?.name ?? null;
  const { getScope, teamIds, establishmentIds, isAdmin, can } = usePermissions();

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1 : État local pour le mode d'affichage (entry par défaut)
  // ═══════════════════════════════════════════════════════════════════════════
  const [viewMode, setViewMode] = useState<ViewMode>("entry");

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 3 : État modale "Copier la semaine précédente"
  // ═══════════════════════════════════════════════════════════════════════════
  const [isCopyWeekModalOpen, setIsCopyWeekModalOpen] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // Planning Favorites: dialog state (V2 dialog lives in PlanningWeekGrid)
  // ═══════════════════════════════════════════════════════════════════════════
  const [isFavoritesDialogOpen, setIsFavoritesDialogOpen] = useState(false);

  const handleOpenFavoritesDialog = useCallback(() => {
    setIsFavoritesDialogOpen(true);
  }, []);

  const handleCloseFavoritesDialog = useCallback(() => {
    setIsFavoritesDialogOpen(false);
  }, []);

  // Reset to entry when establishment changes
  useEffect(() => {
    setViewMode("entry");
  }, [selectedEstablishmentId]);

  // ✅ RBAC: Can user navigate weeks?
  const canWritePlanning = can("planning", "write");

  // ✅ SERVICE DAY: Single source of truth for "today" (Paris timezone, cutoff-aware)
  const { data: serviceDay } = useServiceDayToday(selectedEstablishmentId);

  // Compute current week from serviceDay (not new Date())
  const serviceDayMonday = useMemo(() => {
    if (!serviceDay) return getMonday(new Date()); // fallback during load
    const d = new Date(serviceDay + "T12:00:00"); // noon to avoid TZ issues
    return getMonday(d);
  }, [serviceDay]);

  // Auto-select unique establishment — utilise le setter SSOT
  useEffect(() => {
    if (selectedEstablishmentId === null && accessibleEstablishments.length === 1) {
      // Use the actual establishment object from accessibleEstablishments
      setActiveEstablishment(accessibleEstablishments[0]);
    }
  }, [selectedEstablishmentId, accessibleEstablishments, setActiveEstablishment]);

  // Week state - initialized to service day monday
  const [weekStartInternal, setWeekStartInternal] = useState(() => getMonday(new Date()));

  // ✅ GUARD: Force current week if read-only
  useEffect(() => {
    if (!canWritePlanning && weekStartInternal !== serviceDayMonday) {
      setWeekStartInternal(serviceDayMonday);
    }
  }, [canWritePlanning, serviceDayMonday, weekStartInternal]);

  // ✅ GUARDED SETTER: Ignores navigation if read-only
  const setWeekStart = useCallback(
    (newWeek: string) => {
      if (!canWritePlanning) return; // Block navigation for read-only
      setWeekStartInternal(newWeek);
    },
    [canWritePlanning]
  );

  // Effective weekStart (forced to current if read-only)
  const weekStart = canWritePlanning ? weekStartInternal : serviceDayMonday;

  const { data, isLoading, isFetching, error, refetch } = usePlanningWeek(
    selectedEstablishmentId,
    weekStart
  );

  // PERF: Prefetch adjacent weeks for instant navigation
  usePrefetchAdjacentWeeks({
    establishmentId: selectedEstablishmentId,
    weekStart,
    enabled: !!data && !isLoading,
  });

  // Filter employees by scope (RBAC)
  const scopeFilteredData = useMemo<PlanningWeekData | null>(() => {
    if (!data || !user) return data ?? null;

    // Admin sees everything
    if (isAdmin) return data;

    const scope = getScope("planning");

    // Planning data is already filtered by establishment (payload comes from edge function)
    // We only need to apply self/team filtering on employees
    const filteredEmployees = filterByScope<PlanningEmployee>({
      scope,
      userId: user.id,
      myTeamIds: teamIds,
      selectedEstablishmentId,
      myEstablishmentIds: establishmentIds,
      items: data.employees,
      getUserId: (emp) => emp.user_id,
      getTeamId: (emp) => emp.team_id,
      // Don't filter by establishment_id since data is already for selected establishment
    });

    // Filter shiftsByEmployee and totalsByEmployee to match filtered employees
    const filteredUserIds = new Set(filteredEmployees.map((e) => e.user_id));
    const filteredShiftsByEmployee: Record<string, (typeof data.shiftsByEmployee)[string]> = {};
    const filteredTotalsByEmployee: Record<string, number> = {};

    for (const userId of filteredUserIds) {
      if (data.shiftsByEmployee[userId]) {
        filteredShiftsByEmployee[userId] = data.shiftsByEmployee[userId];
      }
      if (data.totalsByEmployee[userId] !== undefined) {
        filteredTotalsByEmployee[userId] = data.totalsByEmployee[userId];
      }
    }

    return {
      ...data,
      employees: filteredEmployees,
      shiftsByEmployee: filteredShiftsByEmployee,
      totalsByEmployee: filteredTotalsByEmployee,
    };
  }, [data, user, isAdmin, getScope, teamIds, establishmentIds, selectedEstablishmentId]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1 : Filtrage visuel par département (team_name)
  // Aucune mutation, même data, juste un filtre UI
  // ═══════════════════════════════════════════════════════════════════════════
  const filteredData = useMemo<PlanningWeekData | null>(() => {
    if (!scopeFilteredData) return null;

    // Mode général ou entry → pas de filtre département
    if (viewMode === "entry" || viewMode === "general") {
      return scopeFilteredData;
    }

    // Filtre par département (team_name match)
    const departmentName = viewMode; // viewMode est le nom du département
    const filteredEmployees = scopeFilteredData.employees.filter(
      (emp) => emp.team_name === departmentName
    );

    const filteredUserIds = new Set(filteredEmployees.map((e) => e.user_id));
    const filteredShiftsByEmployee: Record<
      string,
      (typeof scopeFilteredData.shiftsByEmployee)[string]
    > = {};
    const filteredTotalsByEmployee: Record<string, number> = {};

    for (const userId of filteredUserIds) {
      if (scopeFilteredData.shiftsByEmployee[userId]) {
        filteredShiftsByEmployee[userId] = scopeFilteredData.shiftsByEmployee[userId];
      }
      if (scopeFilteredData.totalsByEmployee[userId] !== undefined) {
        filteredTotalsByEmployee[userId] = scopeFilteredData.totalsByEmployee[userId];
      }
    }

    return {
      ...scopeFilteredData,
      employees: filteredEmployees,
      shiftsByEmployee: filteredShiftsByEmployee,
      totalsByEmployee: filteredTotalsByEmployee,
    };
  }, [scopeFilteredData, viewMode]);

  // Note: Teams disponibles supprimé — les tuiles sont toujours cliquables
  // Le filtrage par département se fait après le chargement des données

  // Label du département actif (pour l'affichage)
  const activeDepartmentLabel = useMemo(() => {
    if (viewMode === "entry" || viewMode === "general") return null;
    return DEPARTMENTS.find((d) => d.key === viewMode)?.label ?? viewMode;
  }, [viewMode]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 3 : Liste userId visibles (pour copie bulk)
  // ═══════════════════════════════════════════════════════════════════════════
  const visibleUserIds = useMemo(() => {
    if (!filteredData) return [];
    return filteredData.employees.map((emp) => emp.user_id);
  }, [filteredData]);

  // Détection jours validés (pour modale copie)
  const hasValidatedDays = useMemo(() => {
    if (!filteredData?.validation?.validatedDays) return false;
    return Object.values(filteredData.validation.validatedDays).some((v) => v === true);
  }, [filteredData]);

  // ✅ UX: Détection shifts existants dans le périmètre courant
  const hasExistingShifts = useMemo(() => {
    if (!filteredData) return false;
    // Vérifie si au moins un userId visible a au moins un shift cette semaine
    return visibleUserIds.some((userId) => {
      const shifts = filteredData.shiftsByEmployee[userId];
      return shifts && shifts.length > 0;
    });
  }, [filteredData, visibleUserIds]);

  // Handler retour vers la page d'entrée
  const handleBackToEntry = useCallback(() => {
    setViewMode("entry");
  }, []);

  // Handler ouvrir modale copie semaine
  const handleOpenCopyWeekModal = useCallback(() => {
    setIsCopyWeekModalOpen(true);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDERS
  // ═══════════════════════════════════════════════════════════════════════════

  // Pas d'établissement sélectionné
  if (!selectedEstablishmentId) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="text-muted-foreground">
              Sélectionnez un établissement dans la barre latérale pour afficher le planning.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1 : Page d'entrée (mode "entry")
  // Affichée en premier, avant le chargement du tableau
  // ═══════════════════════════════════════════════════════════════════════════
  if (viewMode === "entry") {
    // Phase P-PLANNING-1 : Tuiles toujours cliquables, pas de dépendance au loading
    return (
      <PlanningEntryPage
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        onSelectDepartment={(dept) => setViewMode(dept)}
        onSelectGeneral={() => setViewMode("general")}
      />
    );
  }

  // Loading initial UNIQUEMENT si pas de data (skeleton seulement au premier chargement)
  if (!filteredData && isLoading) {
    return (
      <div className="flex flex-col h-full gap-4">
        <PlanningTopBar
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          establishmentName={selectedEstablishmentLabel || undefined}
          establishmentId={selectedEstablishmentId || undefined}
          isLoading={true}
          canNavigate={canWritePlanning}
        />
        <div className="flex-1 p-4 space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    );
  }

  // Erreur
  if (error) {
    const is403 = error.message.includes("403") || error.message.includes("Forbidden");
    const isDayPartsNotConfigured = error.message.includes("Day parts not configured");
    // Show retry button for transient errors only (not auth/config problems)
    const canRetry = !is403 && !isDayPartsNotConfigured;

    return (
      <div className="flex flex-col h-full">
        <PlanningTopBar
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          establishmentName={selectedEstablishmentLabel || undefined}
          canNavigate={canWritePlanning}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive/70" />
            {isDayPartsNotConfigured ? (
              <>
                <p className="text-destructive font-medium">Journee non configuree</p>
                <p className="text-sm text-muted-foreground max-w-md">
                  Configurez Matin / Coupure / Soir dans Admin &gt; Etablissements &gt;{" "}
                  {selectedEstablishmentLabel || "Etablissement"} &gt; Journee.
                </p>
              </>
            ) : (
              <>
                <p className="text-destructive font-medium">
                  {is403 ? "Acces interdit" : "Erreur de chargement du planning"}
                </p>
                <p className="text-sm text-muted-foreground max-w-md">
                  {is403
                    ? "Vous n'avez pas les permissions pour acceder a ce planning."
                    : "Une erreur est survenue lors du chargement. Verifiez votre connexion et reessayez."}
                </p>
              </>
            )}
            {canRetry && (
              <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-2">
                Reessayer
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Data OK (ou previous data pendant refetch)
  // Show skeleton instead of blank screen when data is not yet available
  if (!filteredData) {
    return (
      <div className="flex flex-col h-full gap-4">
        <PlanningTopBar
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          establishmentName={selectedEstablishmentLabel || undefined}
          establishmentId={selectedEstablishmentId || undefined}
          isLoading={true}
          canNavigate={canWritePlanning}
        />
        <div className="flex-1 p-4 space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* TopBar avec bouton retour si on est dans un département */}
      <div className="flex items-center gap-2 border-b bg-card px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackToEntry}
          className="gap-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </Button>
        {activeDepartmentLabel && (
          <span className="text-sm font-medium text-foreground">{activeDepartmentLabel}</span>
        )}
      </div>
      <PlanningTopBar
        weekStart={weekStart}
        onWeekChange={setWeekStart}
        establishmentName={filteredData.establishment.name}
        establishmentId={selectedEstablishmentId || undefined}
        isLoading={isFetching}
        weekValidated={filteredData.validation.weekValidated}
        validatedDays={filteredData.validation.validatedDays}
        autoPublishActive={filteredData.validation.autoPublishActive}
        weekInvalidatedAt={filteredData.validation.weekInvalidatedAt}
        canNavigate={canWritePlanning}
        showCopyWeekButton={canWritePlanning}
        onCopyWeekClick={handleOpenCopyWeekModal}
        showFavoriButton={canWritePlanning}
        onFavoriClick={handleOpenFavoritesDialog}
      />
      <div className="flex-1 p-4 overflow-auto">
        <PlanningWeekGrid
          data={filteredData}
          applyFavoritesOpen={isFavoritesDialogOpen}
          onApplyFavoritesClose={handleCloseFavoritesDialog}
        />
      </div>

      {/* Phase 3 : Modale Copier la semaine précédente (bulk) */}
      {selectedEstablishmentId && (
        <CopyWeekBulkModal
          isOpen={isCopyWeekModalOpen}
          onClose={() => setIsCopyWeekModalOpen(false)}
          establishmentId={selectedEstablishmentId}
          weekStart={weekStart}
          visibleUserIds={visibleUserIds}
          activeDepartmentLabel={activeDepartmentLabel}
          hasValidatedDays={hasValidatedDays}
          weekValidated={filteredData.validation.weekValidated}
          hasExistingShifts={hasExistingShifts}
        />
      )}

      {/* Planning Favorites V2: dialog is rendered inside PlanningWeekGrid */}
    </div>
  );
}

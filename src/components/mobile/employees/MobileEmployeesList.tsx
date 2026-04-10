/**
 * Mobile employees list with scope applied SERVER-SIDE
 * Uses the employees edge function which enforces RBAC
 * Includes tabs for Active/Archived employees
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { MobileLayout } from "../MobileLayout";
import { MobileEmployeeCard, type MobileEmployeeData } from "./MobileEmployeeCard";
import { MobileEmployeeProfile } from "./MobileEmployeeProfile";
import { MobileEmployeesTabs, type EmployeeTabValue } from "./MobileEmployeesTabs";
import { MobileArchivedEmployeesList } from "./MobileArchivedEmployeesList";
import { usePermissions } from "@/hooks/usePermissions";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { supabase } from "@/integrations/supabase/client";
import { SearchInput } from "@/components/ui/SearchInput";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { usePagination } from "@/hooks/usePagination";
import { useListSearch } from "@/hooks/useListSearch";
import { ChevronLeft, Users, AlertCircle, Loader2 } from "lucide-react";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useNavigate } from "react-router-dom";

interface EmployeesResponse {
  employees: MobileEmployeeData[];
}

async function fetchEmployees(establishmentId: string | null): Promise<MobileEmployeeData[]> {
  const { data, error } = await supabase.functions.invoke("employees", {
    body: {
      action: "list",
      establishment_id: establishmentId,
    },
  });

  if (error) {
    throw new Error(error.message || "Erreur lors du chargement des employés");
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return (data as EmployeesResponse).employees || [];
}

interface EmployeeDetails {
  phone?: string | null;
  address?: string | null;
  position?: string | null;
  contract_type?: string | null;
  contract_start_date?: string | null;
  contract_end_date?: string | null;
  contract_hours?: number | null;
}

async function fetchEmployeeDetails(
  userId: string
): Promise<MobileEmployeeData & { details?: EmployeeDetails | null }> {
  const { data, error } = await supabase.functions.invoke("employees", {
    body: {
      action: "get",
      user_id: userId,
    },
  });

  if (error) {
    throw new Error(error.message || "Erreur lors du chargement du profil");
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data.employee;
}

export function MobileEmployeesList() {
  const navigate = useNavigate();
  const { activeEstablishment } = useEstablishment();
  const selectedEstablishmentId = activeEstablishment?.id ?? null;
  const { isAdmin, can } = usePermissions();

  const [activeTab, setActiveTab] = useState<EmployeeTabValue>("active");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  // Guard: check read access (using 'salaries' module as employees are managed there)
  const canFetch = isAdmin || can("salaries", "read");

  // Fetch employees list (only for active tab, and ONLY if establishmentId is set)
  const {
    data: employees = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["employees-mobile", selectedEstablishmentId],
    queryFn: () => fetchEmployees(selectedEstablishmentId!),
    enabled: canFetch && activeTab === "active" && !!selectedEstablishmentId,
    staleTime: 60000,
  });

  // Fetch selected employee details
  const { data: selectedEmployee, isLoading: isLoadingProfile } = useQuery({
    queryKey: ["employee-profile-mobile", selectedEmployeeId],
    queryFn: () => fetchEmployeeDetails(selectedEmployeeId!),
    enabled: !!selectedEmployeeId && canFetch,
    staleTime: 60000,
  });

  // Filter by search (using shared hook with debounce)
  const searchKeys: (keyof MobileEmployeeData)[] = ["full_name", "email", "position"];
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    filteredItems: filteredEmployees,
  } = useListSearch(employees, searchKeys);

  // Pagination (PERF-08)
  const {
    paginatedData: paginatedEmployees,
    currentPage,
    totalPages,
    totalItems,
    hasNextPage,
    hasPrevPage,
    nextPage,
    prevPage,
    goToPage,
    resetPage,
  } = usePagination(filteredEmployees, { pageSize: 25 });

  // Reset pagination when search query changes
  useEffect(() => {
    resetPage();
  }, [searchQuery, resetPage]);

  // ══════════════════════════════════════════════════════════════
  // GUARD: Si aucun établissement, afficher UI stable
  // ══════════════════════════════════════════════════════════════
  if (!selectedEstablishmentId) {
    return (
      <MobileLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground/70 mb-4" />
          <p className="text-foreground font-medium">Aucun établissement assigné</p>
          <p className="text-sm text-muted-foreground mt-2">
            Veuillez sélectionner un établissement pour voir les salariés.
          </p>
        </div>
      </MobileLayout>
    );
  }

  // Handle employee selection from archived list
  const handleSelectEmployee = (userId: string) => {
    setSelectedEmployeeId(userId);
  };

  // Show profile view
  if (selectedEmployeeId && selectedEmployee) {
    return (
      <MobileLayout hideHeader hideBottomNav>
        <MobileEmployeeProfile
          employee={selectedEmployee}
          onBack={() => setSelectedEmployeeId(null)}
        />
      </MobileLayout>
    );
  }

  // Loading profile
  if (selectedEmployeeId && isLoadingProfile) {
    return (
      <MobileLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MobileLayout>
    );
  }

  // No access
  if (!canFetch) {
    return (
      <MobileLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
          <AlertCircle className="h-12 w-12 text-destructive/70 mb-4" />
          <p className="text-destructive font-medium">Accès refusé</p>
          <p className="text-sm text-muted-foreground mt-2">
            Vous n'avez pas les permissions pour voir les employés.
          </p>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4 space-y-4">
        {/* Back button */}
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Retour à l'accueil"
        >
          <ChevronLeft className="h-4 w-4" />
          Retour
        </button>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Salariés</h1>
          </div>
        </div>

        {/* Tabs */}
        <MobileEmployeesTabs value={activeTab} onChange={setActiveTab} />

        {/* Active employees tab */}
        {activeTab === "active" && (
          <>
            {/* Loading list */}
            {isLoading ? (
              <TableSkeleton rows={6} columns={2} />
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertCircle className="h-12 w-12 text-destructive/70 mb-4" />
                <p className="text-destructive font-medium">Erreur de chargement</p>
                <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
              </div>
            ) : (
              <>
                {/* Search */}
                <SearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Rechercher un employé..."
                />

                {/* Employee list (paginated) */}
                <div className="space-y-3">
                  {filteredEmployees.length === 0 ? (
                    <EmptyState
                      icon={<Users className="h-12 w-12" />}
                      title={searchQuery ? "Aucun résultat" : "Aucun employé trouvé"}
                      description={
                        searchQuery
                          ? "Essayez avec un autre terme de recherche."
                          : "Il n'y a pas encore de salarié dans cet établissement."
                      }
                    />
                  ) : (
                    paginatedEmployees.map((employee) => (
                      <MobileEmployeeCard
                        key={employee.user_id}
                        employee={employee}
                        onTap={() => setSelectedEmployeeId(employee.user_id)}
                      />
                    ))
                  )}
                </div>

                {/* Pagination controls (PERF-08) */}
                <PaginationControls
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={totalItems}
                  hasNextPage={hasNextPage}
                  hasPrevPage={hasPrevPage}
                  onNextPage={nextPage}
                  onPrevPage={prevPage}
                  onGoToPage={goToPage}
                />
              </>
            )}
          </>
        )}

        {/* Archived employees tab */}
        {activeTab === "archived" && (
          <MobileArchivedEmployeesList onSelectEmployee={handleSelectEmployee} />
        )}
      </div>
    </MobileLayout>
  );
}

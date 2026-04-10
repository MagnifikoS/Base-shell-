/**
 * Mobile archived employees list
 * Uses employee-archives edge function (admin-only)
 * Respects establishment filter from EstablishmentContext
 * Includes reactivation action (same mutation as desktop)
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { usePermissions } from "@/hooks/usePermissions";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Archive, Search, Loader2, AlertCircle, ShieldAlert, RotateCcw } from "lucide-react";
import { MobileReactivateDialog } from "./MobileReactivateDialog";

interface ArchivedEmployee {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  status: string;
  created_at: string;
  establishments: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
}

interface ArchivedEmployeesResponse {
  employees: ArchivedEmployee[];
}

async function fetchArchivedEmployees(establishmentId: string | null): Promise<ArchivedEmployee[]> {
  const { data, error } = await supabase.functions.invoke("employee-archives", {
    body: {
      action: "list_archived",
      establishment_id: establishmentId,
    },
  });

  if (error) {
    throw new Error(error.message || "Erreur lors du chargement des archives");
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  const response = data as ArchivedEmployeesResponse;
  return response.employees || [];
}

interface MobileArchivedEmployeesListProps {
  onSelectEmployee: (userId: string) => void;
}

export function MobileArchivedEmployeesList({
  onSelectEmployee,
}: MobileArchivedEmployeesListProps) {
  const { activeEstablishment } = useEstablishment();
  const selectedEstablishmentId = activeEstablishment?.id ?? null;
  const { isAdmin } = usePermissions();

  const [searchQuery, setSearchQuery] = useState("");

  // Reactivation dialog state
  const [reactivateTarget, setReactivateTarget] = useState<ArchivedEmployee | null>(null);

  // Admin-only: don't fetch if not admin
  const canFetch = isAdmin;

  const {
    data: employees = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["archived-employees-mobile", selectedEstablishmentId],
    queryFn: () => fetchArchivedEmployees(selectedEstablishmentId),
    enabled: canFetch,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  // Filter by search
  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees;

    const query = searchQuery.toLowerCase();
    return employees.filter(
      (emp) =>
        emp.full_name?.toLowerCase().includes(query) || emp.email.toLowerCase().includes(query)
    );
  }, [employees, searchQuery]);

  // Not admin: show access denied
  if (!canFetch) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <ShieldAlert className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground font-medium">Accès réservé aux administrateurs</p>
        <p className="text-sm text-muted-foreground mt-2">
          Seuls les administrateurs peuvent consulter les archives.
        </p>
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <AlertCircle className="h-12 w-12 text-destructive/70 mb-4" />
        <p className="text-destructive font-medium">Erreur de chargement</p>
        <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
      </div>
    );
  }

  // Empty state
  if (employees.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <Archive className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground font-medium">Aucun salarié archivé</p>
        <p className="text-sm text-muted-foreground mt-2">
          Les salariés dont le contrat est terminé apparaîtront ici.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Rechercher un archivé..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
          aria-label="Rechercher un employé archivé"
        />
      </div>

      {/* Count */}
      <div className="text-sm text-muted-foreground">
        {filteredEmployees.length} archivé{filteredEmployees.length !== 1 ? "s" : ""}
      </div>

      {/* List */}
      <div className="space-y-3">
        {filteredEmployees.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">Aucun résultat</div>
        ) : (
          filteredEmployees.map((employee) => (
            <div
              key={employee.user_id}
              className="flex items-center justify-between gap-3 p-4 bg-card border rounded-lg"
            >
              {/* Employee info - clickable */}
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => onSelectEmployee(employee.user_id)}
              >
                <p className="font-medium truncate">{employee.full_name || "—"}</p>
                <p className="text-sm text-muted-foreground truncate">{employee.email}</p>
                {employee.teams.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {employee.teams.map((t) => t.name).join(", ")}
                  </p>
                )}
              </div>

              {/* Reactivate button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReactivateTarget(employee)}
                className="shrink-0"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Réactiver
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Reactivate Dialog */}
      <MobileReactivateDialog
        isOpen={reactivateTarget !== null}
        onClose={() => setReactivateTarget(null)}
        userId={reactivateTarget?.user_id || ""}
        userFullName={reactivateTarget?.full_name || undefined}
        establishmentId={selectedEstablishmentId}
      />
    </div>
  );
}

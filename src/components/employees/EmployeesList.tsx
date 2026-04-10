import { memo, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Users } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { filterByScope } from "@/lib/rbac/scope";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";
import type { EmployeeListItem } from "./types/employee.types";

interface EmployeesListProps {
  onSelectEmployee: (userId: string) => void;
}

// Stable helper functions
const getStatusBadge = (status: string) => {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    active: "default",
    disabled: "secondary",
    invited: "outline",
    requested: "outline",
  };
  const labels: Record<string, string> = {
    active: "Actif",
    disabled: "Suspendu",
    invited: "Invité",
    requested: "En attente",
  };
  return <Badge variant={variants[status] || "secondary"}>{labels[status] || status}</Badge>;
};

// Memoized row component
const EmployeeRow = memo(function EmployeeRow({
  employee,
  onSelect,
  measureRef,
  dataIndex,
}: {
  employee: EmployeeListItem;
  onSelect: (userId: string) => void;
  measureRef?: (node: HTMLTableRowElement | null) => void;
  dataIndex?: number;
}) {
  return (
    <TableRow
      ref={measureRef}
      data-index={dataIndex}
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => onSelect(employee.user_id)}
    >
      <TableCell className="font-medium">{employee.full_name || "---"}</TableCell>
      <TableCell>{employee.email}</TableCell>
      <TableCell>
        {employee.teams.length > 0 ? employee.teams.map((t) => t.name).join(", ") : "---"}
      </TableCell>
      <TableCell>
        {employee.establishments.length > 0
          ? employee.establishments.map((e) => e.name).join(", ")
          : "---"}
      </TableCell>
      <TableCell>{getStatusBadge(employee.status)}</TableCell>
    </TableRow>
  );
});

export function EmployeesList({ onSelectEmployee }: EmployeesListProps) {
  const { user } = useAuth();
  const { activeEstablishmentId: selectedEstablishmentId } = useEstablishmentAccess();
  const { getScope, teamIds, establishmentIds, isAdmin } = usePermissions();

  const {
    data: employees = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["employees", selectedEstablishmentId],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Non authentifié");

      const response = await supabase.functions.invoke("employees", {
        body: {
          action: "list",
          establishment_id: selectedEstablishmentId || undefined,
          include_disabled: false,
        },
      });

      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data.employees as EmployeeListItem[];
    },
    staleTime: 60000,
    refetchOnWindowFocus: false,
    retry: false,
    placeholderData: (prev) => prev,
  });

  // Filter employees by scope
  const filteredEmployees = useMemo(() => {
    if (!user || !employees.length) return employees;

    // Admin sees everything
    if (isAdmin) return employees;

    const scope = getScope("salaries");

    return filterByScope<EmployeeListItem>({
      scope,
      userId: user.id,
      myTeamIds: teamIds,
      selectedEstablishmentId,
      myEstablishmentIds: establishmentIds,
      items: employees,
      getUserId: (emp) => emp.user_id,
      getTeamId: (emp) => emp.teams[0]?.id || null, // Use first team
      getEstablishmentId: (emp) => emp.establishments[0]?.id || null, // Use first establishment
    });
  }, [employees, user, isAdmin, getScope, teamIds, establishmentIds, selectedEstablishmentId]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: filteredEmployees.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-destructive">Erreur lors du chargement</p>
        <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
      </div>
    );
  }

  if (filteredEmployees.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">Aucun salarié trouvé</p>
        <p className="text-sm text-muted-foreground">
          {selectedEstablishmentId
            ? "Essayez de modifier le filtre établissement."
            : "Aucun utilisateur avec le rôle Salarié."}
        </p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <div ref={scrollContainerRef} className="max-h-[70vh] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Équipe(s)</TableHead>
              <TableHead>Établissement(s)</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: paddingTop, padding: 0, border: "none" }} />
              </tr>
            )}
            {virtualItems.map((virtualRow) => {
              const employee = filteredEmployees[virtualRow.index];
              return (
                <EmployeeRow
                  key={employee.user_id}
                  employee={employee}
                  onSelect={onSelectEmployee}
                  measureRef={virtualizer.measureElement}
                  dataIndex={virtualRow.index}
                />
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: paddingBottom, padding: 0, border: "none" }} />
              </tr>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

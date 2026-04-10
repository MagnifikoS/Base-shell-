import { memo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Archive, Trash2 } from "lucide-react";
import { useArchivedEmployees } from "./hooks/useArchivedEmployees";
import { useEmployeeArchiveMutations } from "./hooks/useEmployeeArchiveMutations";
import { useEmployeeMutations } from "./hooks/useEmployeeMutations";
import { HardDeleteDialog } from "./sections/HardDeleteDialog";
import { ReactivateDialog } from "./sections/ReactivateDialog";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";
import type { EmployeeListItem } from "./types/employee.types";

interface ArchivedEmployeesListProps {
  onSelectEmployee: (userId: string) => void;
}

// Memoized row component
const ArchivedEmployeeRow = memo(function ArchivedEmployeeRow({
  employee,
  onSelect,
  onReactivate,
  onDelete,
  isReactivating,
}: {
  employee: EmployeeListItem;
  onSelect: (userId: string) => void;
  onReactivate: (userId: string) => void;
  onDelete: (userId: string, name: string) => void;
  isReactivating: boolean;
}) {
  return (
    <TableRow className="hover:bg-muted/50 transition-colors">
      <TableCell className="font-medium cursor-pointer" onClick={() => onSelect(employee.user_id)}>
        {employee.full_name || "—"}
      </TableCell>
      <TableCell className="cursor-pointer" onClick={() => onSelect(employee.user_id)}>
        {employee.email}
      </TableCell>
      <TableCell>
        {employee.teams.length > 0 ? employee.teams.map((t) => t.name).join(", ") : "—"}
      </TableCell>
      <TableCell>
        {employee.establishments.length > 0
          ? employee.establishments.map((e) => e.name).join(", ")
          : "—"}
      </TableCell>
      <TableCell>
        <Badge variant="secondary">Archivé</Badge>
      </TableCell>
      <TableCell className="text-right space-x-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onReactivate(employee.user_id)}
          disabled={isReactivating}
        >
          Réintégrer
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onDelete(employee.user_id, employee.full_name || employee.email)}
          aria-label="Supprimer l'employé"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
});

export function ArchivedEmployeesList({ onSelectEmployee }: ArchivedEmployeesListProps) {
  const { activeEstablishmentId: selectedEstablishmentId } = useEstablishmentAccess();
  const [deleteTarget, setDeleteTarget] = useState<{ userId: string; name: string } | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<string | null>(null);

  const {
    data: employees = [],
    isLoading,
    error,
  } = useArchivedEmployees({
    establishmentId: selectedEstablishmentId,
  });

  const { hardDeleteMutation } = useEmployeeArchiveMutations({
    userId: deleteTarget?.userId || null,
    establishmentId: selectedEstablishmentId,
    onHardDeleteSuccess: () => setDeleteTarget(null),
  });

  const { reactivateMutation } = useEmployeeMutations({
    userId: reactivateTarget,
    establishmentId: selectedEstablishmentId,
    onReactivateSuccess: () => setReactivateTarget(null),
  });

  const handleReactivateClick = (userId: string) => {
    setReactivateTarget(userId);
  };

  const handleReactivateConfirm = (mode: "mistake" | "rehire", rehireDate?: string) => {
    reactivateMutation.mutate({ mode, rehire_start_date: rehireDate });
  };

  const handleDeleteClick = (userId: string, name: string) => {
    setDeleteTarget({ userId, name });
  };

  const handleConfirmDelete = () => {
    hardDeleteMutation.mutate();
  };

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

  if (employees.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Archive className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">Aucun salarié archivé</p>
        <p className="text-sm text-muted-foreground">
          Les salariés dont le contrat est terminé apparaîtront ici.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Équipe(s)</TableHead>
              <TableHead>Établissement(s)</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((employee) => (
              <ArchivedEmployeeRow
                key={employee.id}
                employee={employee}
                onSelect={onSelectEmployee}
                onReactivate={handleReactivateClick}
                onDelete={handleDeleteClick}
                isReactivating={
                  reactivateTarget === employee.user_id && reactivateMutation.isPending
                }
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <HardDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        isPending={hardDeleteMutation.isPending}
        employeeName={deleteTarget?.name || ""}
        onConfirm={handleConfirmDelete}
      />

      <ReactivateDialog
        open={reactivateTarget !== null}
        onOpenChange={(open) => !open && setReactivateTarget(null)}
        isPending={reactivateMutation.isPending}
        onConfirm={handleReactivateConfirm}
      />
    </>
  );
}

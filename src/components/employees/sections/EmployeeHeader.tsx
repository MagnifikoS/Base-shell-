import { Badge } from "@/components/ui/badge";
import type { Employee } from "../types/employee.types";

interface EmployeeHeaderProps {
  employee: Employee | null | undefined;
  isSuspended: boolean;
}

export function EmployeeHeader({ employee, isSuspended }: EmployeeHeaderProps) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">
          {employee?.full_name || "Chargement..."}
        </h2>
        {employee && (
          <Badge variant={isSuspended ? "secondary" : "default"}>
            {isSuspended ? "Suspendu" : "Actif"}
          </Badge>
        )}
      </div>
      {employee && (
        <p className="text-sm text-muted-foreground">{employee.email}</p>
      )}
    </div>
  );
}

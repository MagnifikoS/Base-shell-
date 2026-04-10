/**
 * AdminEmployeeSelector
 * 
 * Vue de sélection des salariés pour admin mobile.
 * Affiche la liste des employés de l'établissement sélectionné.
 * Inclut la navigation semaine + bouton Valider/Dépublier semaine.
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { MobileLayout } from "../../MobileLayout";
import { MobileWeekNav } from "../MobileWeekNav";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";
import { useValidateWeek } from "@/components/planning/hooks/useValidatePlanning";
import { getMonday } from "@/lib/planning-engine/format";
import { 
  ChevronLeft, 
  ChevronRight, 
  Building2, 
  Loader2, 
  AlertCircle,
  Users,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { PlanningValidation } from "@/components/planning/types/planning.types";

interface Employee {
  user_id: string;
  full_name: string | null;
  team_name: string | null;
}

interface AdminEmployeeSelectorProps {
  onSelectEmployee: (userId: string, fullName: string) => void;
  employees: Employee[];
  isLoading: boolean;
  error: Error | null;
  weekStart: string;
  onWeekChange: (weekStart: string) => void;
  validation: PlanningValidation | undefined;
  establishmentId: string | null;
}

export function AdminEmployeeSelector({ 
  onSelectEmployee,
  employees,
  isLoading,
  error,
  weekStart,
  onWeekChange,
  validation,
  establishmentId,
}: AdminEmployeeSelectorProps) {
  const navigate = useNavigate();
  const { activeEstablishment } = useEstablishment();
  const selectedEstablishmentId = establishmentId ?? activeEstablishment?.id ?? null;

  const { data: serviceDay } = useServiceDayToday(selectedEstablishmentId);
  const serviceDayMonday = serviceDay
    ? getMonday(new Date(serviceDay + "T12:00:00"))
    : getMonday(new Date());

  const validateWeekMutation = useValidateWeek();

  const isWeekPublished = validation?.weekValidated === true && !validation?.weekInvalidatedAt;

  const handleToggleValidation = () => {
    if (!selectedEstablishmentId) return;
    validateWeekMutation.mutate({
      establishmentId: selectedEstablishmentId,
      weekStart,
      validated: !isWeekPublished,
    });
  };

  // Group employees by team
  const employeesByTeam = useMemo(() => {
    if (!employees.length) return new Map<string, Employee[]>();
    
    const grouped = new Map<string, Employee[]>();
    
    for (const emp of employees) {
      const teamName = emp.team_name || "Sans équipe";
      if (!grouped.has(teamName)) {
        grouped.set(teamName, []);
      }
      grouped.get(teamName)!.push(emp);
    }
    
    return grouped;
  }, [employees]);

  // No establishment selected
  if (!selectedEstablishmentId) {
    return (
      <MobileLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">
            Sélectionnez un établissement pour afficher les salariés.
          </p>
        </div>
      </MobileLayout>
    );
  }

  // Loading
  if (isLoading && !employees.length) {
    return (
      <MobileLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MobileLayout>
    );
  }

  // Error
  if (error) {
    return (
      <MobileLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
          <AlertCircle className="h-12 w-12 text-destructive/70 mb-4" />
          <p className="text-destructive font-medium">Erreur de chargement</p>
          <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
        </div>
      </MobileLayout>
    );
  }

  const totalEmployees = employees.length;

  return (
    <MobileLayout>
      <div className="p-4 space-y-3">
        {/* Week navigation */}
        <MobileWeekNav
          weekStart={weekStart}
          onWeekChange={onWeekChange}
          currentWeekMonday={serviceDayMonday}
        />

        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Retour
          </button>
        </div>

        {/* Title + Validate button */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Planning</h1>
              <p className="text-xs text-muted-foreground">
                {totalEmployees} salarié{totalEmployees > 1 ? "s" : ""}
              </p>
            </div>
          </div>

          {/* Validate/Unpublish week button */}
          {validation && (
            <Button
              size="sm"
              variant={isWeekPublished ? "outline" : "default"}
              onClick={handleToggleValidation}
              disabled={validateWeekMutation.isPending}
              className={cn(
                "gap-1.5 text-xs",
                isWeekPublished && "border-primary/50 text-primary hover:bg-primary/5"
              )}
            >
              {validateWeekMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isWeekPublished ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              {isWeekPublished ? "Publiée" : "Valider"}
            </Button>
          )}
        </div>

        {/* Instruction */}
        <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
          Sélectionnez un salarié pour consulter ou modifier son planning.
        </p>

        {/* Employee list by team */}
        <div className="space-y-4">
          {Array.from(employeesByTeam.entries()).map(([teamName, teamEmployees]) => (
            <div key={teamName} className="space-y-2">
              {/* Team header */}
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
                {teamName}
              </h2>
              
              {/* Employees in team */}
              <div className="space-y-2">
                {teamEmployees.map((emp) => (
                  <button
                    key={emp.user_id}
                    onClick={() => onSelectEmployee(emp.user_id, emp.full_name || "Sans nom")}
                    className={cn(
                      "flex items-center justify-between w-full p-4 rounded-xl",
                      "bg-card border border-border",
                      "active:scale-[0.98] touch-manipulation cursor-pointer",
                      "hover:border-primary/30 transition-all"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {/* Avatar placeholder */}
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-semibold text-primary">
                          {(emp.full_name || "?").charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="font-medium text-foreground">
                        {emp.full_name || "Sans nom"}
                      </span>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Empty state */}
        {totalEmployees === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">
              Aucun salarié dans cet établissement.
            </p>
          </div>
        )}
      </div>
    </MobileLayout>
  );
}

/**
 * Mobile employee card component
 */

import { Building2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface MobileEmployeeData {
  user_id: string;
  full_name: string | null;
  email: string;
  status: string;
  position?: string | null;
  establishments: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
}

interface MobileEmployeeCardProps {
  employee: MobileEmployeeData;
  onTap: () => void;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "active":
      return (
        <Badge variant="default" className="bg-green-500 dark:bg-green-600">
          Actif
        </Badge>
      );
    case "disabled":
      return <Badge variant="secondary">Désactivé</Badge>;
    case "invited":
      return <Badge variant="outline">Invité</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function MobileEmployeeCard({ employee, onTap }: MobileEmployeeCardProps) {
  const initials =
    employee.full_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  return (
    <button
      onClick={onTap}
      className="w-full p-4 bg-card rounded-xl border border-border hover:border-primary/30 transition-all text-left"
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
          {initials}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-medium text-foreground truncate">
                {employee.full_name || "Sans nom"}
              </h3>
              {employee.position && (
                <p className="text-sm text-muted-foreground truncate">{employee.position}</p>
              )}
            </div>
            {getStatusBadge(employee.status)}
          </div>

          {/* Establishments & Teams */}
          <div className="mt-2 flex flex-wrap gap-2">
            {employee.establishments.slice(0, 2).map((est) => (
              <span
                key={est.id}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded"
              >
                <Building2 className="h-3 w-3" />
                {est.name}
              </span>
            ))}
            {employee.establishments.length > 2 && (
              <span className="text-xs text-muted-foreground">
                +{employee.establishments.length - 2}
              </span>
            )}
            {employee.teams.slice(0, 1).map((team) => (
              <span
                key={team.id}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded"
              >
                <Users className="h-3 w-3" />
                {team.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </button>
  );
}

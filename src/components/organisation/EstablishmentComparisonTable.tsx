/**
 * EstablishmentComparisonTable — Displays a comparison table of all establishments
 * with their KPIs (presence, planned shifts, pending leaves).
 *
 * Extracted from OrganisationDashboard to keep page under 300 lines.
 */

import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { useEstablishment } from "@/contexts/EstablishmentContext";
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
import { Eye } from "lucide-react";
import type { EstablishmentSummary } from "@/hooks/dashboard/useOrganisationKPIs";

interface EstablishmentComparisonTableProps {
  establishments: EstablishmentSummary[];
}

function getPresenceVariant(rate: number): "default" | "secondary" | "destructive" {
  if (rate >= 90) return "default";
  if (rate >= 70) return "secondary";
  return "destructive";
}

function getPresenceColor(rate: number): string {
  if (rate >= 90) return "text-green-600 dark:text-green-400";
  if (rate >= 70) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

export const EstablishmentComparisonTable = memo(function EstablishmentComparisonTable({
  establishments,
}: EstablishmentComparisonTableProps) {
  const navigate = useNavigate();
  const { setActiveEstablishment, establishments: allEstablishments } = useEstablishment();

  const handleSelectEstablishment = (estId: string) => {
    const est = allEstablishments.find((e) => e.id === estId);
    if (est) {
      setActiveEstablishment(est);
      navigate("/dashboard");
    }
  };

  if (establishments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">Aucun etablissement actif.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Etablissement</TableHead>
          <TableHead className="text-center">Presents</TableHead>
          <TableHead className="text-center">Prevus</TableHead>
          <TableHead className="text-center">Taux</TableHead>
          <TableHead className="text-center">Demandes</TableHead>
          <TableHead className="text-center">Badges</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {establishments.map((est) => (
          <TableRow
            key={est.id}
            className="cursor-pointer hover:bg-muted/50"
            onClick={() => handleSelectEstablishment(est.id)}
          >
            <TableCell className="font-medium text-sm">{est.name}</TableCell>
            <TableCell className="text-center text-sm">{est.employeesPresent}</TableCell>
            <TableCell className="text-center text-sm">{est.employeesPlanned}</TableCell>
            <TableCell className="text-center">
              <Badge variant={getPresenceVariant(est.presenceRate)}>
                <span className={getPresenceColor(est.presenceRate)}>{est.presenceRate}%</span>
              </Badge>
            </TableCell>
            <TableCell className="text-center text-sm">
              {est.pendingLeaves > 0 ? (
                <Badge variant="secondary">{est.pendingLeaves}</Badge>
              ) : (
                <span className="text-muted-foreground">0</span>
              )}
            </TableCell>
            <TableCell className="text-center text-sm font-mono">{est.todayBadgeEvents}</TableCell>
            <TableCell className="text-right">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelectEstablishment(est.id);
                }}
                aria-label={`Voir ${est.name}`}
              >
                <Eye className="h-4 w-4 mr-1" />
                Voir
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
});

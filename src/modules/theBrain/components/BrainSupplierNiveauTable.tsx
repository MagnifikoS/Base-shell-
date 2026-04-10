/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Supplier Niveau Table (Lecture seule)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Affiche les règles supplier_matching agrégées depuis brain_events.
 * Vue strictement observationnelle — aucune action utilisateur.
 * Rendu sans Card wrapper (géré par le parent collapsible).
 */

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import type { SupplierMatchingRuleDisplay, SupplierMatchingStatus } from "../types";

interface BrainSupplierNiveauTableProps {
  rules: SupplierMatchingRuleDisplay[];
  isLoading: boolean;
}

function StatusBadge({ status }: { status: SupplierMatchingStatus }) {
  switch (status) {
    case "stable":
      return (
        <Badge variant="default" className="bg-primary/10 text-primary border-primary/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Stable
        </Badge>
      );
    case "monitoring":
      return (
        <Badge variant="outline" className="text-warning border-warning/30">
          <AlertTriangle className="h-3 w-3 mr-1" />
          À surveiller
        </Badge>
      );
  }
}

function formatLastUsed(date: string | null): string {
  if (!date) return "—";
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true, locale: fr });
  } catch {
    return "—";
  }
}

export function BrainSupplierNiveauTable({ rules, isLoading }: BrainSupplierNiveauTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-3 p-4 bg-card border rounded-lg">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="p-4 bg-card border rounded-lg">
        <p className="text-sm text-muted-foreground text-center py-4">
          Aucune règle supplier_matching enregistrée pour le moment.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-card border rounded-lg">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 font-medium text-muted-foreground">Fournisseur</th>
              <th className="text-center py-2 font-medium text-muted-foreground">Confirmations</th>
              <th className="text-center py-2 font-medium text-muted-foreground">Corrections</th>
              <th className="text-left py-2 font-medium text-muted-foreground">Dernière utilisation</th>
              <th className="text-left py-2 font-medium text-muted-foreground">Statut</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.supplierId} className="border-b last:border-0 hover:bg-muted/50">
                <td className="py-3 font-medium">{rule.supplierName}</td>
                <td className="py-3 text-center">
                  <span className="text-primary font-medium">{rule.confirmationsCount}</span>
                </td>
                <td className="py-3 text-center">
                  <span className={rule.correctionsCount > 0 ? "text-warning font-medium" : "text-muted-foreground"}>
                    {rule.correctionsCount}
                  </span>
                </td>
                <td className="py-3 text-muted-foreground">
                  {formatLastUsed(rule.lastUsedAt)}
                </td>
                <td className="py-3">
                  <StatusBadge status={rule.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

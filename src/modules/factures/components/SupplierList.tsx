/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE FACTURES — Supplier List Component V2.0 (supplier_id SSOT)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Liste des fournisseurs avec leur total du mois.
 * Clic sur un fournisseur → ouvre le détail.
 * Regroupement par supplier_id (UUID - SSOT)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { memo } from "react";
import { FileText, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { SupplierMonthSummary } from "../types";

/* Memoized row for supplier summary list */
const SupplierSummaryRow = memo(function SupplierSummaryRow({
  summary,
  onSelectSupplier,
}: {
  summary: SupplierMonthSummary;
  onSelectSupplier: (supplierId: string) => void;
}) {
  return (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => onSelectSupplier(summary.supplier_id)}
    >
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <h3 className="font-medium">{summary.supplier_name}</h3>
          <p className="text-sm text-muted-foreground">
            {summary.invoice_count} facture{summary.invoice_count > 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-semibold text-lg">
            {summary.total_amount.toLocaleString("fr-FR", {
              style: "currency",
              currency: "EUR",
            })}
          </span>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
});

interface SupplierListProps {
  summaries: SupplierMonthSummary[];
  onSelectSupplier: (supplierId: string) => void;
  isLoading?: boolean;
}

export function SupplierList({ summaries, onSelectSupplier, isLoading }: SupplierListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4">
              <div className="h-5 bg-muted rounded w-1/3 mb-2" />
              <div className="h-4 bg-muted rounded w-1/4" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Aucune facture pour ce mois</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {summaries.map((summary) => (
        <SupplierSummaryRow
          key={summary.supplier_id}
          summary={summary}
          onSelectSupplier={onSelectSupplier}
        />
      ))}
    </div>
  );
}

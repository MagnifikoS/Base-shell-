/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE FACTURES — Supplier Detail Component V2.2
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Vue détaillée d'un fournisseur avec ses factures du mois + ses relevés.
 * Les relevés (invoice_monthly_statements) sont affichés EN PREMIER dans une
 * section dédiée "RELEVÉ DU MOIS". Au clic, ouvre le panneau de détail du relevé.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState } from "react";
import { ArrowLeft, FileText, CheckCircle2, AlertTriangle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Invoice, MonthNavigation } from "../types";
import { formatYearMonth, toYearMonthString } from "../types";
import { InvoiceList } from "./InvoiceList";
import { useSupplierStatements } from "../hooks/useInvoices";
import type { MonthlyStatement } from "../hooks/useInvoices";
import { StatementDetailPanel } from "./StatementDetailPanel";

interface SupplierDetailProps {
  supplierId: string; // UUID du fournisseur (SSOT)
  supplierName: string;
  month: MonthNavigation;
  invoices: Invoice[];
  onBack: () => void;
  onInvoiceDeleted?: () => void;
}

// ── Helpers ──

function formatAmount(amount: number): string {
  return amount.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  });
}

function formatDate(isoDate: string): string {
  // "2026-01-15" → "15/01/2026"
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// ── Statement Row (cliquable) ──

function StatementRow({
  statement,
  onClick,
}: {
  statement: MonthlyStatement;
  onClick: () => void;
}) {
  const isReconciled = statement.status === "reconciled";
  const hasGap = statement.gap_eur !== null && Math.abs(statement.gap_eur) > 0.01;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between p-4 rounded-lg border border-border bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer text-left"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <FileText className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground truncate">
              RELEVÉ DU MOIS
            </span>
            <Badge
              variant={isReconciled ? "default" : "secondary"}
              className="text-xs shrink-0"
            >
              {isReconciled ? "Équilibré" : "Écart détecté"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Enregistré le {formatDate(statement.created_at.slice(0, 10))}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0 ml-3">
        {/* Gap indicator */}
        {hasGap && statement.gap_eur !== null ? (
          <div className={`flex items-center gap-1 text-xs text-warning`}>
            <AlertTriangle className="h-3 w-3" />
            <span>Écart {formatAmount(Math.abs(statement.gap_eur))}</span>
          </div>
        ) : (
          <div className={`flex items-center gap-1 text-xs text-success`}>
            <CheckCircle2 className="h-3 w-3" />
            <span>Équilibré</span>
          </div>
        )}

        {/* Total */}
        <span className="font-semibold text-sm text-foreground">
          {formatAmount(statement.statement_amount_eur)}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </button>
  );
}

// ── Main Component ──

export function SupplierDetail({
  supplierId,
  supplierName,
  month,
  invoices,
  onBack,
  onInvoiceDeleted,
}: SupplierDetailProps) {
  const monthLabel = formatYearMonth(month.year, month.month);

  // Statement detail navigation state
  const [selectedStatement, setSelectedStatement] = useState<MonthlyStatement | null>(null);

  // Filtrer les factures par supplier_id (SSOT)
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => inv.supplier_id === supplierId);
  }, [invoices, supplierId]);

  // Charger les relevés du mois pour ce fournisseur
  const { data: statements = [] } = useSupplierStatements(supplierId, month);

  // Calcul du total factures
  const total = filteredInvoices.reduce((sum, inv) => sum + inv.amount_eur, 0);

  // ── Afficher le panneau de détail d'un relevé ──
  if (selectedStatement) {
    return (
      <StatementDetailPanel
        statement={selectedStatement}
        invoices={filteredInvoices}
        onBack={() => setSelectedStatement(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header avec retour */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Retour">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h2 className="text-xl font-semibold">{supplierName}</h2>
          <p className="text-sm text-muted-foreground capitalize">{monthLabel}</p>
        </div>
      </div>

      {/* ── Relevés de compte EN PREMIER (invoice_monthly_statements) ── */}
      {statements.length > 0 && (
        <>
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Relevés de compte
            </h3>
            <div className="space-y-2">
              {statements.map((stmt) => (
                <StatementRow
                  key={stmt.id}
                  statement={stmt}
                  onClick={() => setSelectedStatement(stmt)}
                />
              ))}
            </div>
          </div>
          <Separator />
        </>
      )}

      {/* Résumé factures */}
      <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
        <span className="text-muted-foreground">
          {filteredInvoices.length} facture{filteredInvoices.length > 1 ? "s" : ""}
        </span>
        <span className="text-xl font-bold">
          {total.toLocaleString("fr-FR", {
            style: "currency",
            currency: "EUR",
          })}
        </span>
      </div>


      {/* Liste des factures */}
      <InvoiceList
        invoices={filteredInvoices}
        isLoading={false}
        onInvoiceDeleted={onInvoiceDeleted}
      />
    </div>
  );
}


/**
 * SupplierPaymentsSection — Section "Paiements" dans la fiche fournisseur.
 * Affiche uniquement :
 *  - Dettes du fournisseur + reste + échéance attendue
 *  - Bouton [Payer] par facture
 *  - Bouton [Paiement fournisseur global]
 *  - Historique chronologique
 * ISOLÉ — zéro import hors payLedger.
 *
 * NOTE : La saisie des dates d'échéancier (mode installments) est dans
 * SupplierPaymentRulesPanel, sous la sélection du mode "Échéancier".
 */

import { useState } from "react";
import {
  CreditCard, Plus, Zap, AlertTriangle, Clock, CalendarCheck, Minus,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AddPaymentDialog } from "./AddPaymentDialog";
import { GlobalSupplierPaymentDialog } from "./GlobalSupplierPaymentDialog";
import { PaymentTimelineDrawer } from "./PaymentTimelineDrawer";
import {
  usePayToPayCockpit,
} from "../hooks/usePayLedger";
import {
  computeInvoicePaid,
  computeInvoiceRemaining,
  computeExpectedDueDate,
  computeUrgency,
  urgencyLabel,
  urgencyColor,
  URGENCY_SORT,
  formatEurPay,
  formatDateKey,
  statusLabel,
  statusColor,
  computeInvoiceStatus,
} from "../engine/payEngine";
import type { PayInvoice } from "../types";

interface SupplierPaymentsSectionProps {
  organizationId:  string;
  establishmentId: string;
  supplierId:      string;
  supplierName:    string;
  yearMonth:       string;
}

function UrgencyIcon({ level }: { level: ReturnType<typeof computeUrgency> }) {
  if (level === "overdue")  return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (level === "soon")     return <Clock         className="h-3.5 w-3.5 text-warning" />;
  if (level === "upcoming") return <CalendarCheck className="h-3.5 w-3.5 text-primary" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main section
// ─────────────────────────────────────────────────────────────────────────────

export function SupplierPaymentsSection({
  organizationId,
  establishmentId,
  supplierId,
  supplierName,
  yearMonth,
}: SupplierPaymentsSectionProps) {
  const { invoices, allocations, rules, isLoading } = usePayToPayCockpit(establishmentId, yearMonth);

  const [addPayInvoice,   setAddPayInvoice]   = useState<PayInvoice | null>(null);
  const [timelineInvoice, setTimelineInvoice] = useState<PayInvoice | null>(null);
  const [globalOpen,      setGlobalOpen]      = useState(false);

  const rulesMap = new Map(rules.map((r) => [r.supplier_id, r]));

  type Enriched = {
    invoice:   PayInvoice;
    paid:      number;
    remaining: number;
    dueDate:   Date | null;
    urgency:   ReturnType<typeof computeUrgency>;
  };

  const supplierInvoices: Enriched[] = invoices
    .filter((inv) => inv.supplier_id === supplierId)
    .map((invoice) => {
      const rule      = rulesMap.get(invoice.supplier_id) ?? null;
      const paid      = computeInvoicePaid(invoice.id, allocations);
      const remaining = computeInvoiceRemaining(invoice, paid);
      const dueDate   = computeExpectedDueDate(invoice.invoice_date, rule);
      const urgency   = computeUrgency(dueDate);
      return { invoice, paid, remaining, dueDate, urgency };
    })
    .filter((e) => e.remaining > 0.005)
    .sort((a, b) => {
      const byUrgency = URGENCY_SORT[a.urgency] - URGENCY_SORT[b.urgency];
      if (byUrgency !== 0) return byUrgency;
      const da = a.dueDate?.getTime() ?? Infinity;
      const db = b.dueDate?.getTime() ?? Infinity;
      return da - db;
    });

  const totalRemaining = supplierInvoices.reduce((s, e) => s + e.remaining, 0);

  if (isLoading) {
    return (
      <div className="animate-pulse text-muted-foreground text-xs py-2">
        Chargement…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Paiements</span>
          {totalRemaining > 0 && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              Reste : {formatEurPay(totalRemaining)}
            </Badge>
          )}
        </div>
        {totalRemaining > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-8"
            onClick={() => setGlobalOpen(true)}
          >
            <Zap className="h-3.5 w-3.5" />
            Paiement fournisseur
          </Button>
        )}
      </div>

      {/* Empty state */}
      {supplierInvoices.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">
          Aucune dette ouverte pour ce fournisseur.
        </p>
      )}

      {/* Invoice list */}
      {supplierInvoices.map(({ invoice, paid, remaining, dueDate, urgency }) => {
        const rule          = rulesMap.get(invoice.supplier_id) ?? null;
        const status        = computeInvoiceStatus(invoice, paid);
        const isInstallments = rule?.mode === "installments";

        return (
          <div
            key={invoice.id}
            className="p-3 rounded-lg border bg-muted/20 text-sm space-y-2"
          >
            {/* Row principale */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{invoice.label || invoice.invoice_date}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-muted-foreground">{invoice.invoice_date}</p>
                  {dueDate && !isInstallments && (
                    <div className="flex items-center gap-1 text-xs">
                      <UrgencyIcon level={urgency} />
                      <span className="text-muted-foreground">{formatDateKey(dueDate)}</span>
                      <Badge className={`text-[10px] px-1.5 py-0 ${urgencyColor(urgency)}`}>
                        {urgencyLabel(urgency)}
                      </Badge>
                    </div>
                  )}
                  {isInstallments && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      Échéancier multi-dates
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground tabular-nums">
                  <span>Total : {formatEurPay(invoice.amount_eur)}</span>
                  <span>Payé : {formatEurPay(paid)}</span>
                  <span className="text-primary font-semibold">Reste : {formatEurPay(remaining)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge className={`text-xs ${statusColor(status)}`}>
                  {statusLabel(status)}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => setAddPayInvoice(invoice)}
                >
                  <Plus className="h-3 w-3" />
                  Payer
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setTimelineInvoice(invoice)}
                  title="Voir l'historique"
                >
                  Hist.
                </Button>
              </div>
            </div>
          </div>
        );
      })}

      {/* AddPaymentDialog — par facture */}
      {addPayInvoice && (
        <AddPaymentDialog
          open={!!addPayInvoice}
          onClose={() => setAddPayInvoice(null)}
          organizationId={organizationId}
          establishmentId={establishmentId}
          supplierId={supplierId}
          payInvoiceId={addPayInvoice.id}
          yearMonth={yearMonth}
          remaining={computeInvoiceRemaining(addPayInvoice, computeInvoicePaid(addPayInvoice.id, allocations))}
          supplierName={supplierName}
          invoiceLabel={addPayInvoice.label}
          allowPartial={rulesMap.get(supplierId)?.allow_partial ?? true}
        />
      )}

      {/* GlobalSupplierPaymentDialog */}
      {globalOpen && (
        <GlobalSupplierPaymentDialog
          open={globalOpen}
          onClose={() => setGlobalOpen(false)}
          organizationId={organizationId}
          establishmentId={establishmentId}
          supplierId={supplierId}
          supplierName={supplierName}
          yearMonth={yearMonth}
          monthRemaining={totalRemaining}
          defaultAmount={totalRemaining}
        />
      )}

      {/* Timeline Drawer */}
      {timelineInvoice && (
        <PaymentTimelineDrawer
          open={!!timelineInvoice}
          onClose={() => setTimelineInvoice(null)}
          invoice={timelineInvoice}
          allocations={allocations.filter((a) => a.pay_invoice_id === timelineInvoice.id)}
          establishmentId={establishmentId}
          yearMonth={yearMonth}
          supplierName={supplierName}
        />
      )}
    </div>
  );
}

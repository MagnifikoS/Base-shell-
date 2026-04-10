/**
 * AppInvoicesClientList — Client view: app-generated invoices received
 * Displayed inside the existing Factures page alongside imported invoices
 */

import { useState, useMemo } from "react";
import { FileCheck, Eye, Loader2 } from "lucide-react";
import { useAppInvoices } from "../hooks/useFactureApp";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { AppInvoiceDetailSheet } from "./AppInvoiceDetailSheet";
import type { AppInvoice } from "../types";

function fmtEur(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function fmtDate(d: string): string {
  const parts = d.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return d;
}

interface Props {
  /** YYYY-MM filter */
  yearMonth: string;
}

export function AppInvoicesClientList({ yearMonth }: Props) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const { data: allInvoices = [], isLoading } = useAppInvoices();
  const isMobile = useIsMobile();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Filter: only invoices where we are the client (reçues) + current month
  const recues = useMemo(
    () =>
      allInvoices.filter(
        (inv) =>
          inv.client_establishment_id === estId &&
          inv.invoice_date.startsWith(yearMonth)
      ),
    [allInvoices, estId, yearMonth]
  );

  const total = recues
    .filter((inv) => inv.status !== "annulee")
    .reduce((sum, inv) => sum + Number(inv.total_ht), 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (recues.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <FileCheck className="h-4 w-4 text-primary" />
        <h3 className={`font-semibold ${isMobile ? "text-sm" : "text-base"}`}>
          Factures App
        </h3>
        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
          {recues.length}
        </span>
        <span className="ml-auto text-sm font-bold tabular-nums">
          {fmtEur(total)}
        </span>
      </div>

      <div className="divide-y divide-border/60 border rounded-lg overflow-hidden">
        {recues.map((inv: AppInvoice) => (
          <button
            key={inv.id}
            onClick={() => setSelectedInvoiceId(inv.id)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors active:bg-accent/70"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">{inv.supplier_name_snapshot}</p>
                {inv.status === "annulee" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">
                    Annulée
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {inv.invoice_number} · {inv.order_number_snapshot} · {fmtDate(inv.invoice_date)}
              </p>
            </div>
            <span className="text-sm font-bold tabular-nums shrink-0">
              {fmtEur(inv.total_ht)}
            </span>
            <Eye className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>

      <AppInvoiceDetailSheet
        invoiceId={selectedInvoiceId}
        open={!!selectedInvoiceId}
        onClose={() => setSelectedInvoiceId(null)}
      />
    </div>
  );
}

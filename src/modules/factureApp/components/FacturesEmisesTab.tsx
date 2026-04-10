/**
 * FacturesEmisesTab — Supplier view: list of app-generated invoices
 * Displayed as a sub-tab inside the Commandes page (supplier side)
 */

import { useState, useMemo } from "react";
import { FileText, Eye, Loader2 } from "lucide-react";
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

function getMonthLabel(dateStr: string): string {
  const [y, m] = dateStr.split("-");
  const months = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

export function FacturesEmisesTab() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const { data: allInvoices = [], isLoading } = useAppInvoices();
  const isMobile = useIsMobile();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Filter: only invoices where we are the supplier (émises)
  const emises = useMemo(
    () => allInvoices.filter((inv) => inv.supplier_establishment_id === estId),
    [allInvoices, estId]
  );

  // Group by month
  const grouped = useMemo(() => {
    const map = new Map<string, AppInvoice[]>();
    for (const inv of emises) {
      const key = inv.invoice_date.slice(0, 7); // YYYY-MM
      const arr = map.get(key) ?? [];
      arr.push(inv);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [emises]);

  // Current month total
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthTotal = emises
    .filter((inv) => inv.invoice_date.startsWith(currentMonthKey) && inv.status !== "annulee")
    .reduce((sum, inv) => sum + Number(inv.total_ht), 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      {/* Header stats */}
      <div className={`grid grid-cols-2 gap-3 ${isMobile ? "mb-3" : "mb-6"}`}>
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">Factures émises</p>
          <p className={isMobile ? "text-xl font-bold" : "text-2xl font-bold"}>{emises.length}</p>
        </div>
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">Total du mois</p>
          <p className={isMobile ? "text-xl font-bold" : "text-2xl font-bold"}>
            {fmtEur(currentMonthTotal)}
          </p>
        </div>
      </div>

      {emises.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mb-3">
            <FileText className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">Aucune facture émise</p>
          <p className="text-xs text-muted-foreground mt-1">
            Générez des factures depuis vos commandes réceptionnées
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([monthKey, invoices]) => (
            <div key={monthKey}>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 px-1">
                {getMonthLabel(monthKey + "-01")}
              </h3>
              <div className="divide-y divide-border/60 border rounded-lg overflow-hidden">
                {invoices.map((inv) => (
                  <button
                    key={inv.id}
                    onClick={() => setSelectedInvoiceId(inv.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors active:bg-accent/70"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{inv.client_name_snapshot}</p>
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
            </div>
          ))}
        </div>
      )}

      <AppInvoiceDetailSheet
        invoiceId={selectedInvoiceId}
        open={!!selectedInvoiceId}
        onClose={() => setSelectedInvoiceId(null)}
      />
    </div>
  );
}

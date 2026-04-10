/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE FACTURES — Main Page V2.0 (supplier_id SSOT)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo } from "react";
import { FileText, CreditCard, ClipboardList, ArrowLeftRight, FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import type { MonthNavigation } from "../types";
import { getCurrentMonth, toYearMonthString } from "../types";
import { useMonthInvoices } from "../hooks/useInvoices";
import { useInvoiceCalculations } from "../hooks/useInvoiceCalculations";
import { MonthSelector } from "../components/MonthSelector";
import { SupplierList } from "../components/SupplierList";
import { SupplierDetail } from "../components/SupplierDetail";
import { BlAppTab } from "@/modules/blApp";
import { BlRetraitTab } from "@/modules/blRetrait";
import { PAY_LEDGER_BETA_ENABLED } from "@/config/featureFlags";
import { PayToPayCockpit, useBackfillPayInvoices } from "@/modules/payLedger";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { AppInvoicesClientList, FacturesEmisesTab, useAppInvoices } from "@/modules/factureApp";

export function FacturesPage() {
  const [currentMonth,       setCurrentMonth]       = useState<MonthNavigation>(getCurrentMonth);
  const [payToPayMonth,      setPayToPayMonth]      = useState<MonthNavigation>(getCurrentMonth);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("factures");
  
  const isMobile = useIsMobile();

  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const { data: invoices = [], isLoading, isError, refetch } = useMonthInvoices(currentMonth);
  const { supplierSummaries, monthTotal, invoiceCount } = useInvoiceCalculations(invoices);

  const yearMonth = toYearMonthString(currentMonth);
  const backfillMutation = useBackfillPayInvoices(activeEstablishment?.id ?? "", yearMonth);

  // App invoices received (client side) — add to grand total
  const { data: allAppInvoices = [] } = useAppInvoices();
  const appRecues = useMemo(
    () => allAppInvoices.filter(
      (inv) => inv.client_establishment_id === estId && inv.invoice_date.startsWith(yearMonth) && inv.status !== "annulee"
    ),
    [allAppInvoices, estId, yearMonth]
  );
  const appTotal = appRecues.reduce((sum, inv) => sum + Number(inv.total_ht), 0);
  const grandTotal = monthTotal + appTotal;
  const grandCount = invoiceCount + appRecues.length;

  const supplierNames: Record<string, string> = Object.fromEntries(
    supplierSummaries.map((s) => [s.supplier_id, s.supplier_name])
  );

  const handleMonthChange = (nav: MonthNavigation) => {
    setCurrentMonth(nav);
    setSelectedSupplierId(null);
  };

  if (selectedSupplierId) {
    const summary = supplierSummaries.find((s) => s.supplier_id === selectedSupplierId);
    const supplierName = summary?.supplier_name || "Fournisseur inconnu";
    return (
      <ResponsiveLayout>
        <div className={isMobile ? "py-3 px-3" : "container mx-auto py-6 px-4 max-w-4xl"}>
          <SupplierDetail
            supplierId={selectedSupplierId}
            supplierName={supplierName}
            month={currentMonth}
            invoices={invoices}
            onBack={() => setSelectedSupplierId(null)}
            onInvoiceDeleted={() => refetch()}
          />
        </div>
      </ResponsiveLayout>
    );
  }

  return (
    <ResponsiveLayout>
      <div className={isMobile ? "py-3 px-3" : "container mx-auto py-6 px-4 max-w-4xl"}>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          {/* ── Unified tab bar — same style as Commandes ── */}
          {(() => {
            const allTabs = [
              { id: "factures", label: "Factures", icon: FileText },
              { id: "factures-emises", label: "Émises", icon: FileCheck },
              ...(PAY_LEDGER_BETA_ENABLED ? [{ id: "payToPay", label: "Paiement", icon: CreditCard }] : []),
              { id: "bl-app", label: "BL Réception", icon: ClipboardList },
              { id: "bl-retraits", label: "Retraits", icon: ArrowLeftRight },
            ];
            return (
              <div className="flex gap-1 p-1 rounded-xl bg-muted/60 border mb-4 sm:mb-6">
                {allTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        "relative flex flex-col items-center gap-0.5 sm:gap-1 px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg text-[11px] sm:text-xs font-medium transition-all flex-1",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                      )}
                    >
                      <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* ── Onglet Factures ── */}
          <TabsContent value="factures">
            <div className={`flex items-center justify-between ${isMobile ? 'mb-3' : 'mb-6'}`}>
              <div className="flex items-center gap-2">
                {!isMobile && <FileText className="h-8 w-8 text-primary" />}
                <h1 className={isMobile ? "text-lg font-bold" : "text-2xl font-bold"}>Factures</h1>
              </div>
              <MonthSelector value={currentMonth} onChange={handleMonthChange} />
            </div>

            {isError && (
              <div className="flex flex-col items-center justify-center p-6 text-center mb-4">
                <p className="text-destructive font-medium text-sm">Une erreur est survenue</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                  Reessayer
                </Button>
              </div>
            )}
            {!isError && (
              <div className={`grid grid-cols-2 gap-3 ${isMobile ? 'mb-3' : 'mb-6'}`}>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground">Factures</p>
                  <p className={isMobile ? "text-xl font-bold" : "text-2xl font-bold"}>{grandCount}</p>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground">Total du mois</p>
                  <p className={isMobile ? "text-xl font-bold" : "text-2xl font-bold"}>
                    {grandTotal.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
                  </p>
                </div>
              </div>
            )}
            {!isError && (
              <>
                <SupplierList
                  summaries={supplierSummaries}
                  onSelectSupplier={setSelectedSupplierId}
                  isLoading={isLoading}
                />
                {/* Facture App: invoices received from B2B partners */}
                <AppInvoicesClientList yearMonth={toYearMonthString(currentMonth)} />
              </>
            )}
          </TabsContent>

          {/* ── Onglet Factures émises (fournisseur) ── */}
          <TabsContent value="factures-emises">
            <div className={`flex items-center gap-2 ${isMobile ? 'mb-3' : 'mb-6'}`}>
              {!isMobile && <FileCheck className="h-8 w-8 text-primary" />}
              <h1 className={isMobile ? "text-lg font-bold" : "text-2xl font-bold"}>Factures émises</h1>
            </div>
            <FacturesEmisesTab />
          </TabsContent>

          {/* ── Onglet À payer ── */}
          {PAY_LEDGER_BETA_ENABLED && (
            <TabsContent value="payToPay">
              <div className={`flex items-center justify-between ${isMobile ? 'mb-3' : 'mb-6'}`}>
                <div className="flex items-center gap-2">
                  <h1 className={isMobile ? "text-lg font-bold" : "text-2xl font-bold"}>À payer</h1>
                  <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">Beta</span>
                </div>
                <MonthSelector value={payToPayMonth} onChange={setPayToPayMonth} />
              </div>
              {activeEstablishment && (
                <PayToPayCockpit
                  organizationId={activeEstablishment.organization_id}
                  establishmentId={activeEstablishment.id}
                  yearMonth={toYearMonthString(payToPayMonth)}
                  supplierNames={supplierNames}
                />
              )}
            </TabsContent>
          )}

          <TabsContent value="bl-app">
            <BlAppTab />
          </TabsContent>

          <TabsContent value="bl-retraits">
            <BlRetraitTab />
          </TabsContent>
        </Tabs>
      </div>
    </ResponsiveLayout>
  );
}

/**
 * PayToPayCockpit — Cockpit "À payer" — scope mensuel strict
 * - AutopayConfirmModal SUPPRIMÉ (auto-paiement = CRON serveur uniquement)
 * - Wallet fournisseur = FIFO mensuel strict via useSupplierGlobalPayment
 * - Wallet facture = allocation directe via AddPaymentDialog
 * - Surpaiement autorisé → crédit fournisseur
 * - Installments : date calculée depuis la règle M+1, indicateur "Paiement X/N"
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Clock, CalendarCheck, Minus, Eye, Settings, CheckCircle2, CreditCard, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  usePayToPayCockpit,
  useEstablishmentSettings,
  useUpsertEstablishmentSettings,
  useAutoSyncPayInvoices,
} from "../hooks/usePayLedger";
import { AddPaymentDialog } from "./AddPaymentDialog";
import { GlobalSupplierPaymentDialog } from "./GlobalSupplierPaymentDialog";
import { PaymentTimelineDrawer } from "./PaymentTimelineDrawer";
import {
  computeInvoicePaid,
  computeInvoiceRemaining,
  computeInvoiceStatus,
  computeExpectedDueDate,
  computeUrgency,
  urgencyLabel,
  urgencyColor,
  URGENCY_SORT,
  formatEurPay,
  formatDateKey,
  computeInstallmentSchedule,
  computeNextInstallmentDueDate,
} from "../engine/payEngine";
import type { PayInvoice, PaySupplierRule } from "../types";

interface PayToPayCockpitProps {
  organizationId:  string;
  establishmentId: string;
  yearMonth:       string;
  supplierNames:   Record<string, string>;
}

function UrgencyIcon({ level }: { level: ReturnType<typeof computeUrgency> }) {
  if (level === "overdue")  return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (level === "soon")     return <Clock         className="h-3.5 w-3.5 text-orange-500" />;
  if (level === "upcoming") return <CalendarCheck className="h-3.5 w-3.5 text-primary" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

type EnrichedInvoice = {
  invoice:   PayInvoice;
  paid:      number;
  remaining: number;
  dueDate:   Date | null;
  urgency:   ReturnType<typeof computeUrgency>;
};

type SupplierGroup = {
  supplierId:     string;
  supplierName:   string;
  totalRemaining: number;
  totalPaid:      number;
  totalDebt:      number;
  nextDueDate:    Date | null;
  worstUrgency:   ReturnType<typeof computeUrgency>;
  invoices:       EnrichedInvoice[];
  rule:           PaySupplierRule | null;
};

/**
 * Détermine le mode d'affichage UI depuis la règle — PUR, sans nouvelle logique métier.
 *
 * "monthly_aggregate" → 1 prélèvement mensuel global (delay/fixed_day + is_monthly_aggregate=true)
 * "installments"      → plusieurs prélèvements dans le mois
 * "per_invoice"       → paiement facture par facture (mode manuel ou pas d'agrégat)
 */
function getDisplayMode(rule: PaySupplierRule | null): "monthly_aggregate" | "installments" | "per_invoice" {
  if (!rule || rule.mode === "none" || rule.mode === "manual_transfer") return "per_invoice";
  if (rule.mode === "installments") return "installments";
  // delay / fixed_day : regarde le flag UI
  if (rule.is_monthly_aggregate) return "monthly_aggregate";
  return "per_invoice";
}

const URGENCY_ORDER: Record<ReturnType<typeof computeUrgency>, number> = {
  overdue: 0, soon: 1, upcoming: 2, no_date: 3,
};

export function PayToPayCockpit({
  organizationId,
  establishmentId,
  yearMonth,
  supplierNames: supplierNamesProp,
}: PayToPayCockpitProps) {
  // Auto-sync: backfill new invoices silently on mount
  useAutoSyncPayInvoices(establishmentId, organizationId, yearMonth);

  const { invoices, allocations, rules, scheduleItems, isLoading, isError } =
    usePayToPayCockpit(establishmentId, yearMonth);

  const { data: estabSettings }   = useEstablishmentSettings(establishmentId);
  const upsertSettings             = useUpsertEstablishmentSettings(establishmentId);
  const autoRecord                 = estabSettings?.auto_record_direct_debit ?? false;

  const rulesMap = new Map(rules.map((r) => [r.supplier_id, r]));

  const [addPayInvoice,    setAddPayInvoice]    = useState<PayInvoice | null>(null);
  const [timelineInvoice,  setTimelineInvoice]  = useState<PayInvoice | null>(null);
  const [globalSupplierId, setGlobalSupplierId] = useState<string | null>(null);
  const [globalAmount,     setGlobalAmount]     = useState<number>(0);
  const [settingsOpen,     setSettingsOpen]     = useState(false);
  const [showPaid,         setShowPaid]         = useState(true);

  // Noms fournisseurs autonomes
  const supplierIdsInCockpit = [...new Set(invoices.map((i) => i.supplier_id))];
  const { data: suppliersData } = useQuery({
    queryKey:  ["invoice_suppliers_names", establishmentId, supplierIdsInCockpit.sort().join(",")],
    enabled:   supplierIdsInCockpit.length > 0,
    staleTime: 5 * 60_000,
    queryFn:   async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("invoice_suppliers")
        .select("id, name")
        .in("id", supplierIdsInCockpit);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const supplierNames: Record<string, string> = {
    ...supplierNamesProp,
    ...Object.fromEntries((suppliersData ?? []).map((s) => [s.id, s.name])),
  };

  // Enrichissement des factures
  const today = new Date();
  const todayStr = formatDateKey(today);

  const allEnrichedInvoices: EnrichedInvoice[] = invoices
    .map((invoice) => {
      const rule      = rulesMap.get(invoice.supplier_id) ?? null;
      const paid      = computeInvoicePaid(invoice.id, allocations);
      const remaining = computeInvoiceRemaining(invoice, paid);

      let dueDate: Date | null;
      if (rule?.mode === "installments") {
        dueDate = computeNextInstallmentDueDate(invoice.invoice_date, rule, today);
      } else {
        dueDate = computeExpectedDueDate(invoice.invoice_date, rule);
      }

      // Grace period : si la due_date est antérieure à la création de la règle,
      // la dette n'était pas encore connue → on affiche "upcoming" au lieu de "overdue".
      const ruleCreatedAt = rule?.created_at ? new Date(rule.created_at) : null;
      const urgency = computeUrgency(dueDate, ruleCreatedAt);
      return { invoice, paid, remaining, dueDate, urgency };
    })
    .sort((a, b) => {
      const byUrgency = URGENCY_SORT[a.urgency] - URGENCY_SORT[b.urgency];
      if (byUrgency !== 0) return byUrgency;
      return (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
    });

  const openInvoices = showPaid
    ? allEnrichedInvoices
    : allEnrichedInvoices.filter((e) => computeInvoiceStatus(e.invoice, e.paid) !== "PAID");

  // Groupement par fournisseur
  const groupsMap = new Map<string, SupplierGroup>();
  for (const e of openInvoices) {
    const sid = e.invoice.supplier_id;
    if (!groupsMap.has(sid)) {
      groupsMap.set(sid, {
        supplierId:     sid,
        supplierName:   supplierNames[sid] ?? "Fournisseur",
        totalRemaining: 0,
        totalPaid:      0,
        totalDebt:      0,
        nextDueDate:    null,
        worstUrgency:   "no_date",
        invoices:       [],
        rule:           rulesMap.get(sid) ?? null,
      });
    }
    const g = groupsMap.get(sid)!;
    g.totalRemaining += e.remaining;
    // Cap paid per invoice to avoid overpayment inflating the "Déjà payé" total
    g.totalPaid      += Math.min(e.paid, e.invoice.amount_eur);
    g.totalDebt      += e.invoice.amount_eur;
    g.invoices.push(e);
    // nextDueDate + worstUrgency = parmi les factures NON payées uniquement
    const invoiceIsPaid = computeInvoiceStatus(e.invoice, e.paid) === "PAID";
    if (!invoiceIsPaid && e.dueDate && (!g.nextDueDate || e.dueDate < g.nextDueDate)) g.nextDueDate = e.dueDate;
    if (!invoiceIsPaid && URGENCY_ORDER[e.urgency] < URGENCY_ORDER[g.worstUrgency]) g.worstUrgency = e.urgency;
  }

  const groups: SupplierGroup[] = [...groupsMap.values()].sort(
    (a, b) => URGENCY_ORDER[a.worstUrgency] - URGENCY_ORDER[b.worstUrgency]
  );

  const totalOverdue = openInvoices.filter((e) => e.urgency === "overdue").reduce((s, e) => s + e.remaining, 0);
  const totalOpen    = openInvoices.reduce((s, e) => s + e.remaining, 0);

  // Suppress unused warning — scheduleItems used by CRON, kept for future use
  void scheduleItems;

  if (isLoading) return (
    <div className="flex justify-center py-12">
      <div className="animate-pulse text-muted-foreground text-sm">Chargement du cockpit...</div>
    </div>
  );

  if (isError) return (
    <div className="p-4 text-center text-destructive text-sm">Impossible de charger les données.</div>
  );

  return (
    <div className="space-y-4">
      {/* Header KPIs + ⚙️ */}
      <div className="flex items-start justify-between gap-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 flex-1">
          <div className="p-4 rounded-xl border bg-card space-y-1">
            <p className="text-xs text-muted-foreground">Fournisseurs concernés</p>
            <p className="text-2xl font-bold tabular-nums">{groups.length}</p>
          </div>
          <div className="p-4 rounded-xl border bg-card space-y-1">
            <p className="text-xs text-muted-foreground">Total à payer</p>
            <p className="text-2xl font-bold tabular-nums text-primary">{formatEurPay(totalOpen)}</p>
          </div>
          {totalOverdue > 0 && (
            <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-destructive" />En retard
              </p>
              <p className="text-2xl font-bold tabular-nums text-destructive">{formatEurPay(totalOverdue)}</p>
            </div>
          )}
        </div>
        <Button
          size="icon" variant="ghost"
          className="shrink-0 h-9 w-9 text-muted-foreground"
          onClick={() => setSettingsOpen((v) => !v)}
          title="Paramètres de paiement"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      {/* Panneau paramètres */}
      {settingsOpen && (
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <p className="text-sm font-semibold">Paramètres de paiement</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-sm">Auto-enregistrer les prélèvements à l'échéance</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Enregistre des paiements dans l'app via le serveur. Aucun prélèvement bancaire n'est déclenché.
                </p>
              </div>
              <Switch
                checked={autoRecord}
                onCheckedChange={async (checked) => {
                  try {
                    await upsertSettings.mutateAsync({ organization_id: organizationId, auto_record_direct_debit: checked });
                    toast.success(checked ? "Mode automatique activé" : "Mode manuel activé");
                  } catch {
                    toast.error("Erreur lors de la sauvegarde");
                  }
                }}
                disabled={upsertSettings.isPending}
              />
            </div>
            <p className="text-xs text-muted-foreground border-t pt-2">
              {autoRecord
                ? "Les prélèvements sont enregistrés automatiquement chaque heure par le serveur."
                : "En mode manuel, les factures échues affichent un badge Échéance dépassée. Paiement via le bouton Payer."}
            </p>
          </div>
        </div>
      )}

      {/* Toggle payées */}
      <div className="flex items-center justify-end gap-2">
        <Switch id="show-paid" checked={showPaid} onCheckedChange={setShowPaid} />
        <Label htmlFor="show-paid" className="text-xs text-muted-foreground cursor-pointer">
          Afficher les payées
        </Label>
      </div>

      {/* Groupes fournisseurs */}
      {groups.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CalendarCheck className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Tout est à jour !</p>
          <p className="text-xs mt-1">Aucune facture avec solde ouvert{showPaid ? "" : " (non payée)"}.</p>
        </div>
      ) : (
        <Accordion type="single" collapsible className="space-y-2">
          {groups.map((group) => {
            const isFullyPaid   = group.totalRemaining <= 0.005;
            const displayMode   = getDisplayMode(group.rule);
            const isAggregated  = displayMode !== "per_invoice";

            return (
              <AccordionItem
                key={group.supplierId}
                value={group.supplierId}
                className={`rounded-xl border overflow-hidden transition-colors ${
                  isFullyPaid
                    ? "border-green-200 bg-green-50/60 dark:border-green-800/40 dark:bg-green-950/20"
                    : "bg-card"
                }`}
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/30 transition-colors [&>svg]:text-muted-foreground">
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0 pr-2">

                    {/* Ligne principale */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {!isFullyPaid && <UrgencyIcon level={group.worstUrgency} />}
                        <span className={`font-semibold truncate ${isFullyPaid ? "text-green-700 dark:text-green-400" : ""}`}>
                          {group.supplierName}
                        </span>
                        {!isFullyPaid && group.worstUrgency !== "no_date" && (
                          <Badge className={`text-[10px] px-1.5 py-0 shrink-0 ${urgencyColor(group.worstUrgency)}`}>
                            {urgencyLabel(group.worstUrgency)}
                          </Badge>
                        )}
                      </div>
                      <div className="flex md:flex-row flex-col items-end md:items-center gap-1 md:gap-3 shrink-0">
                        {/* Prochaine échéance — masquée pour les modes agrégés (dans le bloc récap) */}
                        {group.nextDueDate && !isAggregated && (
                          <span className="text-xs text-muted-foreground hidden sm:inline">
                            Prochaine échéance : {formatDateKey(group.nextDueDate)}
                          </span>
                        )}
                        {isFullyPaid ? (
                          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                        ) : (
                          <span className="font-bold tabular-nums text-sm text-primary">
                            {formatEurPay(group.totalRemaining)}
                          </span>
                        )}
                        {!isFullyPaid && (
                          <Button
                            size="icon" variant="default" className="h-7 w-7 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              setGlobalSupplierId(group.supplierId);
                              setGlobalAmount(group.totalRemaining);
                            }}
                            title="Payer le fournisseur (FIFO mensuel)"
                          >
                            <Wallet className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Bloc récap mensuel — modes agrégés (installments + monthly_aggregate) */}
                    {isAggregated && (
                      <div className="flex items-center gap-3 text-xs flex-wrap">
                        <span className="text-muted-foreground">
                          Déjà payé (mois) :&nbsp;
                          <span className="font-semibold text-foreground tabular-nums">{formatEurPay(group.totalPaid)}</span>
                        </span>
                        <span className="text-muted-foreground border-l border-border pl-3">
                          Reste à payer (mois) :&nbsp;
                          <span className={`font-semibold tabular-nums ${isFullyPaid ? "text-green-600" : "text-primary"}`}>
                            {isFullyPaid ? "—" : formatEurPay(group.totalRemaining)}
                          </span>
                        </span>
                        {group.nextDueDate && !isFullyPaid && (
                          <span className="text-muted-foreground border-l border-border pl-3">
                            Prochaine échéance :&nbsp;
                            <span className="font-semibold text-foreground">{formatDateKey(group.nextDueDate)}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </AccordionTrigger>

                <AccordionContent className="px-0 pt-0 pb-0">
                  <div className="border-t divide-y">
                    {/* En-tête colonnes desktop selon mode */}
                    {isAggregated ? (
                      /* Agrégé : ref + date + total + œil uniquement */
                      <div className="hidden md:grid grid-cols-[1fr_120px_60px] gap-4 px-6 py-3 text-xs text-muted-foreground font-semibold uppercase tracking-wide bg-muted/30 border-b">
                        <span>Facture</span>
                        <span className="text-right">Total</span>
                        <span className="text-right">Actions</span>
                      </div>
                    ) : (
                      /* Par facture : colonnes complètes */
                      <div className="hidden md:grid grid-cols-[1fr_120px_120px_130px_140px] gap-4 px-6 py-3 text-xs text-muted-foreground font-semibold uppercase tracking-wide bg-muted/30 border-b">
                        <span>Facture</span>
                        <span className="text-right">Total</span>
                        <span className="text-right">Payé</span>
                        <span className="text-right">Reste</span>
                        <span className="text-right">Actions</span>
                      </div>
                    )}

                    {group.invoices.map(({ invoice, paid, remaining, dueDate, urgency }) => {
                      const status = computeInvoiceStatus(invoice, paid);
                      const isPaid = status === "PAID";

                      // Badge installment — uniquement pour le mode installments (pas monthly_aggregate)
                      let installmentBadge: string | null = null;
                      if (displayMode === "installments" && group.rule?.installment_count && group.rule.installment_days) {
                        const schedule = computeInstallmentSchedule(
                          invoice.invoice_date.substring(0, 7),
                          invoice.amount_eur,
                          group.rule
                        );
                        const activeIdx  = schedule.findIndex((s) => s.dueDate >= todayStr);
                        const displayIdx = activeIdx >= 0 ? activeIdx : schedule.length - 1;
                        installmentBadge = `Paiement ${displayIdx + 1}/${schedule.length} — ${formatEurPay(schedule[displayIdx]?.amount ?? 0)}`;
                      }

                      return (
                        <div key={invoice.id} className={`px-6 py-4 transition-colors ${isPaid ? "bg-muted/10" : "hover:bg-muted/10"}`}>

                          {/* ── Mode agrégé (monthly_aggregate + installments) ──────── */}
                          {isAggregated && (
                            <>
                              {/* Desktop agrégé : ref + date + total + œil */}
                              <div className="hidden md:grid grid-cols-[1fr_120px_60px] gap-4 items-center">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className={`truncate font-semibold text-sm ${isPaid ? "text-muted-foreground" : ""}`}>
                                      {invoice.label || invoice.invoice_date}
                                    </p>
                                    {invoice.label && (
                                      <span className="text-xs text-muted-foreground shrink-0">{invoice.invoice_date}</span>
                                    )}
                                    {isPaid && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
                                  </div>
                                  {!isPaid && installmentBadge && (
                                    <Badge variant="outline" className="mt-0.5 text-[10px] px-2 py-0.5 font-medium text-primary border-primary/30">
                                      {installmentBadge}
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-right">
                                  <span className="text-sm tabular-nums text-muted-foreground">{formatEurPay(invoice.amount_eur)}</span>
                                </div>
                                <div className="flex items-center justify-end">
                                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                                    onClick={() => setTimelineInvoice(invoice)} title="Voir historique">
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>

                              {/* Mobile agrégé */}
                              <div className="md:hidden flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className={`font-semibold text-sm truncate ${isPaid ? "text-muted-foreground" : ""}`}>
                                      {invoice.label || invoice.invoice_date}
                                    </p>
                                    {invoice.label && (
                                      <span className="text-xs text-muted-foreground shrink-0">{invoice.invoice_date}</span>
                                    )}
                                    {isPaid && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
                                  </div>
                                  {!isPaid && installmentBadge && (
                                    <Badge variant="outline" className="mt-0.5 text-[10px] px-2 py-0.5 font-medium text-primary border-primary/30">
                                      {installmentBadge}
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-xs tabular-nums text-muted-foreground">{formatEurPay(invoice.amount_eur)}</span>
                                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground"
                                    onClick={() => setTimelineInvoice(invoice)}>
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </>
                          )}

                          {/* ── Mode par facture ───────────────────────────────────── */}
                          {!isAggregated && (
                            <>
                              {/* Desktop par facture : colonnes complètes */}
                              <div className="hidden md:grid grid-cols-[1fr_120px_120px_130px_140px] gap-4 items-center">
                                <div className="min-w-0 space-y-1">
                                  <div className="flex items-center gap-2">
                                    <p className={`truncate font-semibold text-sm ${isPaid ? "text-muted-foreground" : ""}`}>
                                      {invoice.label || invoice.invoice_date}
                                    </p>
                                    {invoice.label && (
                                      <span className="text-xs text-muted-foreground shrink-0">{invoice.invoice_date}</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {!isPaid && dueDate && (
                                      <>
                                        <UrgencyIcon level={urgency} />
                                        <span className="text-xs text-muted-foreground">{formatDateKey(dueDate)}</span>
                                        <Badge className={`text-[10px] px-2 py-0.5 font-medium ${urgencyColor(urgency)}`}>
                                          {urgencyLabel(urgency)}
                                        </Badge>
                                      </>
                                    )}
                                    {!isPaid && !dueDate && (
                                      <span className="text-xs text-muted-foreground">{invoice.invoice_date}</span>
                                    )}
                                    {!autoRecord && !isPaid && urgency === "overdue" && (
                                      <Badge className="text-[10px] px-2 py-0.5 font-medium bg-destructive/10 text-destructive border border-destructive/20">
                                        Échéance dépassée
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <span className="text-sm tabular-nums text-muted-foreground">{formatEurPay(invoice.amount_eur)}</span>
                                </div>
                                <div className="text-right">
                                  <span className="text-sm tabular-nums text-muted-foreground">{formatEurPay(paid)}</span>
                                </div>
                                <div className="text-right flex items-center justify-end">
                                  {isPaid ? (
                                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                                  ) : (
                                    <span className="text-sm tabular-nums font-bold text-primary">{formatEurPay(remaining)}</span>
                                  )}
                                </div>
                                <div className="flex items-center justify-end gap-1">
                                  {!isPaid && (
                                    <Button size="sm" variant="ghost"
                                      className="h-8 px-2.5 text-xs gap-1.5 text-primary hover:text-primary hover:bg-primary/8 font-medium"
                                      onClick={() => setAddPayInvoice(invoice)} title="Enregistrer un paiement">
                                      <CreditCard className="h-3.5 w-3.5" />Payer
                                    </Button>
                                  )}
                                  <Button size="sm" variant="ghost"
                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                                    onClick={() => setTimelineInvoice(invoice)} title="Voir historique">
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>

                              {/* Mobile par facture */}
                              <div className="md:hidden space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 space-y-1">
                                    <div className="flex items-center gap-2">
                                      <p className={`font-semibold text-sm truncate ${isPaid ? "text-muted-foreground" : ""}`}>
                                        {invoice.label || invoice.invoice_date}
                                      </p>
                                      {invoice.label && (
                                        <span className="text-xs text-muted-foreground shrink-0">{invoice.invoice_date}</span>
                                      )}
                                    </div>
                                    {!isPaid && dueDate && (
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <UrgencyIcon level={urgency} />
                                        <span className="text-xs text-muted-foreground">{formatDateKey(dueDate)}</span>
                                        <Badge className={`text-[10px] px-1.5 py-0.5 ${urgencyColor(urgency)}`}>
                                          {urgencyLabel(urgency)}
                                        </Badge>
                                        {!autoRecord && urgency === "overdue" && (
                                          <Badge className="text-[10px] px-1.5 py-0.5 bg-destructive/10 text-destructive border border-destructive/20">
                                            Échéance dépassée
                                          </Badge>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="grid grid-cols-3 gap-3 text-xs bg-muted/20 rounded-lg p-3">
                                  <div className="text-center">
                                    <p className="text-muted-foreground mb-0.5">Total</p>
                                    <p className="font-semibold tabular-nums">{formatEurPay(invoice.amount_eur)}</p>
                                  </div>
                                  <div className="text-center border-x border-border">
                                    <p className="text-muted-foreground mb-0.5">Payé</p>
                                    <p className="tabular-nums">{formatEurPay(paid)}</p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-muted-foreground mb-0.5">Reste</p>
                                    {isPaid ? (
                                      <div className="flex justify-center"><CheckCircle2 className="h-4 w-4 text-green-600" /></div>
                                    ) : (
                                      <p className="font-bold tabular-nums text-primary">{formatEurPay(remaining)}</p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-1">
                                  {!isPaid && (
                                    <Button size="sm" variant="ghost"
                                      className="flex-1 h-9 text-xs gap-1.5 text-primary hover:text-primary hover:bg-primary/8 font-medium"
                                      onClick={() => setAddPayInvoice(invoice)}>
                                      <CreditCard className="h-3.5 w-3.5" />Payer
                                    </Button>
                                  )}
                                  <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-muted-foreground"
                                    onClick={() => setTimelineInvoice(invoice)}>
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {/* Dialogs */}
      {addPayInvoice && (
        <AddPaymentDialog
          open
          onClose={() => setAddPayInvoice(null)}
          organizationId={organizationId}
          establishmentId={establishmentId}
          supplierId={addPayInvoice.supplier_id}
          payInvoiceId={addPayInvoice.id}
          yearMonth={yearMonth}
          remaining={(() => {
            const paid = computeInvoicePaid(addPayInvoice.id, allocations);
            return computeInvoiceRemaining(addPayInvoice, paid);
          })()}
          supplierName={supplierNames[addPayInvoice.supplier_id] ?? "Fournisseur"}
          invoiceLabel={addPayInvoice.label}
          allowPartial={rulesMap.get(addPayInvoice.supplier_id)?.allow_partial ?? true}
        />
      )}

      {timelineInvoice && (
        <PaymentTimelineDrawer
          open
          onClose={() => setTimelineInvoice(null)}
          invoice={timelineInvoice}
          allocations={allocations}
          establishmentId={establishmentId}
          organizationId={organizationId}
          yearMonth={yearMonth}
          supplierName={supplierNames[timelineInvoice.supplier_id] ?? "Fournisseur"}
          onAddPayment={(inv) => {
            setTimelineInvoice(null);
            setAddPayInvoice(inv);
          }}
        />
      )}

      {globalSupplierId && (
        <GlobalSupplierPaymentDialog
          open
          onClose={() => { setGlobalSupplierId(null); setGlobalAmount(0); }}
          organizationId={organizationId}
          establishmentId={establishmentId}
          supplierId={globalSupplierId}
          supplierName={supplierNames[globalSupplierId] ?? "Fournisseur"}
          yearMonth={yearMonth}
          monthRemaining={globalAmount}
          defaultAmount={globalAmount}
        />
      )}
    </div>
  );
}

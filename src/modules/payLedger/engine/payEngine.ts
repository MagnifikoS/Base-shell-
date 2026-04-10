/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PAY ENGINE — Fonctions pures Phase 1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ RÈGLES ABSOLUES :
 *   - Aucun import React, aucun hook, aucun appel DB.
 *   - Aucune lecture de invoices.is_paid.
 *   - Statut = calcul uniquement sur pay_* data.
 *   - EURO ONLY — pas de devise.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type {
  PayInvoice,
  PayAllocationWithVoidStatus,
  PaymentStatus,
  MonthRecap,
  SupplierRecap,
  PaySupplierRule,
  PayScheduleItem,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// INVOICE LEVEL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Somme des allocations NON voidées pour une dette donnée.
 * Les allocations liées à un paiement voidé (payment_voided_at != null) sont exclues.
 */
export function computeInvoicePaid(
  invoiceId: string,
  allocations: PayAllocationWithVoidStatus[]
): number {
  return allocations
    .filter(
      (a) => a.pay_invoice_id === invoiceId && a.payment_voided_at === null
    )
    .reduce((sum, a) => sum + a.amount_eur, 0);
}

/**
 * Montant restant à payer pour une dette.
 * Toujours >= 0 (pas de négatif en cas de surpaiement ponctuel).
 */
export function computeInvoiceRemaining(invoice: PayInvoice, paid: number): number {
  return Math.max(0, invoice.amount_eur - paid);
}

/**
 * Statut calculé d'une dette — JAMAIS stocké en DB.
 * PAID     = paid >= amount_eur
 * UNPAID   = paid == 0
 * PARTIAL  = 0 < paid < amount_eur
 */
export function computeInvoiceStatus(
  invoice: PayInvoice,
  paid: number
): PaymentStatus {
  if (paid <= 0) return "UNPAID";
  if (paid >= invoice.amount_eur) return "PAID";
  return "PARTIAL";
}

// ─────────────────────────────────────────────────────────────────────────────
// MONTH RECAP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Récap mensuel complet — calculé depuis pay_invoices + pay_allocations.
 * Aucune lecture de invoices.is_paid.
 */
/** Arrondi à 2 décimales (centimes) — évite les flottants JS 0.30000000000000004 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeMonthRecap(
  invoices: PayInvoice[],
  allocations: PayAllocationWithVoidStatus[]
): MonthRecap {
  const supplierIds = [...new Set(invoices.map((i) => i.supplier_id))];

  const bySupplier: SupplierRecap[] = supplierIds.map((supplierId) => {
    const supplierInvoices = invoices.filter((i) => i.supplier_id === supplierId);
    const totalDette = round2(supplierInvoices.reduce((sum, i) => sum + i.amount_eur, 0));

    let totalPaye = 0;
    for (const inv of supplierInvoices) {
      totalPaye = round2(totalPaye + computeInvoicePaid(inv.id, allocations));
    }

    const reste = round2(computeInvoiceRemaining(
      { amount_eur: totalDette } as PayInvoice,
      totalPaye
    ));
    const status = computeInvoiceStatus(
      { amount_eur: totalDette } as PayInvoice,
      totalPaye
    );

    return { supplier_id: supplierId, total_dette: totalDette, total_paye: totalPaye, reste, status };
  });

  const totalDette = round2(bySupplier.reduce((s, r) => s + r.total_dette, 0));
  const totalPaye  = round2(bySupplier.reduce((s, r) => s + r.total_paye, 0));

  return {
    total_dette:   totalDette,
    total_paye:    totalPaye,
    reste_a_payer: Math.max(0, round2(totalDette - totalPaye)),
    by_supplier:   bySupplier,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTING HELPERS (pures)
// ─────────────────────────────────────────────────────────────────────────────

export function formatEurPay(amount: number): string {
  return amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

export function statusLabel(status: PaymentStatus): string {
  switch (status) {
    case "PAID":    return "Payé";
    case "PARTIAL": return "Partiel";
    case "UNPAID":  return "Impayé";
  }
}

export function statusColor(status: PaymentStatus): string {
  switch (status) {
    case "PAID":    return "bg-green-100 text-green-800";
    case "PARTIAL": return "bg-yellow-100 text-yellow-800";
    case "UNPAID":  return "bg-red-100 text-red-800";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — SUPPLIER RULES ENGINE (fonctions pures)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formate un objet Date en "YYYY-MM-DD" (heure locale — Paris-safe en prod).
 * Ne doit JAMAIS utiliser toISOString() (UTC shift).
 */
export function formatDateKey(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Calcule la date d'échéance attendue selon la règle fournisseur.
 * PURE FUNCTION — Paris-safe (arithmétique sur composantes locales).
 *
 * none / manual_transfer → null
 * direct_debit_delay     → invoice_date + delay_days
 * direct_debit_fixed_day → TOUJOURS M+1 (mois suivant la facture), jour = fixed_day
 * installments           → null (géré via computeNextInstallmentDueDate)
 */
export function computeExpectedDueDate(
  invoiceDate: string,   // "YYYY-MM-DD"
  rule: PaySupplierRule | null
): Date | null {
  if (!rule) return null;

  const [yr, mo, dy] = invoiceDate.split("-").map(Number);

  switch (rule.mode) {
    case "none":
    case "manual_transfer":
      return null;

    case "direct_debit_delay": {
      if (rule.delay_days == null) return null;
      const d = new Date(yr, mo - 1, dy);
      d.setDate(d.getDate() + rule.delay_days);
      return d;
    }

    case "direct_debit_fixed_day": {
      if (rule.fixed_day_of_month == null) return null;
      // TOUJOURS M+1 : le prélèvement intervient le mois suivant celui de la facture.
      // mo est 1-indexed → new Date(yr, mo, fixed) = mois suivant (0-indexed).
      return new Date(yr, mo, rule.fixed_day_of_month);
    }

    case "installments":
      return null; // géré via computeNextInstallmentDueDate

    default:
      return null;
  }
}

/**
 * Prochaine échéance attendue pour une facture donnée.
 * Retourne null si facture soldée ou aucune règle applicable.
 */
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — SUPPLIER CREDIT + URGENCY
// ─────────────────────────────────────────────────────────────────────────────

import type { PayPayment } from "../types";

export type UrgencyLevel = "overdue" | "soon" | "upcoming" | "no_date";

/**
 * Calcule l'urgence d'une facture selon sa date d'échéance.
 * Basé sur la date du jour en heure locale (Paris-safe).
 *
 * @param ruleCreatedAt — si fourni et que dueDate < ruleCreatedAt, grace period :
 *   la règle n'existait pas encore quand l'échéance est passée → "upcoming".
 */
export function computeUrgency(dueDate: Date | null, ruleCreatedAt?: Date | null): UrgencyLevel {
  if (!dueDate) return "no_date";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diffMs   = due.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  // Grace period : si la règle a été créée APRÈS l'échéance, on ne peut pas
  // reprocher à l'utilisateur un retard qu'il ne connaissait pas encore.
  if (diffDays < 0 && ruleCreatedAt) {
    const ruleDate = new Date(ruleCreatedAt);
    ruleDate.setHours(0, 0, 0, 0);
    if (ruleDate > due) return "upcoming";
  }

  if (diffDays < 0)  return "overdue";
  if (diffDays <= 7) return "soon";
  return "upcoming";
}

export function urgencyLabel(u: UrgencyLevel): string {
  switch (u) {
    case "overdue":  return "En retard";
    case "soon":     return "Bientôt";
    case "upcoming": return "À venir";
    case "no_date":  return "Sans échéance";
  }
}

export function urgencyColor(u: UrgencyLevel): string {
  switch (u) {
    case "overdue":  return "bg-destructive/10 text-destructive";
    case "soon":     return "bg-orange-500/10 text-orange-700 dark:text-orange-400";
    case "upcoming": return "bg-primary/10 text-primary";
    case "no_date":  return "bg-muted text-muted-foreground";
  }
}

export const URGENCY_SORT: Record<UrgencyLevel, number> = {
  overdue: 0, soon: 1, upcoming: 2, no_date: 3,
};

/**
 * Crédit fournisseur = total paiements non-voidés - total allocations non-voidées.
 * Représente un surplus non alloué (paiement global > dettes).
 */
export function computeSupplierCredit(
  payments:    PayPayment[],
  allocations: PayAllocationWithVoidStatus[]
): number {
  const totalPaid      = payments.filter(p => p.voided_at === null).reduce((s, p) => s + p.amount_eur, 0);
  const totalAllocated = allocations.filter(a => a.payment_voided_at === null).reduce((s, a) => s + a.amount_eur, 0);
  return Math.max(0, round2(totalPaid - totalAllocated));
}

export function computeNextExpectedPayment(
  invoice:       PayInvoice,
  scheduleItems: PayScheduleItem[],
  rule:          PaySupplierRule | null,
  allocations:   PayAllocationWithVoidStatus[]
): { dueDate: Date; expectedAmount: number } | null {
  const paid      = computeInvoicePaid(invoice.id, allocations);
  const remaining = computeInvoiceRemaining(invoice, paid);
  if (remaining <= 0) return null;

  // installments : la date est calculée depuis la règle (M+1 du mois facture)
  // Ne dépend PAS des schedule_items liés à la facture.
  if (rule?.mode === "installments") {
    const nextInstallment = computeNextInstallmentDueDate(invoice.invoice_date, rule, new Date());
    if (!nextInstallment) return null;
    return {
      dueDate:        nextInstallment,
      expectedAmount: round2(remaining),
    };
  }

  const dueDate = computeExpectedDueDate(invoice.invoice_date, rule);
  if (!dueDate) return null;

  return { dueDate, expectedAmount: round2(remaining) };
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTALLMENTS ENGINE — fonctions pures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcule les N échéances d'un paiement multi-dates pour un mois de facture.
 *
 * RÈGLES :
 *   - Les dates correspondent au M+1 du mois de la facture.
 *   - Ex: facture janvier → échéances en février aux jours définis.
 *   - Les N-1 premières échéances ont le montant de base (arrondi 2 décimales).
 *   - La dernière échéance absorbe le reliquat pour garantir le total exact.
 *
 * @param invoiceYearMonth  "YYYY-MM" — mois de la facture (ex: "2025-01")
 * @param totalAmount       total fournisseur du mois (toutes factures confondues)
 * @param rule              règle fournisseur (mode=installments requis)
 * @returns tableau de { dueDate: "YYYY-MM-DD", amount: number }
 */
export function computeInstallmentSchedule(
  invoiceYearMonth: string, // "YYYY-MM"
  totalAmount:      number,
  rule:             PaySupplierRule
): Array<{ dueDate: string; amount: number }> {
  if (rule.mode !== "installments") return [];
  const count = rule.installment_count;
  const days  = rule.installment_days;
  if (!count || !days || days.length !== count || totalAmount <= 0) return [];

  // M+1 du mois de la facture
  const [yr, mo] = invoiceYearMonth.split("-").map(Number);
  const nextMonth = mo === 12 ? 1 : mo + 1;
  const nextYear  = mo === 12 ? yr + 1 : yr;

  // Montant de base par échéance (arrondi 2 décimales)
  const baseAmount = round2(Math.floor(totalAmount * 100 / count) / 100);
  let   allocated  = 0;

  return days.map((day, i) => {
    const isLast = i === count - 1;
    // Clamp le jour au dernier jour du mois suivant (ex: 31 → 28 en février)
    const lastDayOfNextMonth = new Date(nextYear, nextMonth, 0).getDate();
    const clampedDay = Math.min(day, lastDayOfNextMonth);
    const dStr = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;

    let amount: number;
    if (isLast) {
      // Dernière échéance = reliquat exact
      amount = round2(totalAmount - allocated);
    } else {
      amount = baseAmount;
      allocated = round2(allocated + baseAmount);
    }

    return { dueDate: dStr, amount };
  });
}

/**
 * Retourne la prochaine date d'échéance installment non encore dépassée.
 * Si toutes sont passées, retourne la dernière (pour afficher "En retard").
 *
 * @param invoiceDate   "YYYY-MM-DD" — date de la facture (on prend le mois)
 * @param rule          règle fournisseur (mode=installments)
 * @param today         date de référence (défaut: new Date())
 */
export function computeNextInstallmentDueDate(
  invoiceDate: string,
  rule:        PaySupplierRule,
  today:       Date = new Date()
): Date | null {
  if (rule.mode !== "installments") return null;
  const invoiceYearMonth = invoiceDate.substring(0, 7);
  // Calcul avec totalAmount=1 juste pour obtenir les dates (montants non pertinents ici)
  const schedule = computeInstallmentSchedule(invoiceYearMonth, 1, rule);
  if (schedule.length === 0) return null;

  const todayStr = formatDateKey(today);
  // Prochaine échéance future ou présente
  const next = schedule.find((s) => s.dueDate >= todayStr);
  if (next) return new Date(next.dueDate);
  // Toutes passées → retourner la dernière (affiché comme "En retard")
  return new Date(schedule[schedule.length - 1].dueDate);
}

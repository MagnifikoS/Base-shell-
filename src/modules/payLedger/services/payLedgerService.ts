/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PAY LEDGER SERVICE — SSOT unique
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RÈGLES :
 *   - Aucune lecture/écriture sur invoices.is_paid.
 *   - Pas de DELETE (append-only enforced en DB).
 *   - Void = UPDATE sur voided_at + void_reason uniquement.
 *   - Un seul chemin paiement : createPaymentWithAllocation.
 *   - autoAllocateFIFO : filtre strictement par yearMonth.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  PayInvoice,
  PayPayment,
  PayAllocation,
  PayAllocationWithVoidStatus,
  PaymentMethod,
  PaySupplierRule,
  PayScheduleItem,
  SupplierRuleMode,
  AllocationStrategy,
  PayEstablishmentSettings,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// UTILITAIRES INTERNES (un seul endroit)
// ─────────────────────────────────────────────────────────────────────────────

/** Arrondi centimes — SSOT, pas de doublon. */
export function _round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Formate Date en "YYYY-MM-DD" — Paris-safe (arithmétique sur composantes locales). */
export function _toDateStr(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Retourne {from, to} bornes d'un yearMonth "YYYY-MM". */
function monthBounds(yearMonth: string): { from: string; to: string } {
  const [year, month] = yearMonth.split("-");
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
  return {
    from: `${year}-${month}-01`,
    to:   `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// pay_invoices
// ─────────────────────────────────────────────────────────────────────────────

export async function listPayInvoicesByMonth(
  establishmentId: string,
  yearMonth: string // "YYYY-MM"
): Promise<PayInvoice[]> {
  const { from, to } = monthBounds(yearMonth);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_invoices")
    .select("*")
    .eq("establishment_id", establishmentId)
    .gte("invoice_date", from)
    .lte("invoice_date", to)
    .order("invoice_date", { ascending: false });

  if (error) throw error;
  return (data ?? []) as PayInvoice[];
}

/**
 * @deprecated NE PAS UTILISER dans le cockpit "À payer".
 *
 * Cette fonction déplaçait des factures M-1 dans le dataset du mois M
 * selon la due_date calculée (règle M+1), ce qui cassait la cohérence comptable
 * avec l'onglet "Factures" (invoice_date).
 *
 * USAGE AUTORISÉ : CRON uniquement (pour décider quand créer un paiement auto).
 * COCKPIT "À payer" : utiliser listPayInvoicesByMonth (filtre strict invoice_date).
 *
 * La due_date reste utilisée pour : badges urgence, prochaine échéance, CRON.
 * Elle ne doit jamais déterminer le "mois d'appartenance" d'une facture dans l'UI.
 */
export async function listPayInvoicesForCockpitMonth(
  establishmentId: string,
  yearMonth: string // "YYYY-MM"
): Promise<PayInvoice[]> {
  const { from, to } = monthBounds(yearMonth);

  // Bornes du mois précédent (M-1) — les factures M-1 avec due_date en M
  const [yr, mo] = yearMonth.split("-").map(Number);
  const prevMonth = mo === 1 ? 12 : mo - 1;
  const prevYear  = mo === 1 ? yr - 1 : yr;
  const prevYearMonth = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
  const { from: prevFrom, to: prevTo } = monthBounds(prevYearMonth);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [currentRes, prevRes, rulesRes] = await Promise.all([
    (supabase as any)
      .from("pay_invoices")
      .select("*")
      .eq("establishment_id", establishmentId)
      .gte("invoice_date", from)
      .lte("invoice_date", to)
      .order("invoice_date", { ascending: false }),
    (supabase as any)
      .from("pay_invoices")
      .select("*")
      .eq("establishment_id", establishmentId)
      .gte("invoice_date", prevFrom)
      .lte("invoice_date", prevTo)
      .order("invoice_date", { ascending: false }),
    (supabase as any)
      .from("pay_supplier_rules")
      .select("supplier_id, mode, fixed_day_of_month, delay_days")
      .eq("establishment_id", establishmentId)
      .in("mode", ["direct_debit_fixed_day", "direct_debit_delay"]),
  ]);

  if (currentRes.error) throw currentRes.error;
  if (prevRes.error)    throw prevRes.error;
  // Rules error is non-fatal — fallback to current-month only
  const rulesMap = new Map<string, { mode: string; fixed_day_of_month: number | null; delay_days: number | null }>(
    ((rulesRes.data ?? []) as Array<{ supplier_id: string; mode: string; fixed_day_of_month: number | null; delay_days: number | null }>)
      .map((r) => [r.supplier_id, r])
  );

  const currentInvoices = (currentRes.data ?? []) as PayInvoice[];
  const prevInvoices    = (prevRes.data ?? []) as PayInvoice[];

  // Filtrer les factures M-1 dont la due_date calculée tombe dans yearMonth
  const prevInvoicesWithDueDateInMonth = prevInvoices.filter((inv) => {
    const rule = rulesMap.get(inv.supplier_id);
    if (!rule) return false;

    const [iyr, imo, idy] = inv.invoice_date.split("-").map(Number);
    let dueDate: string | null = null;

    if (rule.mode === "direct_debit_fixed_day" && rule.fixed_day_of_month != null) {
      // M+1 : new Date(yr, mo, day) avec mo 1-indexed = mois suivant (0-indexed)
      const d = new Date(iyr, imo, rule.fixed_day_of_month);
      dueDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    } else if (rule.mode === "direct_debit_delay" && rule.delay_days != null) {
      const d = new Date(iyr, imo - 1, idy);
      d.setDate(d.getDate() + rule.delay_days);
      dueDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    return dueDate !== null && dueDate >= from && dueDate <= to;
  });

  // Dédoublonnage par id (sécurité)
  const currentIds = new Set(currentInvoices.map((i) => i.id));
  const merged = [
    ...currentInvoices,
    ...prevInvoicesWithDueDateInMonth.filter((i) => !currentIds.has(i.id)),
  ];

  return merged.sort((a, b) => b.invoice_date.localeCompare(a.invoice_date));
}

/** Toutes les dettes d'un fournisseur (tous mois confondus) — pour l'éditeur d'échéancier */
export async function listPayInvoicesBySupplier(
  establishmentId: string,
  supplierId: string
): Promise<PayInvoice[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_invoices")
    .select("*")
    .eq("establishment_id", establishmentId)
    .eq("supplier_id", supplierId)
    .order("invoice_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PayInvoice[];
}

export async function createPayInvoice(params: {
  organization_id: string;
  establishment_id: string;
  supplier_id: string;
  amount_eur: number;
  invoice_date: string;
  label?: string | null;
  source_invoice_id?: string | null;
  created_by: string;
}): Promise<PayInvoice> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_invoices")
    .insert(params)
    .select()
    .single();
  if (error) throw error;
  return data as PayInvoice;
}

// ─────────────────────────────────────────────────────────────────────────────
// pay_payments
// ─────────────────────────────────────────────────────────────────────────────

export async function listPayPaymentsBySupplier(
  establishmentId: string,
  supplierId: string
): Promise<PayPayment[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_payments")
    .select("*")
    .eq("establishment_id", establishmentId)
    .eq("supplier_id", supplierId)
    .order("payment_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PayPayment[];
}

export async function voidPayment(
  paymentId: string,
  voidReason: string
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("pay_payments")
    .update({ voided_at: new Date().toISOString(), void_reason: voidReason })
    .eq("id", paymentId);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// pay_allocations
// ─────────────────────────────────────────────────────────────────────────────

export async function listAllocationsByEstablishmentMonth(
  establishmentId: string,
  yearMonth: string // "YYYY-MM"
): Promise<PayAllocationWithVoidStatus[]> {
  // Filtre les allocations via les factures du mois ciblé uniquement.
  const invoicesOfMonth = await listPayInvoicesByMonth(establishmentId, yearMonth);
  if (invoicesOfMonth.length === 0) return [];

  const invoiceIds = invoicesOfMonth.map((i) => i.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_allocations")
    .select("*, pay_payments(voided_at)")
    .eq("establishment_id", establishmentId)
    .in("pay_invoice_id", invoiceIds);

  if (error) throw error;

  return ((data ?? []) as Array<PayAllocation & { pay_payments: { voided_at: string | null } | null }>).map(
    (a) => ({
      ...a,
      payment_voided_at: a.pay_payments?.voided_at ?? null,
    })
  );
}

export async function listAllocationsByInvoice(
  payInvoiceId: string
): Promise<PayAllocationWithVoidStatus[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_allocations")
    .select("*, pay_payments(voided_at, payment_date, method, note)")
    .eq("pay_invoice_id", payInvoiceId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ((data ?? []) as Array<PayAllocation & { pay_payments: { voided_at: string | null } | null }>).map(
    (a) => ({
      ...a,
      payment_voided_at: a.pay_payments?.voided_at ?? null,
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHEMIN UNIQUE — Créer paiement + allocation(s)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SSOT paiement : crée un pay_payment et une pay_allocation directe.
 * Utilisé par : bouton "Payer" facture, AddPaymentDialog.
 * Surpaiement autorisé (amount_eur > remaining) → surplus = crédit fournisseur.
 */
export async function createPaymentWithAllocation(params: {
  organization_id: string;
  establishment_id: string;
  supplier_id: string;
  pay_invoice_id: string;
  payment_date: string;
  amount_eur: number;
  method: PaymentMethod;
  note?: string | null;
  created_by: string;
}): Promise<{ payment: PayPayment; allocation: PayAllocation }> {
  const { pay_invoice_id, ...paymentFields } = params;

  // Idempotency key pour éviter les doublons double-clic
  const idempotency_key = crypto.randomUUID();

  // 1. Créer le paiement
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: payment, error: pErr } = await (supabase as any)
    .from("pay_payments")
    .insert({ ...paymentFields, payment_source: "manuel", idempotency_key })
    .select()
    .single();
  if (pErr) throw pErr;

  // 2. Créer l'allocation — montant = min(amount_eur, remaining) calculé côté client
  // La DB trigger valide que total allocs ≤ payment amount.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: allocation, error: aErr } = await (supabase as any)
    .from("pay_allocations")
    .insert({
      organization_id:  params.organization_id,
      establishment_id: params.establishment_id,
      payment_id:       (payment as PayPayment).id,
      pay_invoice_id,
      amount_eur:       params.amount_eur,
      created_by:       params.created_by,
    })
    .select()
    .single();
  if (aErr) throw aErr;

  return {
    payment:    payment    as PayPayment,
    allocation: allocation as PayAllocation,
  };
}

/**
 * Paiement fournisseur global : crée UN paiement + distribue FIFO
 * STRICTEMENT sur les factures du yearMonth visible.
 * Le surplus non alloué reste comme crédit fournisseur (non alloué).
 */
export async function createSupplierPaymentFIFOMonthly(params: {
  organization_id:  string;
  establishment_id: string;
  supplier_id:      string;
  payment_date:     string;
  amount_eur:       number;
  method:           PaymentMethod;
  note?:            string | null;
  created_by:       string;
  yearMonth:        string; // "YYYY-MM" — verrou mensuel strict
}): Promise<{ payment: PayPayment; allocated: number; invoiceCount: number; creditLeft: number }> {
  const { yearMonth, ...paymentFields } = params;
  const { organization_id, establishment_id, supplier_id, created_by, amount_eur } = params;

  // 1. Créer le paiement global
  const idempotency_key = crypto.randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: paymentData, error: pErr } = await (supabase as any)
    .from("pay_payments")
    .insert({
      organization_id:  paymentFields.organization_id,
      establishment_id: paymentFields.establishment_id,
      supplier_id:      paymentFields.supplier_id,
      payment_date:     paymentFields.payment_date,
      amount_eur:       paymentFields.amount_eur,
      method:           paymentFields.method,
      note:             paymentFields.note ?? null,
      payment_source:   "manuel",
      idempotency_key,
      created_by:       paymentFields.created_by,
    })
    .select()
    .single();
  if (pErr) throw pErr;
  const payment = paymentData as PayPayment;

  // 2. FIFO mensuel strict — uniquement les factures du mois visible
  const result = await autoAllocateFIFO({
    organizationId:  organization_id,
    establishmentId: establishment_id,
    paymentId:       payment.id,
    paymentAmount:   amount_eur,
    supplierId:      supplier_id,
    createdBy:       created_by,
    yearMonth,       // ← VERROU MENSUEL
  });

  return { payment, ...result };
}

// ─────────────────────────────────────────────────────────────────────────────
// pay_supplier_rules — règles paiement fournisseur
// ─────────────────────────────────────────────────────────────────────────────

export async function getSupplierRule(
  establishmentId: string,
  supplierId: string
): Promise<PaySupplierRule | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_supplier_rules")
    .select("*")
    .eq("establishment_id", establishmentId)
    .eq("supplier_id", supplierId)
    .maybeSingle();
  if (error) throw error;
  return data as PaySupplierRule | null;
}

export async function listAllSupplierRules(
  establishmentId: string
): Promise<PaySupplierRule[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_supplier_rules")
    .select("*")
    .eq("establishment_id", establishmentId);
  if (error) throw error;
  return (data ?? []) as PaySupplierRule[];
}

export async function createOrUpdateSupplierRule(params: {
  organization_id: string;
  establishment_id: string;
  supplier_id: string;
  mode: SupplierRuleMode;
  delay_days?: number | null;
  fixed_day_of_month?: number | null;
  /** Nombre d'échéances pour installments (2–5) */
  installment_count?: number | null;
  /** Jours du mois pour chaque échéance, ex: [5, 15, 25] */
  installment_days?: number[] | null;
  allow_partial?: boolean;
  allocation_strategy?: AllocationStrategy;
  /** UI uniquement — paiement agrégé mensuel (vs par facture) */
  is_monthly_aggregate?: boolean;
  created_by: string;
  updated_by: string;
}): Promise<PaySupplierRule> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_supplier_rules")
    .upsert(
      { ...params, updated_at: new Date().toISOString() },
      { onConflict: "establishment_id,supplier_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as PaySupplierRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// pay_schedule_items — échéancier manuel/automatique
// ─────────────────────────────────────────────────────────────────────────────

export async function listScheduleItemsByInvoice(
  payInvoiceId: string
): Promise<PayScheduleItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_schedule_items")
    .select("*")
    .eq("pay_invoice_id", payInvoiceId)
    .is("voided_at", null)
    .order("due_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PayScheduleItem[];
}

export async function createScheduleItem(params: {
  organization_id: string;
  establishment_id: string;
  supplier_id: string;
  pay_invoice_id: string;
  due_date: string; // YYYY-MM-DD
  expected_amount_eur?: number | null;
  source: "manuel" | "rule";
  created_by: string;
}): Promise<PayScheduleItem> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_schedule_items")
    .insert(params)
    .select()
    .single();
  if (error) throw error;
  return data as PayScheduleItem;
}

export async function voidScheduleItem(
  itemId: string,
  voidReason: string
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("pay_schedule_items")
    .update({ voided_at: new Date().toISOString(), void_reason: voidReason })
    .eq("id", itemId);
  if (error) throw error;
}

export async function listScheduleItemsByEstablishment(
  establishmentId: string
): Promise<PayScheduleItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_schedule_items")
    .select("*")
    .eq("establishment_id", establishmentId)
    .is("voided_at", null)
    .order("due_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PayScheduleItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ensurePayInvoiceFromSourceInvoice (idempotent helper)
// ─────────────────────────────────────────────────────────────────────────────

export async function ensurePayInvoiceFromSourceInvoice(params: {
  source_invoice_id: string;
  organization_id:   string;
  establishment_id:  string;
  supplier_id:       string;
  amount_eur:        number;
  invoice_date:      string;
  label?:            string | null;
  created_by:        string;
}): Promise<{ created: boolean; payInvoice: PayInvoice }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: chkErr } = await (supabase as any)
    .from("pay_invoices")
    .select("*")
    .eq("establishment_id", params.establishment_id)
    .eq("source_invoice_id", params.source_invoice_id)
    .maybeSingle();
  if (chkErr) throw chkErr;

  if (existing) {
    return { created: false, payInvoice: existing as PayInvoice };
  }

  const inv = await createPayInvoice({
    organization_id:   params.organization_id,
    establishment_id:  params.establishment_id,
    supplier_id:       params.supplier_id,
    amount_eur:        params.amount_eur,
    invoice_date:      params.invoice_date,
    label:             params.label ?? null,
    source_invoice_id: params.source_invoice_id,
    created_by:        params.created_by,
  });

  return { created: true, payInvoice: inv };
}

export async function backfillPayInvoicesFromInvoices(params: {
  organization_id:  string;
  establishment_id: string;
  created_by:       string;
}): Promise<{ created: number; skipped: number }> {
  const { organization_id, establishment_id, created_by } = params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawInvoices, error: invErr } = await (supabase as any)
    .from("invoices")
    .select("id, supplier_id, amount_eur, invoice_date, invoice_number, supplier_name")
    .eq("establishment_id", establishment_id)
    .eq("organization_id", organization_id)
    .order("invoice_date", { ascending: true });
  if (invErr) throw invErr;
  const sourceInvoices = (rawInvoices ?? []) as Array<{
    id: string;
    supplier_id: string;
    amount_eur: number;
    invoice_date: string;
    invoice_number: string | null;
    supplier_name: string | null;
  }>;

  if (sourceInvoices.length === 0) return { created: 0, skipped: 0 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawExisting, error: exErr } = await (supabase as any)
    .from("pay_invoices")
    .select("source_invoice_id")
    .eq("establishment_id", establishment_id)
    .not("source_invoice_id", "is", null);
  if (exErr) throw exErr;

  const existingSourceIds = new Set(
    ((rawExisting ?? []) as Array<{ source_invoice_id: string | null }>)
      .map((r) => r.source_invoice_id)
      .filter(Boolean)
  );

  let created = 0;
  let skipped = 0;

  for (const inv of sourceInvoices) {
    if (existingSourceIds.has(inv.id)) {
      skipped++;
      continue;
    }
    try {
      await createPayInvoice({
        organization_id,
        establishment_id,
        supplier_id:       inv.supplier_id,
        amount_eur:        inv.amount_eur,
        invoice_date:      inv.invoice_date,
        label:             inv.invoice_number ?? inv.supplier_name ?? null,
        source_invoice_id: inv.id,
        created_by,
      });
      created++;
    } catch {
      skipped++;
    }
  }

  return { created, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// ALLOCATION FIFO — MENSUEL STRICT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Auto-alloue un paiement global sur les dettes ouvertes FIFO (plus anciennes d'abord).
 * ⚠️ VERROU MENSUEL STRICT : yearMonth est obligatoire.
 * Seules les factures dont invoice_date ∈ [yearMonth-01, yearMonth-last] sont touchées.
 * Le surplus non alloué = crédit fournisseur (non stocké, calculé dynamiquement).
 */
export async function autoAllocateFIFO(params: {
  organizationId:  string;
  establishmentId: string;
  paymentId:       string;
  paymentAmount:   number;
  supplierId:      string;
  createdBy:       string;
  yearMonth:       string; // "YYYY-MM" — OBLIGATOIRE
}): Promise<{ allocated: number; invoiceCount: number; creditLeft: number }> {
  const { organizationId, establishmentId, paymentId, paymentAmount, supplierId, createdBy, yearMonth } = params;

  // 1. Dettes du fournisseur — UNIQUEMENT du mois sélectionné — triées FIFO
  const invoices = await listPayInvoicesByMonth(establishmentId, yearMonth);
  const supplierInvoices = invoices
    .filter((i) => i.supplier_id === supplierId)
    .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date));

  if (supplierInvoices.length === 0) {
    return { allocated: 0, invoiceCount: 0, creditLeft: _round2(paymentAmount) };
  }

  // 2. Allocations existantes pour ces factures (incluant void status)
  const invoiceIds = supplierInvoices.map((i) => i.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawAllocs, error: aErr } = await (supabase as any)
    .from("pay_allocations")
    .select("*, pay_payments(voided_at)")
    .in("pay_invoice_id", invoiceIds);
  if (aErr) throw aErr;
  const allocations: PayAllocationWithVoidStatus[] = (
    (rawAllocs ?? []) as Array<PayAllocation & { pay_payments: { voided_at: string | null } | null }>
  ).map((a) => ({ ...a, payment_voided_at: a.pay_payments?.voided_at ?? null }));

  // 3. Budget disponible (déduire allocations déjà créées pour ce paiement)
  const alreadyAllocated = allocations
    .filter((a) => a.payment_id === paymentId)
    .reduce((s, a) => s + a.amount_eur, 0);
  let budget = _round2(paymentAmount - alreadyAllocated);
  if (budget <= 0) return { allocated: 0, invoiceCount: 0, creditLeft: 0 };

  // 4. Distribution FIFO mensuelle
  let totalAllocated = 0;
  let invoiceCount   = 0;

  for (const invoice of supplierInvoices) {
    if (budget <= 0.005) break;

    const paid = allocations
      .filter((a) => a.pay_invoice_id === invoice.id && a.payment_voided_at === null)
      .reduce((s, a) => s + a.amount_eur, 0);
    const remaining = _round2(Math.max(0, invoice.amount_eur - paid));
    if (remaining <= 0) continue;

    const toAllocate = _round2(Math.min(budget, remaining));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: allErr } = await (supabase as any)
      .from("pay_allocations")
      .insert({
        organization_id:  organizationId,
        establishment_id: establishmentId,
        payment_id:       paymentId,
        pay_invoice_id:   invoice.id,
        amount_eur:       toAllocate,
        created_by:       createdBy,
      });
    if (allErr) throw allErr;

    totalAllocated = _round2(totalAllocated + toAllocate);
    budget         = _round2(budget - toAllocate);
    invoiceCount++;
  }

  return { allocated: totalAllocated, invoiceCount, creditLeft: _round2(budget) };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-PAYMENTS — SUPPRIMÉ (Hard Clean v1.0)
// ─────────────────────────────────────────────────────────────────────────────
// generateDueAutoPayments() a été supprimée.
// La logique autopay est EXCLUSIVEMENT gérée par la Edge Function CRON :
//   supabase/functions/pay-auto-payments-cron/index.ts
// Voir src/modules/payLedger/PAYLEDGER_ARCHITECTURE.md — section "Flux CRON".
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Crédit fournisseur — lecture des paiements
// ─────────────────────────────────────────────────────────────────────────────

export async function listPayPaymentsBySupplierAll(
  establishmentId: string,
  supplierId: string
): Promise<PayPayment[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_payments")
    .select("*")
    .eq("establishment_id", establishmentId)
    .eq("supplier_id", supplierId)
    .order("payment_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PayPayment[];
}

/**
 * Retourne paiements + allocations pour calculer le vrai crédit fournisseur.
 * Crédit = Σ paiements non-voidés − Σ allocations non-voidées.
 *
 * ✅ Filtre SQL sur payment_id (pas de filtre JS post-fetch).
 * Scope fournisseur global (pas limité au mois).
 */
export async function getSupplierCreditData(
  establishmentId: string,
  supplierId: string
): Promise<{ payments: PayPayment[]; allocations: PayAllocationWithVoidStatus[] }> {
  // 1. Paiements du fournisseur — SQL-only
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: paymentsData, error: pErr } = await (supabase as any)
    .from("pay_payments")
    .select("*")
    .eq("establishment_id", establishmentId)
    .eq("supplier_id", supplierId)
    .order("payment_date", { ascending: false });
  if (pErr) throw pErr;

  const payments = (paymentsData ?? []) as PayPayment[];
  if (payments.length === 0) {
    return { payments: [], allocations: [] };
  }

  // 2. Allocations filtrées côté SQL via payment_id IN (...)
  // Plus de filtrage JS — la DB fait le travail.
  const paymentIds = payments.map((p) => p.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawAllocs, error: aErr } = await (supabase as any)
    .from("pay_allocations")
    .select("*, pay_payments(voided_at)")
    .eq("establishment_id", establishmentId)
    .in("payment_id", paymentIds);
  if (aErr) throw aErr;

  const allocations: PayAllocationWithVoidStatus[] = (
    (rawAllocs ?? []) as Array<PayAllocation & { pay_payments: { voided_at: string | null } | null }>
  ).map((a) => ({ ...a, payment_voided_at: a.pay_payments?.voided_at ?? null }));

  return { payments, allocations };
}

// ─────────────────────────────────────────────────────────────────────────────
// pay_establishment_settings — paramètres établissement
// ─────────────────────────────────────────────────────────────────────────────

export async function getEstablishmentSettings(
  establishmentId: string
): Promise<PayEstablishmentSettings | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_establishment_settings")
    .select("*")
    .eq("establishment_id", establishmentId)
    .maybeSingle();
  if (error) throw error;
  return data as PayEstablishmentSettings | null;
}

export async function upsertEstablishmentSettings(params: {
  organization_id: string;
  establishment_id: string;
  auto_record_direct_debit: boolean;
  user_id: string;
}): Promise<PayEstablishmentSettings> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("pay_establishment_settings")
    .upsert(
      {
        organization_id:          params.organization_id,
        establishment_id:         params.establishment_id,
        auto_record_direct_debit: params.auto_record_direct_debit,
        updated_by:               params.user_id,
        updated_at:               new Date().toISOString(),
        created_by:               params.user_id,
      },
      { onConflict: "establishment_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as PayEstablishmentSettings;
}

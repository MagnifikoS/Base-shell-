/**
 * usePayLedger — React Query hooks — SSOT unifié
 *
 * RÈGLES :
 *   - Un seul hook paiement direct : useCreatePaymentWithAllocation
 *   - Un seul hook paiement global : useSupplierGlobalPayment
 *   - Aucun hook V3 doublon, aucun createPaymentOnly
 *   - Auto-paiement = CRON serveur uniquement (pas de mutation client)
 *   - Invalidations ciblées uniquement (pas de queryKey partielle)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  listPayInvoicesByMonth,
  listPayInvoicesBySupplier,
  listAllocationsByEstablishmentMonth,
  listAllocationsByInvoice,
  createPaymentWithAllocation,
  createSupplierPaymentFIFOMonthly,
  voidPayment,
  createPayInvoice,
  ensurePayInvoiceFromSourceInvoice,
  backfillPayInvoicesFromInvoices,
  getSupplierRule,
  listAllSupplierRules,
  createOrUpdateSupplierRule,
  listScheduleItemsByInvoice,
  listScheduleItemsByEstablishment,
  createScheduleItem,
  voidScheduleItem,
  listPayPaymentsBySupplierAll,
  getSupplierCreditData,
  getEstablishmentSettings,
  upsertEstablishmentSettings,
} from "../services/payLedgerService";
import {
  computeMonthRecap,
  computeInvoicePaid,
  computeInvoiceRemaining,
  computeInvoiceStatus,
  computeSupplierCredit,
} from "../engine/payEngine";
import type { PaymentMethod, SupplierRuleMode, AllocationStrategy } from "../types";


// ─────────────────────────────────────────────────────────────────────────────
// Hook principal : mois complet
// ─────────────────────────────────────────────────────────────────────────────

export function usePayLedgerMonth(
  establishmentId: string | null,
  yearMonth: string // "YYYY-MM"
) {
  const invoicesQuery = useQuery({
    queryKey: ["pay_invoices", establishmentId, yearMonth],
    enabled:  !!establishmentId,
    queryFn:  () => listPayInvoicesByMonth(establishmentId!, yearMonth),
  });

  const allocationsQuery = useQuery({
    queryKey: ["pay_allocations_month", establishmentId, yearMonth],
    enabled:  !!establishmentId,
    queryFn:  () => listAllocationsByEstablishmentMonth(establishmentId!, yearMonth),
  });

  const invoices    = invoicesQuery.data    ?? [];
  const allocations = allocationsQuery.data ?? [];
  const recap       = computeMonthRecap(invoices, allocations);

  return {
    invoices,
    allocations,
    recap,
    isLoading: invoicesQuery.isLoading || allocationsQuery.isLoading,
    isError:   invoicesQuery.isError   || allocationsQuery.isError,
    refetch:   () => {
      invoicesQuery.refetch();
      allocationsQuery.refetch();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook : détail d'une dette (pay_invoice)
// ─────────────────────────────────────────────────────────────────────────────

export function usePayInvoiceDetail(payInvoiceId: string | null) {
  const allocationsQuery = useQuery({
    queryKey: ["pay_allocations_invoice", payInvoiceId],
    enabled:  !!payInvoiceId,
    queryFn:  () => listAllocationsByInvoice(payInvoiceId!),
  });

  return {
    allocations: allocationsQuery.data ?? [],
    isLoading:   allocationsQuery.isLoading,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook : statut calculé d'une dette individuelle
// ─────────────────────────────────────────────────────────────────────────────

export function usePayInvoiceStatus(
  invoice: { id: string; amount_eur: number } | null,
  allocations: ReturnType<typeof usePayLedgerMonth>["allocations"]
) {
  if (!invoice) return { paid: 0, remaining: 0, status: "UNPAID" as const };
  const paid      = computeInvoicePaid(invoice.id, allocations);
  const remaining = computeInvoiceRemaining(
    { amount_eur: invoice.amount_eur } as Parameters<typeof computeInvoiceRemaining>[0],
    paid
  );
  const status = computeInvoiceStatus(
    { amount_eur: invoice.amount_eur } as Parameters<typeof computeInvoiceStatus>[0],
    paid
  );
  return { paid, remaining, status };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHEMIN UNIQUE — Mutation paiement direct (bouton "Payer" facture)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SSOT paiement facture individuelle.
 * Surpaiement autorisé (amount_eur > remaining) → surplus = crédit fournisseur.
 */
export function useCreatePaymentWithAllocation(
  establishmentId: string,
  yearMonth: string
) {
  const queryClient = useQueryClient();
  const { user }    = useAuth();

  return useMutation({
    mutationFn: (params: {
      organization_id: string;
      supplier_id: string;
      pay_invoice_id: string;
      payment_date: string;
      amount_eur: number;
      method: PaymentMethod;
      note?: string | null;
    }) =>
      createPaymentWithAllocation({
        ...params,
        establishment_id: establishmentId,
        created_by:       user!.id,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pay_invoices",           establishmentId, yearMonth] });
      queryClient.invalidateQueries({ queryKey: ["pay_allocations_month",  establishmentId, yearMonth] });
      queryClient.invalidateQueries({ queryKey: ["pay_invoices_cockpit",   establishmentId, yearMonth] });
      queryClient.invalidateQueries({ queryKey: ["pay_allocations_cockpit",establishmentId, yearMonth] });
      queryClient.invalidateQueries({ queryKey: ["pay_allocations_invoice", variables.pay_invoice_id] });
      queryClient.invalidateQueries({ queryKey: ["pay_supplier_credit",    establishmentId, variables.supplier_id] });
    },
  });
}

export function useVoidPayment(
  establishmentId: string,
  yearMonth: string,
  supplierId?: string
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: string; reason: string }) =>
      voidPayment(paymentId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay_allocations_month",   establishmentId, yearMonth] });
      queryClient.invalidateQueries({ queryKey: ["pay_allocations_cockpit", establishmentId, yearMonth] });
      queryClient.invalidateQueries({ queryKey: ["pay_allocations_invoice"] });
      queryClient.invalidateQueries({ queryKey: ["pay_invoices",            establishmentId, yearMonth] });
      queryClient.invalidateQueries({ queryKey: ["pay_invoices_cockpit",    establishmentId, yearMonth] });
      if (supplierId) {
        queryClient.invalidateQueries({ queryKey: ["pay_supplier_credit", establishmentId, supplierId] });
      }
    },
  });
}

export function useCreatePayInvoice(
  establishmentId: string,
  yearMonth: string
) {
  const queryClient = useQueryClient();
  const { user }    = useAuth();

  return useMutation({
    mutationFn: (params: {
      organization_id: string;
      supplier_id: string;
      amount_eur: number;
      invoice_date: string;
      label?: string | null;
      source_invoice_id?: string | null;
    }) =>
      createPayInvoice({
        ...params,
        establishment_id: establishmentId,
        created_by:       user!.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay_invoices", establishmentId, yearMonth] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Wallet fournisseur — paiement global + FIFO mensuel strict
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paiement global fournisseur.
 * FIFO limité strictement aux factures du mois visible (yearMonth).
 * Surplus non alloué = crédit fournisseur visible.
 */
export function useSupplierGlobalPayment(establishmentId: string, yearMonth: string) {
  const queryClient = useQueryClient();
  const { user }    = useAuth();

  return useMutation({
    mutationFn: async (params: {
      organization_id: string;
      supplier_id:     string;
      payment_date:    string;
      amount_eur:      number;
      method:          PaymentMethod;
      note?:           string | null;
    }) => {
      return createSupplierPaymentFIFOMonthly({
        ...params,
        establishment_id: establishmentId,
        created_by:       user!.id,
        yearMonth,
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pay_invoices",           establishmentId, yearMonth] });
      queryClient.invalidateQueries({ queryKey: ["pay_allocations_month",  establishmentId, yearMonth] });
      queryClient.invalidateQueries({ queryKey: ["pay_invoices_cockpit",   establishmentId, yearMonth] });
      queryClient.invalidateQueries({ queryKey: ["pay_allocations_cockpit",establishmentId, yearMonth] });
      queryClient.invalidateQueries({ queryKey: ["pay_allocations_invoice"] });
      queryClient.invalidateQueries({ queryKey: ["pay_supplier_credit",   establishmentId, variables.supplier_id] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cockpit "À payer" — scope mensuel strict
// ─────────────────────────────────────────────────────────────────────────────

export function usePayToPayCockpit(
  establishmentId: string | null,
  yearMonth: string // "YYYY-MM" — filtre strictement mensuel = invoice_date
) {
  // ✅ Cockpit utilise listPayInvoicesByMonth (filtre strict sur invoice_date).
  // La due_date (M+1 / fixed_day / delay) sert UNIQUEMENT aux badges urgence
  // et à la prochaine échéance — jamais au choix du mois d'affichage.
  const invoicesQuery = useQuery({
    queryKey:  ["pay_invoices_cockpit", establishmentId, yearMonth],
    enabled:   !!establishmentId,
    queryFn:   () => listPayInvoicesByMonth(establishmentId!, yearMonth),
    staleTime: 0,
  });

  const allocationsQuery = useQuery({
    queryKey:  ["pay_allocations_cockpit", establishmentId, yearMonth],
    enabled:   !!establishmentId,
    queryFn:   async () => {
      // Allocations strictement liées aux factures du mois (invoice_date)
      const invoices = await listPayInvoicesByMonth(establishmentId!, yearMonth);
      if (invoices.length === 0) return [];
      const invoiceIds = invoices.map((i) => i.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("pay_allocations")
        .select("*, pay_payments(voided_at)")
        .eq("establishment_id", establishmentId)
        .in("pay_invoice_id", invoiceIds);
      if (error) throw error;
      return ((data ?? []) as Array<import("../types").PayAllocation & { pay_payments: { voided_at: string | null } | null }>).map(
        (a) => ({ ...a, payment_voided_at: a.pay_payments?.voided_at ?? null })
      );
    },
    staleTime: 0,
  });

  const rulesQuery = useQuery({
    queryKey: ["pay_supplier_rules_all", establishmentId],
    enabled:  !!establishmentId,
    queryFn:  () => listAllSupplierRules(establishmentId!),
  });

  const scheduleQuery = useQuery({
    queryKey:  ["pay_schedule_items_all", establishmentId],
    enabled:   !!establishmentId,
    queryFn:   () => listScheduleItemsByEstablishment(establishmentId!),
    staleTime: 0,
  });

  return {
    invoices:      invoicesQuery.data    ?? [],
    allocations:   allocationsQuery.data ?? [],
    rules:         rulesQuery.data       ?? [],
    scheduleItems: scheduleQuery.data    ?? [],
    isLoading:     invoicesQuery.isLoading || allocationsQuery.isLoading,
    isError:       invoicesQuery.isError   || allocationsQuery.isError,
    refetch: () => {
      invoicesQuery.refetch();
      allocationsQuery.refetch();
      scheduleQuery.refetch();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Supplier Rules
// ─────────────────────────────────────────────────────────────────────────────

export function useSupplierRule(establishmentId: string | null, supplierId: string | null) {
  return useQuery({
    queryKey: ["pay_supplier_rule", establishmentId, supplierId],
    enabled:  !!establishmentId && !!supplierId,
    queryFn:  () => getSupplierRule(establishmentId!, supplierId!),
  });
}

export function useAllSupplierRules(establishmentId: string | null) {
  return useQuery({
    queryKey: ["pay_supplier_rules_all", establishmentId],
    enabled:  !!establishmentId,
    queryFn:  () => listAllSupplierRules(establishmentId!),
  });
}

export function useCreateOrUpdateSupplierRule(establishmentId: string, supplierId: string) {
  const queryClient = useQueryClient();
  const { user }    = useAuth();

  return useMutation({
    mutationFn: (params: {
      organization_id:      string;
      mode:                 SupplierRuleMode;
      delay_days?:          number | null;
      fixed_day_of_month?:  number | null;
      installment_count?:   number | null;
      installment_days?:    number[] | null;
      allow_partial?:       boolean;
      allocation_strategy?: AllocationStrategy;
      is_monthly_aggregate?: boolean;
    }) =>
      createOrUpdateSupplierRule({
        ...params,
        establishment_id: establishmentId,
        supplier_id:      supplierId,
        created_by:       user!.id,
        updated_by:       user!.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay_supplier_rule",     establishmentId, supplierId] });
      queryClient.invalidateQueries({ queryKey: ["pay_supplier_rules_all", establishmentId] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule Items (échéancier multi-dates)
// ─────────────────────────────────────────────────────────────────────────────

/** Toutes les dettes d'un fournisseur — pour le sélecteur d'échéancier dans la fiche fournisseur */
export function usePayInvoicesBySupplier(establishmentId: string | null, supplierId: string | null) {
  return useQuery({
    queryKey: ["pay_invoices_supplier", establishmentId, supplierId],
    enabled:  !!establishmentId && !!supplierId,
    queryFn:  () => listPayInvoicesBySupplier(establishmentId!, supplierId!),
  });
}

export function useScheduleItems(payInvoiceId: string | null) {
  return useQuery({
    queryKey: ["pay_schedule_items", payInvoiceId],
    enabled:  !!payInvoiceId,
    queryFn:  () => listScheduleItemsByInvoice(payInvoiceId!),
  });
}

export function useVoidScheduleItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, reason }: { itemId: string; reason: string }) =>
      voidScheduleItem(itemId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay_schedule_items"] });
      queryClient.invalidateQueries({ queryKey: ["pay_schedule_items_all"] });
    },
  });
}

export function useCreateScheduleItem(payInvoiceId: string) {
  const queryClient = useQueryClient();
  const { user }    = useAuth();
  return useMutation({
    mutationFn: (params: {
      organization_id:      string;
      establishment_id:     string;
      supplier_id:          string;
      due_date:             string;
      expected_amount_eur?: number | null;
      source:               "manuel" | "rule";
    }) =>
      createScheduleItem({ ...params, pay_invoice_id: payInvoiceId, created_by: user!.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay_schedule_items", payInvoiceId] });
      queryClient.invalidateQueries({ queryKey: ["pay_schedule_items_all"] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Crédit fournisseur
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne { payments, allocations, credit } pour un fournisseur.
 * Crédit = Σ paiements non-voidés − Σ allocations non-voidées.
 */
export function useSupplierCredit(establishmentId: string | null, supplierId: string | null) {
  return useQuery({
    queryKey: ["pay_supplier_credit", establishmentId, supplierId],
    enabled:  !!establishmentId && !!supplierId,
    queryFn:  async () => {
      const { payments, allocations } = await getSupplierCreditData(establishmentId!, supplierId!);
      const credit = computeSupplierCredit(payments, allocations);
      return { payments, allocations, credit };
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ensurePayInvoice (auto-create on invoice save)
// ─────────────────────────────────────────────────────────────────────────────

export function useEnsurePayInvoice(establishmentId: string, yearMonth: string) {
  const queryClient = useQueryClient();
  const { user }    = useAuth();

  return useMutation({
    mutationFn: (params: {
      source_invoice_id: string;
      organization_id:   string;
      supplier_id:       string;
      amount_eur:        number;
      invoice_date:      string;
      label?:            string | null;
    }) =>
      ensurePayInvoiceFromSourceInvoice({
        ...params,
        establishment_id: establishmentId,
        created_by:       user!.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay_invoices", establishmentId, yearMonth] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Backfill "Initialiser dettes"
// ─────────────────────────────────────────────────────────────────────────────

export function useBackfillPayInvoices(establishmentId: string, yearMonth: string) {
  const queryClient = useQueryClient();
  const { user }    = useAuth();

  return useMutation({
    mutationFn: ({ organizationId }: { organizationId: string }) =>
      backfillPayInvoicesFromInvoices({
        organization_id:  organizationId,
        establishment_id: establishmentId,
        created_by:       user!.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay_invoices",          establishmentId, yearMonth] });
      queryClient.invalidateQueries({ queryKey: ["pay_allocations_month", establishmentId, yearMonth] });
      queryClient.invalidateQueries({ queryKey: ["pay_invoices_cockpit",  establishmentId, yearMonth] });
      queryClient.invalidateQueries({ queryKey: ["pay_allocations_cockpit", establishmentId, yearMonth] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-sync : backfill silencieux au montage du cockpit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs backfill automatically once per (establishment, session).
 * Silent — no toast on success, no UI indicator.
 * Invalidates cockpit queries after sync so new invoices appear.
 */
export function useAutoSyncPayInvoices(
  establishmentId: string | null,
  organizationId: string | null,
  yearMonth: string
) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useQuery({
    queryKey: ["pay_auto_sync", establishmentId],
    enabled: !!establishmentId && !!organizationId && !!user,
    staleTime: 5 * 60_000, // re-sync at most every 5 min
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await backfillPayInvoicesFromInvoices({
        organization_id: organizationId!,
        establishment_id: establishmentId!,
        created_by: user!.id,
      });
      if (result.created > 0) {
        // New invoices were synced — invalidate cockpit data
        queryClient.invalidateQueries({ queryKey: ["pay_invoices_cockpit", establishmentId] });
        queryClient.invalidateQueries({ queryKey: ["pay_allocations_cockpit", establishmentId] });
        queryClient.invalidateQueries({ queryKey: ["pay_invoices", establishmentId] });
        queryClient.invalidateQueries({ queryKey: ["pay_allocations_month", establishmentId] });
        if (import.meta.env.DEV) {
          console.log(`[PayAutoSync] ${result.created} new invoices synced`);
        }
      }
      return result;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// pay_establishment_settings
// ─────────────────────────────────────────────────────────────────────────────

export function useEstablishmentSettings(establishmentId: string | null) {
  return useQuery({
    queryKey:  ["pay_estab_settings", establishmentId],
    enabled:   !!establishmentId,
    staleTime: 60_000,
    queryFn:   () => getEstablishmentSettings(establishmentId!),
  });
}

export function useUpsertEstablishmentSettings(establishmentId: string) {
  const queryClient = useQueryClient();
  const { user }    = useAuth();

  return useMutation({
    mutationFn: (params: { organization_id: string; auto_record_direct_debit: boolean }) =>
      upsertEstablishmentSettings({
        ...params,
        establishment_id: establishmentId,
        user_id:          user!.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay_estab_settings", establishmentId] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// usePayInvoicePdfLink — lien PDF depuis source_invoice_id
// ─────────────────────────────────────────────────────────────────────────────

export function usePayInvoicePdfLink(sourceInvoiceId: string | null) {
  return useQuery({
    queryKey:  ["source_invoice_pdf_meta", sourceInvoiceId],
    enabled:   !!sourceInvoiceId,
    staleTime: 5 * 60_000,
    queryFn:   async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("invoices")
        .select("id, invoice_number, file_path")
        .eq("id", sourceInvoiceId!)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; invoice_number: string | null; file_path: string } | null;
    },
  });
}

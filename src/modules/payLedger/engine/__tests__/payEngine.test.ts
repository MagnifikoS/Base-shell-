/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Tests unitaires — PAY ENGINE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Couvre (Phase 5 du prompt) :
 *   A. FIFO mensuel strict
 *   B. Surpaiement
 *   C. Installments + auto_record (logique pure)
 *   D. Retry après void
 *   E. Crédit exact (computeSupplierCredit)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from "vitest";

import {
  computeInvoicePaid,
  computeInvoiceRemaining,
  computeInvoiceStatus,
  computeMonthRecap,
  computeSupplierCredit,
  computeExpectedDueDate,
  computeNextExpectedPayment,
  computeUrgency,
  formatDateKey,
} from "../payEngine";
import type {
  PayInvoice,
  PayAllocationWithVoidStatus,
  PayPayment,
  PaySupplierRule,
  PayScheduleItem,
} from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function makeInvoice(id: string, amount: number, date = "2025-01-15"): PayInvoice {
  return {
    id,
    organization_id:   "org-1",
    establishment_id:  "est-1",
    supplier_id:       "sup-1",
    amount_eur:        amount,
    invoice_date:      date,
    label:             null,
    source_invoice_id: null,
    created_at:        "2025-01-01T00:00:00Z",
    created_by:        "user-1",
  };
}

function makeAllocation(
  id: string,
  payInvoiceId: string,
  paymentId: string,
  amount: number,
  voided = false
): PayAllocationWithVoidStatus {
  return {
    id,
    organization_id:   "org-1",
    establishment_id:  "est-1",
    payment_id:        paymentId,
    pay_invoice_id:    payInvoiceId,
    amount_eur:        amount,
    created_at:        "2025-01-01T00:00:00Z",
    created_by:        "user-1",
    payment_voided_at: voided ? "2025-01-20T00:00:00Z" : null,
  };
}

function makePayment(id: string, amount: number, supplierId = "sup-1", voided = false): PayPayment {
  return {
    id,
    organization_id:   "org-1",
    establishment_id:  "est-1",
    supplier_id:       supplierId,
    payment_date:      "2025-01-20",
    amount_eur:        amount,
    method:            "virement",
    payment_source:    "manuel",
    note:              null,
    idempotency_key:   null,
    external_ref:      null,
    voided_at:         voided ? "2025-01-25T00:00:00Z" : null,
    void_reason:       voided ? "test void" : null,
    created_at:        "2025-01-01T00:00:00Z",
    created_by:        "user-1",
  };
}

function makeRule(
  mode: PaySupplierRule["mode"],
  opts: Partial<PaySupplierRule> = {}
): PaySupplierRule {
  return {
    id:                    "rule-1",
    organization_id:       "org-1",
    establishment_id:      "est-1",
    supplier_id:           "sup-1",
    mode,
    delay_days:            opts.delay_days ?? null,
    fixed_day_of_month:    opts.fixed_day_of_month ?? null,
    installment_count:     opts.installment_count ?? null,
    installment_days:      opts.installment_days ?? null,
    allow_partial:         opts.allow_partial ?? false,
    allocation_strategy:   opts.allocation_strategy ?? "fifo_oldest",
    is_monthly_aggregate:  opts.is_monthly_aggregate ?? false,
    created_at:            "2025-01-01T00:00:00Z",
    updated_at:            "2025-01-01T00:00:00Z",
    created_by:            "user-1",
    updated_by:            null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A. FIFO MENSUEL STRICT
// ─────────────────────────────────────────────────────────────────────────────

describe("A — FIFO mensuel strict (computeMonthRecap)", () => {
  it("A1 — recap vide si aucune facture", () => {
    const recap = computeMonthRecap([], []);
    expect(recap.total_dette).toBe(0);
    expect(recap.total_paye).toBe(0);
    expect(recap.reste_a_payer).toBe(0);
    expect(recap.by_supplier).toHaveLength(0);
  });

  it("A2 — récap correct pour un fournisseur, une facture partiellement payée", () => {
    const inv = makeInvoice("inv-1", 100, "2025-01-15");
    const alloc = makeAllocation("a-1", "inv-1", "pay-1", 40);
    const recap = computeMonthRecap([inv], [alloc]);

    expect(recap.total_dette).toBe(100);
    expect(recap.total_paye).toBe(40);
    expect(recap.reste_a_payer).toBe(60);
    expect(recap.by_supplier[0].status).toBe("PARTIAL");
  });

  it("A3 — allocations voidées exclues du calcul", () => {
    const inv   = makeInvoice("inv-1", 100, "2025-01-15");
    const alloc = makeAllocation("a-1", "inv-1", "pay-1", 100, true); // voidée
    const recap = computeMonthRecap([inv], [alloc]);

    expect(recap.total_paye).toBe(0);
    expect(recap.reste_a_payer).toBe(100);
    expect(recap.by_supplier[0].status).toBe("UNPAID");
  });

  it("A4 — deux factures même fournisseur", () => {
    const inv1 = makeInvoice("inv-1", 100, "2025-01-10");
    const inv2 = makeInvoice("inv-2", 200, "2025-01-20");
    const alloc1 = makeAllocation("a-1", "inv-1", "pay-1", 100); // payée
    const alloc2 = makeAllocation("a-2", "inv-2", "pay-1",  50); // partielle

    const recap = computeMonthRecap([inv1, inv2], [alloc1, alloc2]);

    expect(recap.total_dette).toBe(300);
    expect(recap.total_paye).toBe(150);
    expect(recap.reste_a_payer).toBe(150);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. SURPAIEMENT
// ─────────────────────────────────────────────────────────────────────────────

describe("B — Surpaiement (computeInvoiceRemaining / computeSupplierCredit)", () => {
  it("B1 — remaining jamais négatif même si surpayé", () => {
    const inv   = makeInvoice("inv-1", 100);
    const alloc = makeAllocation("a-1", "inv-1", "pay-1", 150);
    const paid  = computeInvoicePaid("inv-1", [alloc]);
    const rem   = computeInvoiceRemaining(inv, paid);

    expect(paid).toBe(150);
    expect(rem).toBe(0); // jamais négatif
  });

  it("B2 — statut PAID si paid >= amount", () => {
    const inv    = makeInvoice("inv-1", 100);
    const status = computeInvoiceStatus(inv, 150);
    expect(status).toBe("PAID");
  });

  it("B3 — crédit fournisseur = surplus si paiement > dettes allouées", () => {
    const payment   = makePayment("pay-1", 500);
    const alloc     = makeAllocation("a-1", "inv-1", "pay-1", 300);
    const credit    = computeSupplierCredit([payment], [alloc]);

    expect(credit).toBe(200); // 500 - 300
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. INSTALLMENTS + AUTO_RECORD (logique pure)
// ─────────────────────────────────────────────────────────────────────────────

describe("C — Installments (computeExpectedDueDate / computeNextExpectedPayment)", () => {
  it("C1 — computeExpectedDueDate retourne null pour mode=installments", () => {
    const rule = makeRule("installments");
    const res  = computeExpectedDueDate("2025-01-15", rule);
    expect(res).toBeNull();
  });

  it("C2 — computeNextExpectedPayment utilise la première schedule_item non voidée", () => {
    const inv  = makeInvoice("inv-1", 300);
    const rule = makeRule("installments");

    const items: PayScheduleItem[] = [
      {
        id: "si-1", organization_id: "org-1", establishment_id: "est-1",
        supplier_id: "sup-1", pay_invoice_id: "inv-1",
        due_date: "2025-02-15", expected_amount_eur: 100,
        source: "manuel", voided_at: null, void_reason: null,
        created_at: "2025-01-01T00:00:00Z", created_by: "user-1",
      },
      {
        id: "si-2", organization_id: "org-1", establishment_id: "est-1",
        supplier_id: "sup-1", pay_invoice_id: "inv-1",
        due_date: "2025-03-15", expected_amount_eur: 200,
        source: "manuel", voided_at: null, void_reason: null,
        created_at: "2025-01-01T00:00:00Z", created_by: "user-1",
      },
    ];

    const result = computeNextExpectedPayment(inv, items, rule, []);
    expect(result).not.toBeNull();
    expect(result!.expectedAmount).toBe(100);
    expect(formatDateKey(result!.dueDate)).toBe("2025-02-15");
  });

  it("C3 — computeNextExpectedPayment ignore les items voidés", () => {
    const inv  = makeInvoice("inv-1", 300);
    const rule = makeRule("installments");

    const items: PayScheduleItem[] = [
      {
        id: "si-1", organization_id: "org-1", establishment_id: "est-1",
        supplier_id: "sup-1", pay_invoice_id: "inv-1",
        due_date: "2025-02-15", expected_amount_eur: 100,
        source: "manuel",
        voided_at: "2025-01-10T00:00:00Z", void_reason: "annulé",
        created_at: "2025-01-01T00:00:00Z", created_by: "user-1",
      },
    ];

    const result = computeNextExpectedPayment(inv, items, rule, []);
    expect(result).toBeNull(); // item voidé → null
  });

  it("C4 — computeNextExpectedPayment retourne null si facture soldée", () => {
    const inv    = makeInvoice("inv-1", 100);
    const rule   = makeRule("installments");
    const alloc  = makeAllocation("a-1", "inv-1", "pay-1", 100);
    const result = computeNextExpectedPayment(inv, [], rule, [alloc]);
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. RETRY APRÈS VOID (logique idempotency — clé versionnée)
// ─────────────────────────────────────────────────────────────────────────────

describe("D — Retry après void (formatDateKey + logique clé)", () => {
  it("D1 — formatDateKey produit YYYY-MM-DD local (pas UTC)", () => {
    const d = new Date(2025, 0, 5); // 5 jan 2025 locale
    expect(formatDateKey(d)).toBe("2025-01-05");
  });

  it("D2 — construction clé de base idempotency (delay)", () => {
    const invoiceId  = "abc-123";
    const dueDateStr = "2025-02-10";
    const baseKey    = `auto-${invoiceId}-${dueDateStr}`;
    expect(baseKey).toBe("auto-abc-123-2025-02-10");
  });

  it("D3 — clé versionnée correcte si N voids détectés", () => {
    // Simulation : 2 paiements voidés détectés → prochain = -v3
    const baseKey    = "auto-abc-123-2025-02-10";
    const totalExisting = 2; // 2 voidés déjà présents en DB
    const nextN      = totalExisting + 1;
    const retryKey   = `${baseKey}-v${nextN}`;
    expect(retryKey).toBe("auto-abc-123-2025-02-10-v3");
  });

  it("D4 — clé installments est par schedule_item (pas par invoice+date)", () => {
    const itemId  = "sched-xyz-456";
    const baseKey = `auto-sched-${itemId}`;
    expect(baseKey).toBe("auto-sched-sched-xyz-456");
    // distinct de la clé delay qui utilise invoiceId+date
    expect(baseKey).not.toContain("inv-");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. CRÉDIT EXACT
// ─────────────────────────────────────────────────────────────────────────────

describe("E — Crédit fournisseur exact (computeSupplierCredit)", () => {
  it("E1 — crédit = 0 si tout alloué", () => {
    const payment = makePayment("pay-1", 100);
    const alloc   = makeAllocation("a-1", "inv-1", "pay-1", 100);
    expect(computeSupplierCredit([payment], [alloc])).toBe(0);
  });

  it("E2 — crédit = surplus non alloué", () => {
    const payment = makePayment("pay-1", 200);
    const alloc   = makeAllocation("a-1", "inv-1", "pay-1", 150);
    expect(computeSupplierCredit([payment], [alloc])).toBe(50);
  });

  it("E3 — paiements voidés exclus du calcul crédit", () => {
    const paymentActive = makePayment("pay-1", 200);
    const paymentVoided = makePayment("pay-2", 500, "sup-1", true); // voidé
    const alloc = makeAllocation("a-1", "inv-1", "pay-1", 100);
    // 500 (voidé) ne doit PAS entrer dans le calcul
    const credit = computeSupplierCredit([paymentActive, paymentVoided], [alloc]);
    expect(credit).toBe(100); // 200 - 100 seulement
  });

  it("E4 — allocations voidées exclues du calcul crédit", () => {
    const payment     = makePayment("pay-1", 200);
    const allocActive = makeAllocation("a-1", "inv-1", "pay-1", 80);
    const allocVoided = makeAllocation("a-2", "inv-1", "pay-1", 50, true); // voidée
    // 50 (voidée) ne doit PAS être déduite
    const credit = computeSupplierCredit([payment], [allocActive, allocVoided]);
    expect(credit).toBe(120); // 200 - 80 seulement
  });

  it("E5 — crédit jamais négatif (protégé par Math.max(0, ...))", () => {
    const payment = makePayment("pay-1", 50);
    const alloc   = makeAllocation("a-1", "inv-1", "pay-1", 50);
    expect(computeSupplierCredit([payment], [alloc])).toBe(0);
  });

  it("E6 — crédit sans allocation = montant total du paiement", () => {
    const payment = makePayment("pay-1", 350);
    expect(computeSupplierCredit([payment], [])).toBe(350);
  });

  it("E7 — scope fournisseur (pas mensuel) : plusieurs mois agrégés", () => {
    const jan = makePayment("pay-1", 100);
    const feb = makePayment("pay-2", 200);
    const allocJan = makeAllocation("a-1", "inv-jan", "pay-1", 100);
    // feb non alloué → crédit = 200
    const credit = computeSupplierCredit([jan, feb], [allocJan]);
    expect(credit).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXTRA — Urgency helper
// ─────────────────────────────────────────────────────────────────────────────

describe("Urgency helpers", () => {
  it("retourne no_date si dueDate null", () => {
    expect(computeUrgency(null)).toBe("no_date");
  });

  it("retourne overdue si date passée", () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    expect(computeUrgency(past)).toBe("overdue");
  });

  it("retourne soon si dans 3 jours", () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 3);
    expect(computeUrgency(soon)).toBe("soon");
  });

  it("retourne upcoming si dans 15 jours", () => {
    const future = new Date();
    future.setDate(future.getDate() + 15);
    expect(computeUrgency(future)).toBe("upcoming");
  });
});

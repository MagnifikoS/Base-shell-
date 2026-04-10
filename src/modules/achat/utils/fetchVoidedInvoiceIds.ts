/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UTIL — Fetch voided invoice IDs from brain_events (SSOT unique)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Shared by usePriceEvolutionEvents and useProductPriceHistory.
 * Returns a Set<string> of invoice IDs that have been voided.
 */

import { BRAIN_SUBJECTS, BRAIN_ACTIONS, brainDb } from "@/modules/theBrain";

export async function fetchVoidedInvoiceIds(establishmentId: string): Promise<Set<string>> {
  try {
    const { data, error } = await brainDb
      .from("brain_events")
      .select("context")
      .eq("establishment_id", establishmentId)
      .eq("subject", BRAIN_SUBJECTS.INVOICE_LIFECYCLE)
      .eq("action", BRAIN_ACTIONS.VOIDED);

    if (error || !data) {
      if (import.meta.env.DEV)
        console.warn("[fetchVoidedInvoiceIds] Failed to fetch voided invoices:", error);
      return new Set();
    }

    const voidedIds = new Set<string>();
    for (const event of data) {
      const invoiceId = event.context?.invoice_id;
      if (typeof invoiceId === "string" && invoiceId) {
        voidedIds.add(invoiceId);
      }
    }

    return voidedIds;
  } catch {
    if (import.meta.env.DEV)
      console.warn("[fetchVoidedInvoiceIds] Exception fetching voided invoices");
    return new Set();
  }
}

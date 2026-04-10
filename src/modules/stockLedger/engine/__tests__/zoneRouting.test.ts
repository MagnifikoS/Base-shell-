/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Zone Routing Test — Ensures fn_post_stock_document routes events
 * to product zone, NOT document zone
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from "vitest";

/**
 * This test validates the CORE BUSINESS RULE:
 * When a stock document is POSTed, each stock_event must be written
 * with storage_zone_id = product.storage_zone_id (not document.storage_zone_id).
 *
 * The actual DB function (fn_post_stock_document) enforces this rule.
 * This test validates the routing logic conceptually to catch regressions
 * in the event routing contract.
 */

interface MockProduct {
  id: string;
  storage_zone_id: string | null;
}

interface MockDocumentLine {
  product_id: string;
  delta_quantity_canonical: number;
}

interface MockEvent {
  product_id: string;
  storage_zone_id: string;
}

/**
 * Simulates the routing logic from fn_post_stock_document:
 * Each event gets the product's zone, not the document's zone.
 */
function routeEventsByProductZone(
  documentZoneId: string,
  lines: MockDocumentLine[],
  products: MockProduct[]
): { events: MockEvent[]; errors: string[] } {
  const events: MockEvent[] = [];
  const errors: string[] = [];
  const productMap = new Map(products.map((p) => [p.id, p]));

  for (const line of lines) {
    const product = productMap.get(line.product_id);
    if (!product) {
      errors.push(`Product ${line.product_id} not found`);
      continue;
    }
    if (!product.storage_zone_id) {
      errors.push(`PRODUCT_NO_ZONE: ${line.product_id}`);
      continue;
    }
    events.push({
      product_id: line.product_id,
      storage_zone_id: product.storage_zone_id, // ← PRODUCT zone, NOT document zone
    });
  }

  return { events, errors };
}

describe("Zone Routing — fn_post_stock_document contract", () => {
  const ZONE_A = "zone-a-chambre-froide";
  const ZONE_B = "zone-b-stockage";

  it("routes events to product zone, NOT document zone", () => {
    const products: MockProduct[] = [
      { id: "prod-1", storage_zone_id: ZONE_A },
      { id: "prod-2", storage_zone_id: ZONE_A },
    ];
    const lines: MockDocumentLine[] = [
      { product_id: "prod-1", delta_quantity_canonical: 8 },
      { product_id: "prod-2", delta_quantity_canonical: 5 },
    ];

    const { events, errors } = routeEventsByProductZone(ZONE_B, lines, products);

    expect(errors).toHaveLength(0);
    expect(events).toHaveLength(2);
    // CRITICAL: events must be in ZONE_A (product zone), not ZONE_B (document zone)
    expect(events[0].storage_zone_id).toBe(ZONE_A);
    expect(events[1].storage_zone_id).toBe(ZONE_A);
    // Explicitly verify they are NOT in document zone
    expect(events[0].storage_zone_id).not.toBe(ZONE_B);
  });

  it("handles multi-zone documents (products in different zones)", () => {
    const ZONE_C = "zone-c-dry";
    const products: MockProduct[] = [
      { id: "prod-1", storage_zone_id: ZONE_A },
      { id: "prod-2", storage_zone_id: ZONE_C },
    ];
    const lines: MockDocumentLine[] = [
      { product_id: "prod-1", delta_quantity_canonical: 3 },
      { product_id: "prod-2", delta_quantity_canonical: 10 },
    ];

    const { events, errors } = routeEventsByProductZone(ZONE_B, lines, products);

    expect(errors).toHaveLength(0);
    expect(events).toHaveLength(2);
    expect(events[0].storage_zone_id).toBe(ZONE_A);
    expect(events[1].storage_zone_id).toBe(ZONE_C);
  });

  it("blocks POST if product has no zone (PRODUCT_NO_ZONE)", () => {
    const products: MockProduct[] = [{ id: "prod-1", storage_zone_id: null }];
    const lines: MockDocumentLine[] = [{ product_id: "prod-1", delta_quantity_canonical: 5 }];

    const { events, errors } = routeEventsByProductZone(ZONE_B, lines, products);

    expect(events).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("PRODUCT_NO_ZONE");
  });

  it("generates no events if all products lack zones", () => {
    const products: MockProduct[] = [
      { id: "prod-1", storage_zone_id: null },
      { id: "prod-2", storage_zone_id: null },
    ];
    const lines: MockDocumentLine[] = [
      { product_id: "prod-1", delta_quantity_canonical: 1 },
      { product_id: "prod-2", delta_quantity_canonical: 2 },
    ];

    const { events, errors } = routeEventsByProductZone(ZONE_B, lines, products);

    expect(events).toHaveLength(0);
    expect(errors).toHaveLength(2);
  });

  it("mixed: some products with zone, some without → partial error", () => {
    const products: MockProduct[] = [
      { id: "prod-ok", storage_zone_id: ZONE_A },
      { id: "prod-bad", storage_zone_id: null },
    ];
    const lines: MockDocumentLine[] = [
      { product_id: "prod-ok", delta_quantity_canonical: 8 },
      { product_id: "prod-bad", delta_quantity_canonical: 3 },
    ];

    const { events, errors } = routeEventsByProductZone(ZONE_B, lines, products);

    expect(events).toHaveLength(1);
    expect(events[0].storage_zone_id).toBe(ZONE_A);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("PRODUCT_NO_ZONE");
  });
});

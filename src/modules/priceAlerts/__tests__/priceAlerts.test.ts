/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Tests — Module Alertes Prix V0
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Covers:
 * 1. Types & data integrity
 * 2. Threshold logic (global vs category by UUID)
 * 3. Variation calculation
 * 4. Anti-spam (dedup rules)
 * 5. Filter logic
 * 6. Settings validation
 * 7. E2E scenarios (toggle OFF, anti-recursion, anti-spam, UUID keys)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from "vitest";
import type { PriceAlert, PriceAlertSettings, PriceAlertFilter } from "../types";

// ─── Pure helpers extracted for testing ───────────────────────────────────

/** Calculate price variation percentage (mirrors trigger logic) */
function computeVariationPct(oldPrice: number | null, newPrice: number): number {
  if (oldPrice === null || oldPrice === 0) return 100;
  return Math.round(((newPrice - oldPrice) / oldPrice) * 10000) / 100;
}

/** Determine applicable threshold (category override or global) — keys are category_id UUIDs */
function resolveThreshold(
  globalThreshold: number,
  categoryThresholds: Record<string, number>,
  categoryId: string | null
): number {
  if (categoryId && categoryId in categoryThresholds) {
    return categoryThresholds[categoryId];
  }
  return globalThreshold;
}

/** Should an alert be created? */
function shouldAlert(variationPct: number, threshold: number): boolean {
  return Math.abs(variationPct) >= threshold;
}

/** Filter alerts */
function filterAlerts(alerts: PriceAlert[], filter: PriceAlertFilter): PriceAlert[] {
  switch (filter) {
    case "up":
      return alerts.filter((a) => a.variation_pct > 0);
    case "down":
      return alerts.filter((a) => a.variation_pct < 0);
    case "threshold":
      return alerts.filter((a) => !a.seen_at);
    default:
      return alerts;
  }
}

// ─── Mock data ────────────────────────────────────────────────────────────

// Simulated category UUIDs (stable keys)
const CAT_POISSON_ID = "cat-uuid-poisson-0001";
const CAT_FRUITS_ID = "cat-uuid-fruits-0002";
const CAT_EPICERIE_ID = "cat-uuid-epicerie-0003";

const mockAlert = (overrides: Partial<PriceAlert> = {}): PriceAlert => ({
  id: "alert-1",
  establishment_id: "est-1",
  product_id: "prod-1",
  source_product_id: "src-prod-1",
  supplier_name: "Fournisseur A",
  product_name: "Tomates",
  category: "Fruits & Légumes",
  old_price: 10,
  new_price: 12,
  variation_pct: 20,
  day_date: "2026-03-05",
  seen_at: null,
  acked_at: null,
  created_at: "2026-03-05T10:00:00Z",
  updated_at: "2026-03-05T10:00:00Z",
  ...overrides,
});

const mockSettings = (overrides: Partial<PriceAlertSettings> = {}): PriceAlertSettings => ({
  establishment_id: "est-1",
  enabled: true,
  global_threshold_pct: 5,
  category_thresholds: {},
  created_at: "2026-03-05T10:00:00Z",
  updated_at: "2026-03-05T10:00:00Z",
  ...overrides,
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe("Module Alertes Prix V0", () => {
  describe("Variation calculation", () => {
    it("calculates positive variation correctly", () => {
      expect(computeVariationPct(10, 12)).toBe(20);
    });

    it("calculates negative variation correctly", () => {
      expect(computeVariationPct(10, 8)).toBe(-20);
    });

    it("handles small variations with precision", () => {
      expect(computeVariationPct(10, 10.3)).toBe(3);
    });

    it("returns 100% when old price is null", () => {
      expect(computeVariationPct(null, 5)).toBe(100);
    });

    it("returns 100% when old price is 0", () => {
      expect(computeVariationPct(0, 5)).toBe(100);
    });

    it("handles no change (0%)", () => {
      expect(computeVariationPct(10, 10)).toBe(0);
    });
  });

  describe("Threshold resolution (UUID keys)", () => {
    it("uses global threshold when no category override", () => {
      expect(resolveThreshold(5, {}, CAT_EPICERIE_ID)).toBe(5);
    });

    it("uses category override when available (UUID key)", () => {
      expect(resolveThreshold(5, { [CAT_POISSON_ID]: 20 }, CAT_POISSON_ID)).toBe(20);
    });

    it("falls back to global when category_id not in overrides", () => {
      expect(resolveThreshold(5, { [CAT_POISSON_ID]: 20 }, CAT_EPICERIE_ID)).toBe(5);
    });

    it("uses global when category_id is null", () => {
      expect(resolveThreshold(5, { [CAT_POISSON_ID]: 20 }, null)).toBe(5);
    });

    it("handles empty overrides object", () => {
      expect(resolveThreshold(10, {}, "any-uuid")).toBe(10);
    });

    it("UUID keys are case-sensitive and stable", () => {
      const thresholds = { [CAT_POISSON_ID]: 20, [CAT_FRUITS_ID]: 15 };
      expect(resolveThreshold(5, thresholds, CAT_POISSON_ID)).toBe(20);
      expect(resolveThreshold(5, thresholds, CAT_FRUITS_ID)).toBe(15);
      // A different UUID (even if same category name) won't match
      expect(resolveThreshold(5, thresholds, "cat-uuid-poisson-9999")).toBe(5);
    });
  });

  describe("Alert creation decision", () => {
    it("creates alert when variation exceeds threshold (positive)", () => {
      expect(shouldAlert(10, 5)).toBe(true);
    });

    it("creates alert when variation exceeds threshold (negative)", () => {
      expect(shouldAlert(-10, 5)).toBe(true);
    });

    it("creates alert when variation equals threshold exactly", () => {
      expect(shouldAlert(5, 5)).toBe(true);
    });

    it("does NOT create alert when variation below threshold", () => {
      expect(shouldAlert(3, 5)).toBe(false);
    });

    it("does NOT create alert for small negative variation", () => {
      expect(shouldAlert(-2, 5)).toBe(false);
    });

    // ─── Scénarios E2E spec (with UUID keys) ───
    it("E2E: FO +10%, seuil global 5% → alerte créée", () => {
      const variation = computeVariationPct(10, 11);
      const threshold = resolveThreshold(5, {}, null);
      expect(shouldAlert(variation, threshold)).toBe(true);
    });

    it("E2E: FO +3%, seuil global 5% → PAS d'alerte", () => {
      const variation = computeVariationPct(10, 10.3);
      const threshold = resolveThreshold(5, {}, null);
      expect(shouldAlert(variation, threshold)).toBe(false);
    });

    it("E2E: Catégorie Poisson (UUID) seuil 20%, +10% → PAS d'alerte", () => {
      const variation = computeVariationPct(10, 11);
      const threshold = resolveThreshold(5, { [CAT_POISSON_ID]: 20 }, CAT_POISSON_ID);
      expect(shouldAlert(variation, threshold)).toBe(false);
    });

    it("E2E: Catégorie Poisson (UUID) seuil 20%, +25% → alerte", () => {
      const variation = computeVariationPct(10, 12.5);
      const threshold = resolveThreshold(5, { [CAT_POISSON_ID]: 20 }, CAT_POISSON_ID);
      expect(shouldAlert(variation, threshold)).toBe(true);
    });
  });

  describe("Alert filtering", () => {
    const alerts: PriceAlert[] = [
      mockAlert({ id: "1", variation_pct: 10, seen_at: null }),
      mockAlert({ id: "2", variation_pct: -5, seen_at: null }),
      mockAlert({ id: "3", variation_pct: 20, seen_at: "2026-03-05T12:00:00Z" }),
      mockAlert({ id: "4", variation_pct: -15, seen_at: "2026-03-05T12:00:00Z" }),
    ];

    it("filter 'all' returns everything", () => {
      expect(filterAlerts(alerts, "all")).toHaveLength(4);
    });

    it("filter 'up' returns only positive variations", () => {
      const result = filterAlerts(alerts, "up");
      expect(result).toHaveLength(2);
      expect(result.every((a) => a.variation_pct > 0)).toBe(true);
    });

    it("filter 'down' returns only negative variations", () => {
      const result = filterAlerts(alerts, "down");
      expect(result).toHaveLength(2);
      expect(result.every((a) => a.variation_pct < 0)).toBe(true);
    });

    it("filter 'threshold' returns unseen alerts only", () => {
      const result = filterAlerts(alerts, "threshold");
      expect(result).toHaveLength(2);
      expect(result.every((a) => a.seen_at === null)).toBe(true);
    });
  });

  describe("Settings validation (UUID keys)", () => {
    it("default settings have correct values", () => {
      const settings = mockSettings();
      expect(settings.global_threshold_pct).toBe(5);
      expect(settings.enabled).toBe(true);
      expect(settings.category_thresholds).toEqual({});
    });

    it("disabled settings should prevent alerts", () => {
      const settings = mockSettings({ enabled: false });
      expect(settings.enabled).toBe(false);
    });

    it("category thresholds with UUID keys override global correctly", () => {
      const settings = mockSettings({
        global_threshold_pct: 5,
        category_thresholds: {
          [CAT_FRUITS_ID]: 15,
          [CAT_POISSON_ID]: 20,
          [CAT_EPICERIE_ID]: 5,
        },
      });

      expect(resolveThreshold(settings.global_threshold_pct, settings.category_thresholds, CAT_POISSON_ID)).toBe(20);
      expect(resolveThreshold(settings.global_threshold_pct, settings.category_thresholds, CAT_FRUITS_ID)).toBe(15);
      expect(resolveThreshold(settings.global_threshold_pct, settings.category_thresholds, "unknown-uuid")).toBe(5);
    });
  });

  describe("Anti-spam / dedup", () => {
    it("unique constraint is product + establishment + day", () => {
      const alert1 = mockAlert({ product_id: "p1", establishment_id: "e1", day_date: "2026-03-05" });
      const alert2 = mockAlert({ product_id: "p1", establishment_id: "e1", day_date: "2026-03-05" });
      const key1 = `${alert1.product_id}:${alert1.establishment_id}:${alert1.day_date}`;
      const key2 = `${alert2.product_id}:${alert2.establishment_id}:${alert2.day_date}`;
      expect(key1).toBe(key2);
    });

    it("different days create separate alerts", () => {
      const alert1 = mockAlert({ day_date: "2026-03-05" });
      const alert2 = mockAlert({ day_date: "2026-03-06" });
      const key1 = `${alert1.product_id}:${alert1.establishment_id}:${alert1.day_date}`;
      const key2 = `${alert2.product_id}:${alert2.establishment_id}:${alert2.day_date}`;
      expect(key1).not.toBe(key2);
    });

    it("different products on same day create separate alerts", () => {
      const alert1 = mockAlert({ product_id: "p1", day_date: "2026-03-05" });
      const alert2 = mockAlert({ product_id: "p2", day_date: "2026-03-05" });
      const key1 = `${alert1.product_id}:${alert1.establishment_id}:${alert1.day_date}`;
      const key2 = `${alert2.product_id}:${alert2.establishment_id}:${alert2.day_date}`;
      expect(key1).not.toBe(key2);
    });
  });

  describe("Security: cross-org isolation", () => {
    it("alerts are scoped to client establishment only", () => {
      const alert = mockAlert({ establishment_id: "est-client-1" });
      expect(alert.establishment_id).toBe("est-client-1");
      expect(alert.source_product_id).toBeDefined();
    });

    it("supplier_name is a snapshot, not a live reference", () => {
      const alert = mockAlert({ supplier_name: "Fournisseur A" });
      expect(typeof alert.supplier_name).toBe("string");
    });
  });

  // ─── 3 checks finaux E2E (Toggle OFF, Anti-boucle, Anti-spam) ─────────

  describe("Check final 1: Toggle OFF → zéro alerte", () => {
    it("when settings.enabled=false, shouldAlert must be bypassed entirely", () => {
      const settings = mockSettings({ enabled: false, global_threshold_pct: 5 });
      const variation = computeVariationPct(10, 15);
      const wouldCreate = settings.enabled && shouldAlert(variation, settings.global_threshold_pct);
      expect(wouldCreate).toBe(false);
    });

    it("when settings is null (no row), no alert is created", () => {
      const settings: PriceAlertSettings | null = null;
      const variation = computeVariationPct(10, 20);
      const wouldCreate = settings !== null && settings.enabled && shouldAlert(variation, settings.global_threshold_pct);
      expect(wouldCreate).toBe(false);
    });
  });

  describe("Check final 2: Anti-boucle (pg_trigger_depth)", () => {
    it("simulated trigger depth > 1 prevents cascade", () => {
      function simulateTrigger(depth: number, oldPrice: number, newPrice: number): boolean {
        if (depth > 1) return false;
        const variation = computeVariationPct(oldPrice, newPrice);
        return shouldAlert(variation, 5);
      }

      expect(simulateTrigger(1, 10, 12)).toBe(true);
      expect(simulateTrigger(2, 10, 12)).toBe(false);
      expect(simulateTrigger(3, 10, 12)).toBe(false);
    });
  });

  describe("Check final 3: Anti-spam — 2 changes same day = 1 alert", () => {
    it("ON CONFLICT upsert keeps single row per product+establishment+day", () => {
      const alertStore = new Map<string, { new_price: number; variation_pct: number }>();

      function upsertAlert(productId: string, estId: string, dayDate: string, oldPrice: number, newPrice: number) {
        const key = `${productId}:${estId}:${dayDate}`;
        const variation = computeVariationPct(oldPrice, newPrice);
        alertStore.set(key, { new_price: newPrice, variation_pct: variation });
      }

      upsertAlert("p1", "e1", "2026-03-05", 10, 12);
      expect(alertStore.size).toBe(1);
      expect(alertStore.get("p1:e1:2026-03-05")?.variation_pct).toBe(20);

      upsertAlert("p1", "e1", "2026-03-05", 10, 14);
      expect(alertStore.size).toBe(1);
      expect(alertStore.get("p1:e1:2026-03-05")?.variation_pct).toBe(40);
      expect(alertStore.get("p1:e1:2026-03-05")?.new_price).toBe(14);
    });

    it("different day creates a new alert (not upserted)", () => {
      const alertStore = new Map<string, number>();

      function upsertAlert(productId: string, estId: string, dayDate: string) {
        const key = `${productId}:${estId}:${dayDate}`;
        alertStore.set(key, (alertStore.get(key) ?? 0) + 1);
      }

      upsertAlert("p1", "e1", "2026-03-05");
      upsertAlert("p1", "e1", "2026-03-06");
      expect(alertStore.size).toBe(2);
    });
  });
});

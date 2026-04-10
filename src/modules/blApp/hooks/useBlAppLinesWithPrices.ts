/**
 * Hook: fetch BL-APP lines with FROZEN prices from bl_app_lines.unit_price / line_total (snapshots).
 * Prices are frozen at BL creation time — NEVER recalculated from products_v2.final_unit_price.
 *
 * ═══ BILLING UNIT PROJECTION (V2) ═══
 * For document display, quantities and prices are projected into the supplier billing unit
 * (supplier_billing_unit_id) when it differs from the canonical unit.
 * This is a DISPLAY-ONLY reconversion — stored data remains in canonical units.
 *
 * Canonical fields (quantity, unit_label, unit_price_value) are preserved for internal use
 * (corrections, void operations). Billing fields (billing_*) are used for document rendering.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { findConversionPath } from "@/modules/conditionnementV2";
import type { PackagingLevel, Equivalence } from "@/modules/conditionnementV2";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";

export interface EnrichedBlAppLine {
  id: string;
  product_id: string;
  product_name: string;
  /** Canonical quantity (stock unit) — used for corrections / void */
  quantity: number;
  /** Canonical unit label — used for corrections / void */
  unit_label: string;
  canonical_unit_id: string;
  /** Canonical unit price (stock unit) */
  unit_price_value: number | null;
  unit_price_display: string; // "7.60 €/kg" or "—"
  line_total_value: number | null;
  line_total_display: string; // "190.00 €" or "—"

  // ─── Billing unit projection (document display) ───────────────
  /** Quantity projected in billing unit (= canonical if billing = canonical) */
  billing_quantity: number;
  /** Billing unit label (e.g. "bte", "car") */
  billing_unit_label: string;
  /** Unit price in billing unit */
  billing_unit_price_value: number | null;
  billing_unit_price_display: string;
  /** Line total (invariant — same as line_total_value) */
  billing_line_total_display: string;
  /** True if billing projection differs from canonical */
  has_billing_projection: boolean;
  /** Non-null if projection failed — indicates a data/config integrity error */
  projection_error: string | null;
}

export interface BlAppLinesWithPricesResult {
  lines: EnrichedBlAppLine[];
  document_total_value: number | null;
  document_total_display: string;
}

export function useBlAppLinesWithPrices(blAppDocumentId: string | null) {
  return useQuery<BlAppLinesWithPricesResult>({
    queryKey: ["bl-app-lines-with-prices", blAppDocumentId],
    queryFn: async () => {
      if (!blAppDocumentId)
        return { lines: [], document_total_value: null, document_total_display: "—" };

      // 1. Fetch lines WITH frozen price snapshots
      const { data: rawLines, error: linesErr } = await supabase
        .from("bl_app_lines")
        .select("id, bl_app_document_id, product_id, quantity_canonical, canonical_unit_id, unit_price, line_total, product_name_snapshot, establishment_id")
        .eq("bl_app_document_id", blAppDocumentId);
      if (linesErr) throw linesErr;
      const lines = rawLines ?? [];

      if (lines.length === 0) {
        return { lines: [], document_total_value: null, document_total_display: "—" };
      }

      const establishmentId = lines[0].establishment_id;

      // 2. Fetch product data: names + billing unit config
      const productIds = [...new Set(lines.map((l) => l.product_id))];
      const { data: products, error: prodErr } = await supabase
        .from("products_v2")
        .select("id, nom_produit, supplier_billing_unit_id, conditionnement_config")
        .in("id", productIds);
      if (prodErr) throw prodErr;

      const productMap = new Map(
        (products ?? []).map((p) => {
          const config = p.conditionnement_config as {
            packagingLevels?: PackagingLevel[];
            equivalence?: Equivalence | null;
            priceLevel?: { billed_unit_id?: string | null } | null;
          } | null;

          // SSOT: priceLevel.billed_unit_id (wizard-defined), fallback to denormalized column
          const billingUnitId =
            (config?.priceLevel?.billed_unit_id as string | null)
            ?? (p.supplier_billing_unit_id as string | null);

          return [
            p.id,
            {
              name: p.nom_produit as string,
              billingUnitId,
              config,
            },
          ] as const;
        })
      );

      // 3. Collect all unit IDs we need labels for (canonical + billing)
      const allUnitIds = new Set<string>();
      for (const line of lines) {
        allUnitIds.add(line.canonical_unit_id);
      }
      for (const [, pd] of productMap) {
        if (pd.billingUnitId) allUnitIds.add(pd.billingUnitId);
      }

      // 4. Fetch units + BFS conversions in parallel
      const [{ data: unitsRaw, error: unitErr }, { data: convsRaw }] = await Promise.all([
        supabase
          .from("measurement_units")
          .select("id, name, abbreviation, category, family, is_reference, aliases")
          .eq("establishment_id", establishmentId),
        supabase
          .from("unit_conversions")
          .select("from_unit_id, to_unit_id, factor, is_active")
          .eq("establishment_id", establishmentId)
          .eq("is_active", true),
      ]);
      if (unitErr) throw unitErr;

      const unitMap = new Map((unitsRaw ?? []).map((u) => [u.id, u.abbreviation]));

      const dbUnits: UnitWithFamily[] = (unitsRaw ?? []).map((u) => ({
        id: u.id,
        name: u.name,
        abbreviation: u.abbreviation,
        category: u.category ?? "",
        family: u.family ?? null,
        is_reference: u.is_reference,
        aliases: u.aliases ?? [],
      }));

      const dbConversions: ConversionRule[] = (convsRaw ?? []).map((c) => ({
        id: "",
        establishment_id: establishmentId,
        from_unit_id: c.from_unit_id,
        to_unit_id: c.to_unit_id,
        factor: c.factor,
        is_active: c.is_active,
      }));

      // 5. Build enriched lines with billing unit projection
      let totalSum = 0;
      let hasAnyTotal = false;

      const enriched: EnrichedBlAppLine[] = lines.map((line) => {
        const pd = productMap.get(line.product_id);
        const productName =
          (line as Record<string, unknown>).product_name_snapshot as string | null
            ?? pd?.name
            ?? line.product_id;
        const canonicalUnitLabel = unitMap.get(line.canonical_unit_id) ?? "—";
        const unitPrice: number | null = line.unit_price ?? null;
        const lineTotalValue: number | null = line.line_total ?? null;

        if (lineTotalValue !== null) {
          totalSum += lineTotalValue;
          hasAnyTotal = true;
        }

        const unitPriceDisplay =
          unitPrice !== null
            ? `${unitPrice.toFixed(2)} €/${canonicalUnitLabel}`
            : "—";

        const lineTotalDisplay = lineTotalValue !== null ? `${lineTotalValue.toFixed(2)} €` : "—";

        // ─── Billing unit projection ───────────────────────────
        // A valid product ALWAYS has a billing unit. If missing, it's a data integrity error.
        const billingUnitId = pd?.billingUnitId ?? null;
        const needsProjection =
          billingUnitId !== null && billingUnitId !== line.canonical_unit_id;

        let billingQuantity = line.quantity_canonical;
        let billingUnitLabel = canonicalUnitLabel;
        let billingUnitPriceValue: number | null = unitPrice;
        let billingUnitPriceDisplay = unitPriceDisplay;
        let billingLineTotalDisplay = lineTotalDisplay;
        let projectionApplied = false;
        let projectionError: string | null = null;

        if (billingUnitId === null) {
          // Produit sans unité de facturation → erreur d'intégrité données
          projectionError = "Unité de facturation absente — produit invalide";
        } else if (needsProjection) {
          if (unitPrice === null) {
            projectionError = "Prix unitaire absent — projection impossible";
          } else {
            const packagingLevels: PackagingLevel[] = pd?.config?.packagingLevels ?? [];
            const equivalence: Equivalence | null = pd?.config?.equivalence ?? null;

            const path = findConversionPath(
              line.canonical_unit_id,
              billingUnitId,
              dbUnits,
              dbConversions,
              packagingLevels,
              equivalence
            );

            if (path.reached && path.factor !== null && path.factor !== 0) {
              billingQuantity = Math.round(line.quantity_canonical * path.factor * 10000) / 10000;
              billingUnitLabel = unitMap.get(billingUnitId) ?? "—";
              billingUnitPriceValue = unitPrice / path.factor;
              billingUnitPriceDisplay = `${billingUnitPriceValue.toFixed(2)} €/${billingUnitLabel}`;
              const billingTotal = lineTotalValue ?? Math.round(billingQuantity * billingUnitPriceValue * 100) / 100;
              billingLineTotalDisplay = `${billingTotal.toFixed(2)} €`;
              projectionApplied = true;
            } else {
              // BFS failed on a valid product → this is a config error, NOT a fallback case
              projectionError = `Conversion BFS impossible (${canonicalUnitLabel} → ${unitMap.get(billingUnitId) ?? billingUnitId})`;
            }
          }
        } else {
          // billing = canonical → no projection needed, already correct
          billingUnitLabel = unitMap.get(billingUnitId ?? line.canonical_unit_id) ?? canonicalUnitLabel;
        }

        return {
          id: line.id,
          product_id: line.product_id,
          product_name: productName,
          quantity: line.quantity_canonical,
          unit_label: canonicalUnitLabel,
          canonical_unit_id: line.canonical_unit_id,
          unit_price_value: unitPrice,
          unit_price_display: unitPriceDisplay,
          line_total_value: lineTotalValue,
          line_total_display: lineTotalDisplay,
          // Billing projection
          billing_quantity: billingQuantity,
          billing_unit_label: billingUnitLabel,
          billing_unit_price_value: billingUnitPriceValue,
          billing_unit_price_display: billingUnitPriceDisplay,
          billing_line_total_display: billingLineTotalDisplay,
          has_billing_projection: projectionApplied,
          projection_error: projectionError,
        };
      });

      const documentTotalValue = hasAnyTotal ? Math.round(totalSum * 100) / 100 : null;
      const documentTotalDisplay =
        documentTotalValue !== null ? `${documentTotalValue.toFixed(2)} €` : "—";

      return {
        lines: enriched,
        document_total_value: documentTotalValue,
        document_total_display: documentTotalDisplay,
      };
    },
    enabled: !!blAppDocumentId,
  });
}

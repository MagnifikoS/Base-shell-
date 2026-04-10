/**
 * Backfill Edge Function — Populates unit_mapping JSONB on b2b_imported_products
 * 
 * Idempotent: skips rows where unit_mapping is already set.
 * Non-destructive: only writes to unit_mapping column.
 * Batched: processes in chunks of 50.
 * 
 * POST /backfill-b2b-unit-mapping
 * Auth: requires admin user
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { createLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Unit matching logic (mirrors b2bUnitMapper.ts) ──

interface UnitRow {
  id: string;
  name: string;
  abbreviation: string;
  family: string | null;
  aliases: string[] | null;
}

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function singularize(text: string): string {
  if (text.endsWith("s") && text.length > 2) return text.slice(0, -1);
  return text;
}

function matchSingleUnit(
  sourceUnit: UnitRow,
  localUnits: UnitRow[],
): { status: "MAPPED" | "AMBIGUOUS" | "UNKNOWN"; localUnitId: string | null } {
  const srcAbbr = normalizeText(sourceUnit.abbreviation);
  const srcName = normalizeText(sourceUnit.name);
  const srcNameSingular = singularize(srcName);

  // 1. Match by (family, abbreviation)
  const abbrMatches = localUnits.filter(
    (lu) => lu.family === sourceUnit.family && normalizeText(lu.abbreviation) === srcAbbr,
  );
  if (abbrMatches.length === 1) return { status: "MAPPED", localUnitId: abbrMatches[0].id };
  if (abbrMatches.length > 1) return { status: "AMBIGUOUS", localUnitId: null };

  // 2. Match by (family, name)
  const nameMatches = localUnits.filter((lu) => {
    if (lu.family !== sourceUnit.family) return false;
    const localName = normalizeText(lu.name);
    return localName === srcName || singularize(localName) === srcNameSingular;
  });
  if (nameMatches.length === 1) return { status: "MAPPED", localUnitId: nameMatches[0].id };
  if (nameMatches.length > 1) return { status: "AMBIGUOUS", localUnitId: null };

  // 3. Match by aliases
  const aliasMatches = localUnits.filter((lu) => {
    if (lu.family !== sourceUnit.family) return false;
    if (!lu.aliases || lu.aliases.length === 0) return false;
    return lu.aliases.some((alias) => {
      const normAlias = normalizeText(alias);
      return normAlias === srcAbbr || normAlias === srcName || singularize(normAlias) === srcNameSingular;
    });
  });
  if (aliasMatches.length === 1) return { status: "MAPPED", localUnitId: aliasMatches[0].id };
  if (aliasMatches.length > 1) return { status: "AMBIGUOUS", localUnitId: null };

  return { status: "UNKNOWN", localUnitId: null };
}

/** Extract all unit IDs referenced by a product */
function extractUnitIds(product: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const fields = [
    "final_unit_id", "supplier_billing_unit_id", "delivery_unit_id",
    "stock_handling_unit_id", "kitchen_unit_id", "price_display_unit_id",
  ];
  for (const f of fields) {
    if (typeof product[f] === "string") ids.add(product[f] as string);
  }

  const config = product.conditionnement_config;
  if (config && typeof config === "object") {
    const c = config as Record<string, unknown>;
    if (typeof c.final_unit_id === "string") ids.add(c.final_unit_id);
    const levels = c.packagingLevels;
    if (Array.isArray(levels)) {
      for (const level of levels) {
        if (level && typeof level === "object") {
          const l = level as Record<string, unknown>;
          if (typeof l.type_unit_id === "string") ids.add(l.type_unit_id);
          if (typeof l.contains_unit_id === "string") ids.add(l.contains_unit_id);
        }
      }
    }
    const eq = c.equivalence;
    if (eq && typeof eq === "object") {
      const eqObj = eq as Record<string, unknown>;
      if (typeof eqObj.source_unit_id === "string") ids.add(eqObj.source_unit_id);
      if (typeof eqObj.unit_id === "string") ids.add(eqObj.unit_id);
    }
    const pl = c.priceLevel;
    if (pl && typeof pl === "object") {
      const plObj = pl as Record<string, unknown>;
      if (typeof plObj.billed_unit_id === "string") ids.add(plObj.billed_unit_id);
    }
  }
  return ids;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const log = createLogger("backfill-b2b-unit-mapping");

  // Auth check
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Verify user is authenticated
  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  log.info("Starting backfill", { user_id: user.id });

  // Fetch all imports without unit_mapping
  const { data: imports, error: fetchErr } = await admin
    .from("b2b_imported_products")
    .select("id, source_product_id, source_establishment_id, establishment_id, local_product_id, unit_mapping")
    .is("unit_mapping", null)
    .order("imported_at", { ascending: true });

  if (fetchErr) {
    log.error("Failed to fetch imports", fetchErr);
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const total = imports?.length ?? 0;
  log.info(`Found ${total} imports to backfill`);

  if (total === 0) {
    return new Response(JSON.stringify({ total: 0, filled: 0, partial: 0, failed: 0, errors: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Cache units per establishment
  const unitsCache = new Map<string, UnitRow[]>();
  async function getUnits(estId: string): Promise<UnitRow[]> {
    if (unitsCache.has(estId)) return unitsCache.get(estId)!;
    const { data } = await admin
      .from("measurement_units")
      .select("id, name, abbreviation, family, aliases")
      .eq("establishment_id", estId);
    const units = (data ?? []) as UnitRow[];
    unitsCache.set(estId, units);
    return units;
  }

  // Cache products
  const productCache = new Map<string, Record<string, unknown>>();
  async function getProduct(productId: string): Promise<Record<string, unknown> | null> {
    if (productCache.has(productId)) return productCache.get(productId)!;
    const { data } = await admin
      .from("products_v2")
      .select("id, final_unit_id, supplier_billing_unit_id, delivery_unit_id, stock_handling_unit_id, kitchen_unit_id, price_display_unit_id, conditionnement_config")
      .eq("id", productId)
      .maybeSingle();
    if (data) productCache.set(productId, data as Record<string, unknown>);
    return (data as Record<string, unknown>) ?? null;
  }

  let filled = 0;
  let partial = 0;
  let failed = 0;
  const errors: { id: string; reason: string }[] = [];

  // Process in batches of 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = imports!.slice(i, i + BATCH_SIZE);

    for (const imp of batch) {
      try {
        // Get source product (supplier's product)
        const sourceProduct = await getProduct(imp.source_product_id);
        if (!sourceProduct) {
          errors.push({ id: imp.id, reason: "source_product_not_found" });
          failed++;
          continue;
        }

        // Get units for both establishments
        const supplierUnits = await getUnits(imp.source_establishment_id);
        const clientUnits = await getUnits(imp.establishment_id);

        if (supplierUnits.length === 0 || clientUnits.length === 0) {
          errors.push({ id: imp.id, reason: "units_not_found" });
          failed++;
          continue;
        }

        // Extract all unit IDs from the source product
        const unitIds = extractUnitIds(sourceProduct);

        // Build mapping: sourceUnitId → localUnitId
        const mapping: Record<string, string> = {};
        let mappedCount = 0;
        let totalUnits = 0;

        for (const uid of unitIds) {
          totalUnits++;
          const sourceUnit = supplierUnits.find((u) => u.id === uid);
          if (!sourceUnit) continue;

          const result = matchSingleUnit(sourceUnit, clientUnits);
          if (result.status === "MAPPED" && result.localUnitId) {
            mapping[uid] = result.localUnitId;
            mappedCount++;
          }
        }

        if (Object.keys(mapping).length === 0) {
          errors.push({ id: imp.id, reason: `no_units_mapped (${totalUnits} units found)` });
          failed++;
          continue;
        }

        // Persist
        const { error: updateErr } = await admin
          .from("b2b_imported_products")
          .update({ unit_mapping: mapping })
          .eq("id", imp.id);

        if (updateErr) {
          errors.push({ id: imp.id, reason: updateErr.message });
          failed++;
          continue;
        }

        if (mappedCount < totalUnits) {
          partial++;
        } else {
          filled++;
        }
      } catch (err) {
        errors.push({ id: imp.id, reason: (err as Error).message });
        failed++;
      }
    }

    log.info(`Batch progress: ${Math.min(i + BATCH_SIZE, total)}/${total}`);
  }

  const result = { total, filled, partial, failed, errors: errors.slice(0, 50) };
  log.info("Backfill complete", result);

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

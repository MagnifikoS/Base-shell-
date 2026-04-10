/**
 * Backfill invoice_line_items with snapshots + global_product_id
 * 
 * PHASE 2.2: Idempotent backfill
 * - Sets supplier_product_id_legacy = product_id (if NULL)
 * - Sets global_product_id from supplier_extracted_products.global_product_id
 * - Sets snapshots from supplier_extracted_products
 * 
 * Run once after migration, safe to re-run (idempotent).
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireAuth, AuthError } from "../_shared/requireAuth.ts";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const CORS = makeCorsHeaders("POST, OPTIONS");
const log = createLogger("backfill-invoice-snapshots");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    log.info("Request received");

    // B-002: Require admin authentication for backfill operations
    let userClient;
    try {
      const auth = await requireAuth(req);
      userClient = auth.supabase;
    } catch (e) {
      if (e instanceof AuthError) {
        log.warn("auth_failed", { reason: e.message });
        return new Response(
          JSON.stringify({ success: false, error: e.message }),
          { status: e.status, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
      throw e;
    }

    // Verify caller is admin
    const { data: isAdmin } = await userClient.rpc("is_admin", { _user_id: (await userClient.auth.getUser()).data.user!.id });
    if (!isAdmin) {
      log.warn("access_denied", { reason: "not_admin" });
      return new Response(
        JSON.stringify({ success: false, error: "Forbidden: Admin access required" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Rate limiting (P0-5)
    const rateLimited = await checkRateLimit(req, supabase, { max: 5, keyPrefix: "backfill-invoice-snapshots" });
    if (rateLimited) return rateLimited;

    // Backfill in batches to avoid timeouts
    const BATCH_SIZE = 500;
    let totalUpdated = 0;
    let hasMore = true;

    while (hasMore) {
      // Get line items that need backfill (any snapshot NULL)
      const { data: lineItems, error: fetchError } = await supabase
        .from("invoice_line_items")
        .select(`
          id,
          product_id,
          supplier_product_id_legacy,
          global_product_id,
          product_name_snapshot,
          product_code_snapshot,
          unit_of_sale_snapshot,
          unit_price_snapshot,
          packaging_snapshot,
          category_snapshot
        `)
        .or("supplier_product_id_legacy.is.null,global_product_id.is.null,product_name_snapshot.is.null")
        .limit(BATCH_SIZE);

      if (fetchError) {
        throw new Error(`Fetch error: ${fetchError.message}`);
      }

      if (!lineItems || lineItems.length === 0) {
        hasMore = false;
        break;
      }

      // Get unique product_ids to fetch supplier_extracted_products
      const productIds = [...new Set(lineItems.map(li => li.product_id).filter(Boolean))];
      
      if (productIds.length === 0) {
        hasMore = false;
        break;
      }

      // Fetch supplier_extracted_products data
      const { data: products, error: prodError } = await supabase
        .from("supplier_extracted_products")
        .select(`
          id,
          product_name,
          supplier_product_code,
          unit_of_sale,
          unit_price,
          conditioning,
          category,
          global_product_id
        `)
        .in("id", productIds);

      if (prodError) {
        throw new Error(`Products fetch error: ${prodError.message}`);
      }

      const productMap = new Map(products?.map(p => [p.id, p]) || []);

      // Build updates
      const updates: Array<{
        id: string;
        supplier_product_id_legacy?: string;
        global_product_id?: string;
        product_name_snapshot?: string;
        product_code_snapshot?: string;
        unit_of_sale_snapshot?: string;
        unit_price_snapshot?: number;
        packaging_snapshot?: string;
        category_snapshot?: string;
      }> = [];

      for (const li of lineItems) {
        const product = productMap.get(li.product_id);
        if (!product) continue;

        const update: typeof updates[0] = { id: li.id };
        let needsUpdate = false;

        // Set supplier_product_id_legacy if NULL
        if (li.supplier_product_id_legacy === null && li.product_id) {
          update.supplier_product_id_legacy = li.product_id;
          needsUpdate = true;
        }

        // Set global_product_id if NULL
        if (li.global_product_id === null && product.global_product_id) {
          update.global_product_id = product.global_product_id;
          needsUpdate = true;
        }

        // Set snapshots if NULL
        if (li.product_name_snapshot === null && product.product_name) {
          update.product_name_snapshot = product.product_name;
          needsUpdate = true;
        }
        if (li.product_code_snapshot === null && product.supplier_product_code) {
          update.product_code_snapshot = product.supplier_product_code;
          needsUpdate = true;
        }
        if (li.unit_of_sale_snapshot === null && product.unit_of_sale) {
          update.unit_of_sale_snapshot = product.unit_of_sale;
          needsUpdate = true;
        }
        if (li.unit_price_snapshot === null && product.unit_price != null) {
          update.unit_price_snapshot = product.unit_price;
          needsUpdate = true;
        }
        if (li.packaging_snapshot === null && product.conditioning) {
          update.packaging_snapshot = product.conditioning;
          needsUpdate = true;
        }
        if (li.category_snapshot === null && product.category) {
          update.category_snapshot = product.category;
          needsUpdate = true;
        }

        if (needsUpdate) {
          updates.push(update);
        }
      }

      // Apply updates one by one (Supabase doesn't support batch update with different values)
      for (const upd of updates) {
        const { id, ...fields } = upd;
        const { error: updateError } = await supabase
          .from("invoice_line_items")
          .update(fields)
          .eq("id", id);

        if (updateError) {
          log.warn("update_error", { line_item_id: id, error: updateError.message });
        } else {
          totalUpdated++;
        }
      }

      // If we got fewer than batch size, we're done
      if (lineItems.length < BATCH_SIZE) {
        hasMore = false;
      }
    }

    log.info("backfill_complete", { updated: totalUpdated });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Backfill complete: ${totalUpdated} line items updated`,
        updated: totalUpdated,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (error) {
    log.error("Unhandled error", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal server error"
      }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});

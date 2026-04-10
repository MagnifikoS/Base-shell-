/**
 * Backfill Product Codes — Phase 3
 * 
 * Extracts product_code from invoice_extractions JSON and propagates to:
 * 1. supplier_extracted_products.supplier_product_code
 * 2. invoice_line_items.product_code_snapshot
 * 
 * Run once to fix historical data imported before code propagation was implemented.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireAuth, AuthError } from "../_shared/requireAuth.ts";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const CORS = makeCorsHeaders("POST, OPTIONS");
const log = createLogger("backfill-product-codes");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
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
          JSON.stringify({ error: e.message }),
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
        JSON.stringify({ error: "Forbidden: Admin access required" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Rate limiting (P0-5)
    const rateLimited = await checkRateLimit(req, supabase, { max: 5, keyPrefix: "backfill-product-codes" });
    if (rateLimited) return rateLimited;

    const { establishment_id } = await req.json();
    if (!establishment_id) {
      return new Response(JSON.stringify({ error: "establishment_id required" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    log.info("backfill_start", { establishment_id });

    // 1. Get all extractions with lines
    const { data: extractions, error: extractError } = await supabase
      .from("invoice_extractions")
      .select("id, invoice_id, supplier_id, extraction_json")
      .eq("establishment_id", establishment_id)
      .eq("status", "extracted")
      .not("extraction_json", "is", null);

    if (extractError) {
      log.error("Fetch extractions error", extractError);
      throw extractError;
    }

    log.info("extractions_found", { count: extractions?.length || 0, establishment_id });

    let updatedProducts = 0;
    let updatedLineItems = 0;

    for (const extraction of extractions || []) {
      const lines = (extraction.extraction_json as Record<string, unknown>)?.lines as Array<{ product_code?: string; product_name?: string }> || [];
      
      for (const line of lines) {
        const productCode = line.product_code?.trim();
        const productName = line.product_name?.trim();
        
        if (!productCode || !productName) continue;

        // Normalize for matching
        const normalizedName = productName
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim();

        // 2. Update supplier_extracted_products where name matches and code is null
        const { data: matchedProducts } = await supabase
          .from("supplier_extracted_products")
          .select("id, product_name, supplier_product_code")
          .eq("supplier_id", extraction.supplier_id)
          .eq("establishment_id", establishment_id)
          .is("supplier_product_code", null);

        for (const product of matchedProducts || []) {
          const existingNorm = product.product_name
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ")
            .trim();

          if (existingNorm === normalizedName) {
            const { error: updateError } = await supabase
              .from("supplier_extracted_products")
              .update({
                supplier_product_code: productCode,
                updated_at: new Date().toISOString(),
              })
              .eq("id", product.id);

            if (!updateError) {
              updatedProducts++;
              log.info("product_code_backfilled", { product_id: product.id, code: productCode });
            }
          }
        }

        // 3. Update invoice_line_items.product_code_snapshot where snapshot is null
        if (extraction.invoice_id) {
          const { data: lineItems } = await supabase
            .from("invoice_line_items")
            .select("id, product_name_snapshot, product_code_snapshot")
            .eq("invoice_id", extraction.invoice_id)
            .eq("line_index", line.line_index)
            .is("product_code_snapshot", null);

          for (const item of lineItems || []) {
            const { error: lineUpdateError } = await supabase
              .from("invoice_line_items")
              .update({
                product_code_snapshot: productCode,
                updated_at: new Date().toISOString(),
              })
              .eq("id", item.id);

            if (!lineUpdateError) {
              updatedLineItems++;
            }
          }
        }
      }
    }

    const result = {
      success: true,
      establishment_id,
      updated_products: updatedProducts,
      updated_line_items: updatedLineItems,
    };

    log.info("backfill_complete", { establishment_id, updated_products: updatedProducts, updated_line_items: updatedLineItems });

    return new Response(JSON.stringify(result), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (error) {
    log.error("Unhandled error", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

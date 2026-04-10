/**
 * Backfill Products SSOT — Phase 1.4
 * 
 * One-shot idempotent script to:
 * 1. Create global products from validated supplier_extracted_products
 * 2. Link supplier_extracted_products.global_product_id
 * 3. Update supplier_product_aliases with global_product_id
 * 
 * Idempotent: safe to run multiple times
 * 
 * Usage: POST /backfill-products-ssot
 * Body: { "establishment_id": "uuid" } or { "establishment_id": "all" }
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";
// SSOT: Import shared normalization (same as frontend)
import { normalizeProductName } from "../_shared/normalizeProductName.ts";
import { requireAuth, AuthError } from "../_shared/requireAuth.ts";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const log = createLogger("backfill-products-ssot");
const CORS = makeCorsHeaders("POST, OPTIONS");

interface BackfillResult {
  establishment_id: string;
  products_created: number;
  products_existing: number;
  sep_linked: number;
  aliases_updated: number;
  errors: string[];
}

type AnySupabaseClient = SupabaseClient;

Deno.serve(async (req) => {
  // Handle CORS preflight
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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase: AnySupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Rate limiting (P0-5)
    const rateLimited = await checkRateLimit(req, supabase, { max: 5, keyPrefix: "backfill-products-ssot" });
    if (rateLimited) return rateLimited;

    // Parse request
    const body = await req.json().catch(() => ({}));
    const targetEstablishment = body.establishment_id as string | undefined;

    log.info("backfill_start", { target_establishment: targetEstablishment });

    // Get establishments to process
    let establishmentIds: string[] = [];
    
    if (targetEstablishment && targetEstablishment !== "all") {
      establishmentIds = [targetEstablishment];
    } else {
      // Get all establishments with validated products
      const { data: establishments, error } = await supabase
        .from("supplier_extracted_products")
        .select("establishment_id")
        .eq("status", "validated")
        .is("global_product_id", null);
      
      if (error) throw error;
      
      establishmentIds = [...new Set((establishments || []).map((e: { establishment_id: string }) => e.establishment_id))];
    }

    log.info("processing_establishments", { count: establishmentIds.length });

    const results: BackfillResult[] = [];

    for (const establishmentId of establishmentIds) {
      const result: BackfillResult = {
        establishment_id: establishmentId,
        products_created: 0,
        products_existing: 0,
        sep_linked: 0,
        aliases_updated: 0,
        errors: [],
      };

      try {
        // 1. Get all validated products without global_product_id
        const { data: unlinkedProducts, error: fetchError } = await supabase
          .from("supplier_extracted_products")
          .select("id, product_name, supplier_id, supplier_product_code, category, unit_of_sale")
          .eq("establishment_id", establishmentId)
          .eq("status", "validated")
          .is("global_product_id", null);

        if (fetchError) {
          result.errors.push(`Fetch error: ${fetchError.message}`);
          results.push(result);
          continue;
        }

        const productsToProcess = unlinkedProducts || [];
        log.info("establishment_processing", { establishment_id: establishmentId, unlinked_count: productsToProcess.length });

        // Group by normalized name to avoid duplicates
        const productGroups = new Map<string, typeof productsToProcess>();
        
        for (const product of productsToProcess) {
          const normalized = normalizeProductName(product.product_name);
          if (!normalized) continue;
          
          if (!productGroups.has(normalized)) {
            productGroups.set(normalized, []);
          }
          productGroups.get(normalized)!.push(product);
        }

        // 2. Process each unique normalized product
        for (const [nameNormalized, sepProducts] of productGroups) {
          const firstProduct = sepProducts[0];
          const displayName = firstProduct.product_name.trim();

          // Upsert into products table
          const { data: upsertedProduct, error: upsertError } = await supabase
            .from("products")
            .upsert(
              {
                establishment_id: establishmentId,
                name_normalized: nameNormalized,
                display_name: displayName,
                category: firstProduct.category,
                unit_of_sale: firstProduct.unit_of_sale,
              },
              {
                onConflict: "establishment_id,name_normalized",
                ignoreDuplicates: false,
              }
            )
            .select("id")
            .single();

          if (upsertError) {
            // If conflict, fetch existing
            if (upsertError.code === "23505") {
              const { data: existing } = await supabase
                .from("products")
                .select("id")
                .eq("establishment_id", establishmentId)
                .eq("name_normalized", nameNormalized)
                .single();
              
              if (existing) {
                result.products_existing++;
                
                // Link all SEP records to this product
                for (const sep of sepProducts) {
                  await linkSepToProduct(supabase, sep.id, existing.id, result);
                  await updateAlias(supabase, establishmentId, sep.supplier_id, sep.supplier_product_code, sep.product_name, existing.id, result);
                }
              }
            } else {
              result.errors.push(`Upsert error for "${displayName}": ${upsertError.message}`);
            }
            continue;
          }

          if (upsertedProduct) {
            result.products_created++;
            
            // Link all SEP records with this normalized name
            for (const sep of sepProducts) {
              await linkSepToProduct(supabase, sep.id, upsertedProduct.id, result);
              await updateAlias(supabase, establishmentId, sep.supplier_id, sep.supplier_product_code, sep.product_name, upsertedProduct.id, result);
            }
          }
        }

      } catch (err) {
        result.errors.push(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      }

      results.push(result);
    }

    // Summary
    const summary = {
      establishments_processed: results.length,
      total_products_created: results.reduce((sum, r) => sum + r.products_created, 0),
      total_products_existing: results.reduce((sum, r) => sum + r.products_existing, 0),
      total_sep_linked: results.reduce((sum, r) => sum + r.sep_linked, 0),
      total_aliases_updated: results.reduce((sum, r) => sum + r.aliases_updated, 0),
      total_errors: results.reduce((sum, r) => sum + r.errors.length, 0),
      results,
    };

    log.info("backfill_complete", { products_created: summary.total_products_created, sep_linked: summary.total_sep_linked, errors: summary.total_errors });

    return new Response(JSON.stringify(summary), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (error) {
    log.error("Unhandled error", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
      }),
      {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Link supplier_extracted_products to global product
 */
async function linkSepToProduct(
  supabase: AnySupabaseClient,
  sepId: string,
  productId: string,
  result: BackfillResult
): Promise<void> {
  const { error } = await supabase
    .from("supplier_extracted_products")
    .update({ global_product_id: productId })
    .eq("id", sepId)
    .is("global_product_id", null); // Only update if not already linked

  if (error) {
    result.errors.push(`Link SEP ${sepId} error: ${error.message}`);
  } else {
    result.sep_linked++;
  }
}

/**
 * Update or create supplier_product_aliases with global_product_id
 */
async function updateAlias(
  supabase: AnySupabaseClient,
  establishmentId: string,
  supplierId: string,
  supplierProductCode: string | null,
  supplierProductName: string,
  globalProductId: string,
  result: BackfillResult
): Promise<void> {
  // Find existing alias by supplier + code (if code exists) or by supplier + name
  let aliasQuery = supabase
    .from("supplier_product_aliases")
    .select("id, global_product_id")
    .eq("establishment_id", establishmentId)
    .eq("supplier_id", supplierId);

  if (supplierProductCode) {
    aliasQuery = aliasQuery.eq("supplier_product_code", supplierProductCode);
  }

  const { data: existingAliases } = await aliasQuery.limit(1);

  if (existingAliases && existingAliases.length > 0) {
    const alias = existingAliases[0];
    
    // Only update if global_product_id is null (non-destructive)
    if (!alias.global_product_id) {
      const { error } = await supabase
        .from("supplier_product_aliases")
        .update({
          global_product_id: globalProductId,
          supplier_product_name: supplierProductName,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", alias.id);

      if (error) {
        result.errors.push(`Update alias error: ${error.message}`);
      } else {
        result.aliases_updated++;
      }
    }
  }
  // Note: We don't create new aliases here - that's done during invoice import
}

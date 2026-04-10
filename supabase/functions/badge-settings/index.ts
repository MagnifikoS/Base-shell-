import { createClient } from "npm:@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { makeCorsHeaders } from "../_shared/cors.ts";

// ═══════════════════════════════════════════════════════════════════════════
// DIAGNOSTIC BUILD ID - Remove after debugging
// ═══════════════════════════════════════════════════════════════════════════
const BUILD_ID = "badge-settings-20260120-2040-v1";

const log = createLogger("badge-settings");
const CORS = makeCorsHeaders("GET, PATCH, OPTIONS");

// Helper to ensure ALL responses have CORS + build ID
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      "x-build-id": BUILD_ID,
    },
  });
}

const DEFAULT_SETTINGS = {
  arrival_tolerance_min: 10,
  departure_tolerance_min: 20,
  extra_threshold_min: 20,
  require_selfie: true,
  require_pin: true,
  device_binding_enabled: true,
  max_devices_per_user: 1,
  early_arrival_limit_min: 30,
};

Deno.serve(async (req) => {
  // Log every request for diagnostic
  log.info("Request received", { method: req.method, build: BUILD_ID });

  if (req.method === "OPTIONS") {
    // Preflight must return ONLY the CORS headers (no auth, no logic)
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS,
        "x-build-id": BUILD_ID,
      },
    });
  }

  try {
    const url = new URL(req.url);
    const establishmentId = url.searchParams.get("establishment_id");

    // ═══════════════════════════════════════════════════════════════════════
    // PING ENDPOINT - No auth required, for deployment verification
    // ═══════════════════════════════════════════════════════════════════════
    if (req.method === "GET" && !establishmentId) {
      return respond({ ok: true, build: BUILD_ID, ts: new Date().toISOString() });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      log.warn("auth_failed", { reason: "missing_authorization" });
      return respond({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      log.warn("auth_failed", { reason: "invalid_token" });
      return respond({ error: "Unauthorized" }, 401);
    }

    // Rate limiting (P0-5)
    const rateLimited = await checkRateLimit(req, supabaseAdmin, { max: 30, keyPrefix: "badge-settings" });
    if (rateLimited) return rateLimited;

    if (!establishmentId) {
      return respond({ error: "Missing establishment_id" }, 400);
    }

    // GET - Fetch settings
    if (req.method === "GET") {
      const { data: settings, error } = await supabaseAdmin
        .from("badgeuse_settings")
        .select("*")
        .eq("establishment_id", establishmentId)
        .single();

      if (error && error.code !== "PGRST116") {
        return respond({ error: error.message }, 500);
      }

      // Return settings or defaults
      const effectiveSettings = settings || {
        ...DEFAULT_SETTINGS,
        establishment_id: establishmentId,
      };

      return respond({ settings: effectiveSettings });
    }

    // PATCH - Update settings (Phase 1: only 4 fields)
    if (req.method === "PATCH") {
      // ═══════════════════════════════════════════════════════════════════════
      // RBAC CHECK - has_module_access('parametres', 'write', establishment_id)
      // Uses supabaseUser (JWT client) so auth.uid() is correctly populated
      // ═══════════════════════════════════════════════════════════════════════
      const { data: hasAccess, error: rbacErr } = await supabaseUser
        .rpc("has_module_access", { 
          _module_key: "parametres", 
          _min_level: "write", 
          _establishment_id: establishmentId 
        });

      if (rbacErr) {
        log.error("RBAC check error", rbacErr);
        return respond({ error: "Authorization check failed" }, 500);
      }

      if (!hasAccess) {
        log.warn("RBAC denied", {
          user_id: user.id,
          establishment_id: establishmentId,
          module: "parametres",
          level: "write"
        });
        return respond({ error: "NOT_AUTHORIZED" }, 403);
      }

      log.info("RBAC granted", { user_id: user.id, establishment_id: establishmentId });

      // Safe JSON parsing
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        log.warn("JSON parse error");
        return respond({ error: "INVALID_JSON" }, 400);
      }
      
      // Validate fields
      const { 
        arrival_tolerance_min, 
        departure_tolerance_min, 
        require_pin, 
        require_selfie,
        early_arrival_limit_min 
      } = body;

      // Validation
      if (typeof arrival_tolerance_min === "number" && 
          (arrival_tolerance_min < 0 || arrival_tolerance_min > 120)) {
        return respond({ error: "arrival_tolerance_min must be 0-120" }, 400);
      }
      if (typeof departure_tolerance_min === "number" && 
          (departure_tolerance_min < 0 || departure_tolerance_min > 180)) {
        return respond({ error: "departure_tolerance_min must be 0-180" }, 400);
      }
      if (typeof early_arrival_limit_min === "number" && 
          (early_arrival_limit_min < 0 || early_arrival_limit_min > 120)) {
        return respond({ error: "early_arrival_limit_min must be 0-120" }, 400);
      }

      // Get user's organization
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user.id)
        .single();

      if (!profile) {
        return respond({ error: "Profile not found" }, 404);
      }

      // Build update payload (only allowed fields)
      const updatePayload: Record<string, unknown> = {};
      if (typeof arrival_tolerance_min === "number") {
        updatePayload.arrival_tolerance_min = arrival_tolerance_min;
      }
      if (typeof departure_tolerance_min === "number") {
        updatePayload.departure_tolerance_min = departure_tolerance_min;
      }
      if (typeof require_pin === "boolean") {
        updatePayload.require_pin = require_pin;
      }
      if (typeof require_selfie === "boolean") {
        updatePayload.require_selfie = require_selfie;
      }
      if (typeof early_arrival_limit_min === "number") {
        updatePayload.early_arrival_limit_min = early_arrival_limit_min;
      }

      if (Object.keys(updatePayload).length === 0) {
        return respond({ error: "No valid fields to update" }, 400);
      }

      updatePayload.updated_at = new Date().toISOString();

      // Check if settings exist
      const { data: existing } = await supabaseAdmin
        .from("badgeuse_settings")
        .select("id")
        .eq("establishment_id", establishmentId)
        .single();

      if (existing) {
        // ✅ PHASE P1: Anti-phantom — .select("id").single() pour détecter 0 rows
        const { data: updatedSetting, error: updateErr } = await supabaseAdmin
          .from("badgeuse_settings")
          .update(updatePayload)
          .eq("establishment_id", establishmentId)
          .select("id")
          .single();

        if (updateErr) {
          return respond({ error: updateErr.message }, 500);
        }
        
        // Détection "succès fantôme"
        if (!updatedSetting) {
          return respond({ error: "Update failed: no rows affected" }, 500);
        }
      } else {
        // Insert new with defaults
        const { error: insertErr } = await supabaseAdmin
          .from("badgeuse_settings")
          .insert({
            establishment_id: establishmentId,
            organization_id: profile.organization_id,
            ...DEFAULT_SETTINGS,
            ...updatePayload,
          });

        if (insertErr) {
          return respond({ error: insertErr.message }, 500);
        }
      }

      log.info("completed", { action: "settings_updated", establishment_id: establishmentId, fields: Object.keys(updatePayload) });
      return respond({ success: true });
    }

    return respond({ error: "Method not allowed" }, 405);
  } catch (error: unknown) {
    // SEC-20: Log detailed error server-side, return generic message to client
    log.error("Unhandled error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});

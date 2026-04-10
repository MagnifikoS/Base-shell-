import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("payroll-validation");
const CORS = makeCorsHeaders("POST, OPTIONS");

/**
 * PAYROLL VALIDATION EDGE FUNCTION
 * 
 * Upserts validation flags (include_extras, include_absences, include_deductions)
 * for a specific employee + month + establishment.
 * 
 * PARTIAL EXTRAS PAYMENT:
 * - extras_paid_eur: partial amount paid on salary (NULL = pay full amount)
 * 
 * R-Extra balance is calculated on-the-fly (SSOT unique), never stored.
 * 
 * RBAC: Requires paie:write access on the establishment.
 * Security: updated_by is always set to auth.uid() (enforced by RLS).
 */

interface ValidationPayload {
  establishment_id: string;
  user_id: string;
  year_month: string;
  include_extras?: boolean;
  include_absences?: boolean;
  include_deductions?: boolean;
  cash_paid?: boolean;
  net_paid?: boolean;
  extras_paid_eur?: number | null;
  net_amount_paid?: number | null;
  cash_amount_paid?: number | null;
}

// Validate year_month format (YYYY-MM)
const YEAR_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  // Only POST allowed
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  try {
    log.info("Request received");

    // Auth check FIRST (before parsing body — never leak API contract to unauthenticated callers)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // SEC-05: User client uses ANON_KEY + JWT (not SERVICE_ROLE_KEY)
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Admin client for mutations (service role for bypassing RLS)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Get current user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      log.warn("Auth failed");
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid or missing authentication" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Parse body (after auth)
    const payload: ValidationPayload = await req.json();
    const {
      establishment_id,
      user_id,
      year_month,
      include_extras,
      include_absences,
      include_deductions,
      cash_paid,
      net_paid,
      extras_paid_eur,
      net_amount_paid,
      cash_amount_paid,
    } = payload;

    // Validate required fields
    if (!establishment_id || !user_id || !year_month) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: establishment_id, user_id, year_month" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Validate year_month format
    if (!YEAR_MONTH_REGEX.test(year_month)) {
      return new Response(
        JSON.stringify({ error: "Invalid year_month format. Expected YYYY-MM (e.g., 2025-01)" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Rate limit check (after auth, before business logic)
    const rateLimited = await checkRateLimit(req, supabaseAdmin, { max: 30, keyPrefix: "payroll-validation" });
    if (rateLimited) return rateLimited;

    // RBAC: Check paie:write access on establishment
    const { data: hasAccess, error: accessError } = await supabaseUser.rpc("has_module_access", {
      _module_key: "paie",
      _min_level: "write",
      _establishment_id: establishment_id,
    });

    if (accessError) {
      log.error("RBAC check failed", accessError);
      return new Response(
        JSON.stringify({ error: "Failed to verify permissions" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!hasAccess) {
      return new Response(
        JSON.stringify({ error: "Forbidden: paie:write access required for this establishment" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BUSINESS RULE: if include_extras = false, force extras_paid_eur to NULL
    // ═══════════════════════════════════════════════════════════════════════════
    const effectiveIncludeExtras = include_extras ?? false;
    let effectiveExtrasPaidEur: number | null = extras_paid_eur ?? null;

    if (!effectiveIncludeExtras) {
      effectiveExtrasPaidEur = null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BUSINESS RULE: if net_paid = false, force net_amount_paid to NULL
    //                if cash_paid = false, force cash_amount_paid to NULL
    // ═══════════════════════════════════════════════════════════════════════════
    const effectiveNetPaid = net_paid ?? false;
    const effectiveCashPaid = cash_paid ?? false;
    const effectiveNetAmountPaid: number | null = effectiveNetPaid ? (net_amount_paid ?? null) : null;
    const effectiveCashAmountPaid: number | null = effectiveCashPaid ? (cash_amount_paid ?? null) : null;

    log.info("validate_payroll", { user_id: user.id, target_user_id: user_id, establishment_id, year_month });

    // Upsert validation record
    // Base payload (always safe — these columns always exist)
    const upsertPayload: Record<string, unknown> = {
      establishment_id,
      user_id,
      year_month,
      include_extras: effectiveIncludeExtras,
      include_absences: include_absences ?? false,
      include_deductions: include_deductions ?? false,
      cash_paid: effectiveCashPaid,
      net_paid: effectiveNetPaid,
      extras_paid_eur: effectiveExtrasPaidEur,
      net_amount_paid: effectiveNetAmountPaid,
      cash_amount_paid: effectiveCashAmountPaid,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    };

    let result;
    let upsertError;

    // Try with partial payment columns first
    ({ data: result, error: upsertError } = await supabaseAdmin
      .from("payroll_employee_month_validation")
      .upsert(upsertPayload, { onConflict: "establishment_id,user_id,year_month" })
      .select()
      .single());

    // If columns don't exist yet, retry without them
    if (upsertError && upsertError.message?.includes("does not exist")) {
      log.warn("Partial payment columns not yet migrated, retrying without them");
      delete upsertPayload.net_amount_paid;
      delete upsertPayload.cash_amount_paid;
      ({ data: result, error: upsertError } = await supabaseAdmin
        .from("payroll_employee_month_validation")
        .upsert(upsertPayload, { onConflict: "establishment_id,user_id,year_month" })
        .select()
        .single());
    }

    if (upsertError) {
      // SEC-20: Log detailed error server-side, return generic message to client
      log.error("Upsert failed", upsertError);
      return new Response(
        JSON.stringify({ error: "Database operation failed" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Anti-phantom check
    if (!result) {
      return new Response(
        JSON.stringify({ error: "Unexpected: No row returned after upsert" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    log.info("completed", { establishment_id: payload.establishment_id, user_id: payload.user_id, year_month: payload.year_month });
    return new Response(
      JSON.stringify({ success: true, data: result }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    log.error("Unhandled error", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});

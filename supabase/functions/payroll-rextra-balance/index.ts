import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("payroll-rextra-balance");
const CORS = makeCorsHeaders("POST, OPTIONS");

/**
 * PAYROLL R-EXTRA BALANCE EDGE FUNCTION
 * 
 * Exposes the R-Extra balance calculation (SSOT unique) for the Payroll module.
 * This is the SAME calculation as used in Planning (computeRextraBalanceForUsers).
 * 
 * FORMULA (all-time, dynamic):
 *   RExtra = total_extras_detected - total_extras_paid - total_rextra_consumed
 * 
 * Where:
 *   - total_extras_detected = planning extras + badge extras (approved)
 *   - total_extras_paid = SUM(extras_paid_eur) converted to minutes
 *   - total_rextra_consumed = SUM(planning_rextra_events.minutes)
 * 
 * RBAC: Requires paie:read access on the establishment.
 */

type AnyClient = SupabaseClient;

/** Conversion factor: weeks per month (French labor law: 52/12) */
const WEEKS_PER_MONTH = 52 / 12;

/**
 * Calculate weekly extras from shifts (same logic as payroll engine)
 * Extras = sum per week of max(0, worked - contractHours × 60)
 * Week belongs to month of its Sunday
 */
function calculateWeeklyExtras(
  shifts: Array<{ shift_date: string; net_minutes: number }>,
  contractHours: number
): number {
  // Group shifts by ISO week (Monday-Sunday)
  const weekMap = new Map<string, number>();
  
  for (const shift of shifts) {
    const date = new Date(shift.shift_date + "T12:00:00Z");
    const dayOfWeek = date.getDay(); // 0=Sunday, 1=Monday, ...
    
    // Get Monday of this week
    const monday = new Date(date);
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    monday.setDate(monday.getDate() + daysToMonday);
    
    const weekKey = monday.toISOString().slice(0, 10);
    weekMap.set(weekKey, (weekMap.get(weekKey) || 0) + shift.net_minutes);
  }
  
  // Calculate extras per week
  const contractMinutesPerWeek = contractHours * 60;
  let totalExtras = 0;
  
  for (const workedMinutes of weekMap.values()) {
    totalExtras += Math.max(0, workedMinutes - contractMinutesPerWeek);
  }
  
  return totalExtras;
}

/**
 * SSOT UNIQUE: Compute R-Extra balance for employees (all-time)
 * 
 * Formula: RExtra = detected - paid - consumed
 */
async function computeRextraBalanceForUsers(
  client: AnyClient,
  establishmentId: string,
  userIds: string[]
): Promise<Record<string, number>> {
  if (userIds.length === 0) {
    return {};
  }
  
  const result: Record<string, number> = {};
  
  // Initialize all users with zero
  for (const userId of userIds) {
    result[userId] = 0;
  }
  
  // 1. Fetch ALL planning shifts (all-time)
  const { data: shifts } = await client
    .from("planning_shifts")
    .select("user_id, shift_date, net_minutes")
    .eq("establishment_id", establishmentId)
    .in("user_id", userIds);
  
  // 2. Fetch employee contracts for hourly rate and contract hours
  const { data: contracts } = await client
    .from("employee_details")
    .select("user_id, contract_hours, total_salary")
    .in("user_id", userIds);
  
  const contractMap = new Map<string, { contractHours: number; totalSalary: number }>();
  for (const c of contracts || []) {
    contractMap.set(c.user_id, {
      contractHours: c.contract_hours || 35,
      totalSalary: c.total_salary || 0,
    });
  }
  
  // 3. Fetch ALL approved extra_events (badge extras, all-time)
  const { data: extraEvents } = await client
    .from("extra_events")
    .select("user_id, extra_minutes")
    .eq("establishment_id", establishmentId)
    .eq("status", "approved")
    .in("user_id", userIds);
  
  // 4. Fetch ALL payroll validations (extras_paid_eur, all-time)
  const { data: validations } = await client
    .from("payroll_employee_month_validation")
    .select("user_id, year_month, extras_paid_eur")
    .eq("establishment_id", establishmentId)
    .in("user_id", userIds);
  
  // 5. Fetch ALL R-Extra consumed (planning_rextra_events, all-time)
  const { data: rextraEvents } = await client
    .from("planning_rextra_events")
    .select("user_id, minutes")
    .eq("establishment_id", establishmentId)
    .in("user_id", userIds);
  
  // Group shifts by user
  const shiftsByUser = new Map<string, Array<{ shift_date: string; net_minutes: number }>>();
  for (const shift of shifts || []) {
    if (!shiftsByUser.has(shift.user_id)) {
      shiftsByUser.set(shift.user_id, []);
    }
    shiftsByUser.get(shift.user_id)!.push(shift);
  }
  
  // Calculate balance for each user
  for (const userId of userIds) {
    const userContract = contractMap.get(userId) || { contractHours: 35, totalSalary: 0 };
    const userShifts = shiftsByUser.get(userId) || [];
    
    // === 1. DETECTED: Planning extras (weekly calculation) ===
    const planningExtras = calculateWeeklyExtras(userShifts, userContract.contractHours);
    
    // === 2. DETECTED: Badge extras ===
    const badgeExtras = (extraEvents || [])
      .filter((e) => e.user_id === userId)
      .reduce((sum, e) => sum + (e.extra_minutes || 0), 0);
    
    const detectedMinutes = planningExtras + badgeExtras;
    
    // === 3. PAID: Convert € to minutes ===
    const monthlyHours = userContract.contractHours * WEEKS_PER_MONTH;
    const hourlyRate = monthlyHours > 0 ? userContract.totalSalary / monthlyHours : 0;
    
    let paidMinutes = 0;
    const userValidations = (validations || []).filter((v) => v.user_id === userId);
    for (const v of userValidations) {
      if (v.extras_paid_eur != null && v.extras_paid_eur > 0 && hourlyRate > 0) {
        paidMinutes += Math.round((v.extras_paid_eur / hourlyRate) * 60);
      }
    }
    
    // === 4. CONSUMED: R-Extra events ===
    const consumedMinutes = (rextraEvents || [])
      .filter((e) => e.user_id === userId)
      .reduce((sum, e) => sum + (e.minutes || 0), 0);
    
    // === FORMULA: RExtra = detected - paid - consumed ===
    result[userId] = Math.max(0, detectedMinutes - paidMinutes - consumedMinutes);
  }
  
  return result;
}

interface RequestPayload {
  action: "get_balances";
  establishment_id: string;
  user_ids: string[];
}

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

    // Admin client for data queries (service role for bypassing RLS)
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
    const payload: RequestPayload = await req.json();
    const { action, establishment_id, user_ids } = payload;

    // Validate action
    if (action !== "get_balances") {
      return new Response(
        JSON.stringify({ error: "Invalid action. Expected: get_balances" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Validate required fields
    if (!establishment_id || !user_ids || !Array.isArray(user_ids)) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: establishment_id, user_ids (array)" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Rate limit check (after auth, before business logic)
    const rateLimited = await checkRateLimit(req, supabaseAdmin, { max: 30, keyPrefix: "payroll-rextra-balance" });
    if (rateLimited) return rateLimited;

    // RBAC: Check paie:read access on establishment
    const { data: hasAccess, error: accessError } = await supabaseUser.rpc("has_module_access", {
      _module_key: "paie",
      _min_level: "read",
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
        JSON.stringify({ error: "Forbidden: paie:read access required for this establishment" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    log.info("get_balances", { user_id: user.id, establishment_id, employee_count: user_ids.length });

    // Calculate R-Extra balances (SSOT unique)
    const balances = await computeRextraBalanceForUsers(
      supabaseAdmin,
      establishment_id,
      user_ids
    );

    log.info("completed", { establishment_id, user_count: user_ids?.length });
    return new Response(
      JSON.stringify({ success: true, data: { rextraBalanceByEmployee: balances } }),
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

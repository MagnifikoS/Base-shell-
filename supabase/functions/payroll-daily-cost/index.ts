/**
 * payroll-daily-cost Edge Function
 * 
 * Secure server-side calculation of daily payroll cost.
 * Returns ONLY aggregated cost (no employee details, no salaries).
 * 
 * RBAC: Requires 'planning' module access (read or write) for the establishment.
 * 
 * @see memory/features/cash/daily-payroll-indicators
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("payroll-daily-cost");
const CORS = makeCorsHeaders("POST, OPTIONS");

// ─────────────────────────────────────────────────────────────────────────────
// Payroll Engine Constants (mirrored from src/lib/payroll/payroll.compute.ts)
// ─────────────────────────────────────────────────────────────────────────────

const WEEKS_PER_MONTH = 4.33;

function computeMonthlyHours(contractHoursWeekly: number): number {
  return contractHoursWeekly * WEEKS_PER_MONTH;
}

function computeHourlyRate(grossSalary: number, monthlyHours: number): number {
  if (monthlyHours <= 0) return 0;
  return grossSalary / monthlyHours;
}

function computePlanningPayrollCost(totalNetMinutes: number, hourlyRate: number): number {
  if (totalNetMinutes <= 0 || hourlyRate <= 0) return 0;
  return Math.round(((totalNetMinutes / 60) * hourlyRate) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    log.info("Request received");

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Auth: Extract and validate JWT
    // ─────────────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      log.warn("Missing or invalid authorization header");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User client (for RBAC check)
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Admin client (for reading employee_details - bypasses RLS)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Validate JWT
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      log.warn("Auth failed");
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Rate limit check (after auth, before business logic)
    const rateLimited = await checkRateLimit(req, supabaseAdmin, { max: 30, keyPrefix: "payroll-daily-cost" });
    if (rateLimited) return rateLimited;

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Parse Input
    // ─────────────────────────────────────────────────────────────────────────
    const body = await req.json();
    const { establishment_id, day_date } = body;

    if (!establishment_id || typeof establishment_id !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid establishment_id" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!day_date || !/^\d{4}-\d{2}-\d{2}$/.test(day_date)) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid day_date (YYYY-MM-DD)" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. RBAC Check: User must have planning access for this establishment
    // ─────────────────────────────────────────────────────────────────────────
    const { data: hasAccess, error: accessError } = await supabaseUser.rpc(
      "has_module_access",
      {
        _module_key: "planning",
        _min_level: "read",
        _establishment_id: establishment_id,
      }
    );

    if (accessError) {
      log.error("RBAC check error", accessError);
      return new Response(
        JSON.stringify({ error: "Authorization check failed" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!hasAccess) {
      return new Response(
        JSON.stringify({ error: "Forbidden: no planning access for this establishment" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Fetch planning_shifts for the day (scoped to establishment)
    // ─────────────────────────────────────────────────────────────────────────
    const { data: shifts, error: shiftError } = await supabaseAdmin
      .from("planning_shifts")
      .select("user_id, net_minutes")
      .eq("establishment_id", establishment_id)
      .eq("shift_date", day_date);

    if (shiftError) {
      log.error("Shifts query error", shiftError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch planning shifts" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!shifts || shifts.length === 0) {
      // No shifts = no cost
      return new Response(
        JSON.stringify({ cost_day_eur: 0 }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Aggregate net_minutes by user
    const netMinutesByUser = new Map<string, number>();
    const userIds: string[] = [];

    for (const s of shifts) {
      const current = netMinutesByUser.get(s.user_id) || 0;
      netMinutesByUser.set(s.user_id, current + (s.net_minutes || 0));
      if (!userIds.includes(s.user_id)) {
        userIds.push(s.user_id);
      }
    }

    if (userIds.length === 0) {
      return new Response(
        JSON.stringify({ cost_day_eur: 0 }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Fetch employee_details (ADMIN CLIENT - bypasses RLS)
    // ─────────────────────────────────────────────────────────────────────────
    const { data: contracts, error: contractError } = await supabaseAdmin
      .from("employee_details")
      .select("user_id, gross_salary, contract_hours")
      .in("user_id", userIds);

    if (contractError) {
      log.error("Contracts query error", contractError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch contract data" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Build contract map
    const contractMap = new Map(
      (contracts || []).map((c) => [
        c.user_id,
        {
          gross_salary: c.gross_salary ?? 0,
          contract_hours: c.contract_hours ?? 0,
        },
      ])
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Compute aggregated cost (NO INDIVIDUAL DATA IN RESPONSE)
    // ─────────────────────────────────────────────────────────────────────────
    let totalCost = 0;

    for (const [userId, userNetMinutes] of netMinutesByUser) {
      const contract = contractMap.get(userId);

      // Skip if no valid contract data
      if (!contract || contract.gross_salary <= 0 || contract.contract_hours <= 0) {
        continue;
      }

      const monthlyHours = computeMonthlyHours(contract.contract_hours);
      const hourlyRate = computeHourlyRate(contract.gross_salary, monthlyHours);
      const userCost = computePlanningPayrollCost(userNetMinutes, hourlyRate);

      totalCost += userCost;
    }

    // Round final result
    totalCost = Math.round(totalCost * 100) / 100;

    // ─────────────────────────────────────────────────────────────────────────
    // 7. Return ONLY aggregated cost
    // ─────────────────────────────────────────────────────────────────────────
    log.info("completed", { establishment_id, day_date, cost_day_eur: totalCost, employees: userIds.length });

    return new Response(
      JSON.stringify({ cost_day_eur: totalCost }),
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

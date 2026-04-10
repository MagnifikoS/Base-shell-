import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

type AnyClient = SupabaseClient;

const log = createLogger("planning-rextra");
const CORS = makeCorsHeaders("POST, OPTIONS");

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 R-EXTRA: Edge Function planning-rextra
// Actions: set_rextra, clear_rextra
// RBAC: planning:write required, no bypass
// 
// SSOT UNIQUE: Balance = detected - paid - consumed (all-time, no monthly carry)
// NO writes to extras_deferred_minutes
// ═══════════════════════════════════════════════════════════════════════════

/** Conversion factor: weeks per month (French labor law: 52/12) */
const WEEKS_PER_MONTH = 52 / 12;

/**
 * Calculate weekly extras from shifts (same logic as payroll engine)
 */
function calculateWeeklyExtras(
  shifts: Array<{ shift_date: string; net_minutes: number }>,
  contractHours: number
): number {
  const weekMap = new Map<string, number>();
  
  for (const shift of shifts) {
    const date = new Date(shift.shift_date + "T12:00:00Z");
    const dayOfWeek = date.getDay();
    
    const monday = new Date(date);
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    monday.setDate(monday.getDate() + daysToMonday);
    
    const weekKey = monday.toISOString().slice(0, 10);
    weekMap.set(weekKey, (weekMap.get(weekKey) || 0) + shift.net_minutes);
  }
  
  const contractMinutesPerWeek = contractHours * 60;
  let totalExtras = 0;
  
  for (const workedMinutes of weekMap.values()) {
    totalExtras += Math.max(0, workedMinutes - contractMinutesPerWeek);
  }
  
  return totalExtras;
}

/**
 * SSOT UNIQUE: Compute R-Extra balance for a single user
 * Formula: RExtra = detected - paid - consumed (all-time)
 */
async function computeRextraBalanceForUser(
  client: AnyClient,
  establishmentId: string,
  userId: string
): Promise<number> {
  // 1. Fetch ALL planning shifts
  const { data: shifts } = await client
    .from("planning_shifts")
    .select("shift_date, net_minutes")
    .eq("establishment_id", establishmentId)
    .eq("user_id", userId);
  
  // 2. Fetch employee contract
  const { data: contract } = await client
    .from("employee_details")
    .select("contract_hours, total_salary")
    .eq("user_id", userId)
    .maybeSingle();
  
  const contractHours = contract?.contract_hours || 35;
  const totalSalary = contract?.total_salary || 0;
  
  // 3. Fetch ALL approved extra_events
  const { data: extraEvents } = await client
    .from("extra_events")
    .select("extra_minutes")
    .eq("establishment_id", establishmentId)
    .eq("user_id", userId)
    .eq("status", "approved");
  
  // 4. Fetch ALL payroll validations (extras_paid_eur)
  const { data: validations } = await client
    .from("payroll_employee_month_validation")
    .select("extras_paid_eur")
    .eq("establishment_id", establishmentId)
    .eq("user_id", userId);
  
  // 5. Fetch ALL R-Extra consumed
  const { data: rextraEvents } = await client
    .from("planning_rextra_events")
    .select("minutes")
    .eq("establishment_id", establishmentId)
    .eq("user_id", userId);
  
  // === DETECTED ===
  const planningExtras = calculateWeeklyExtras(shifts || [], contractHours);
  const badgeExtras = (extraEvents || []).reduce((sum, e) => sum + (e.extra_minutes || 0), 0);
  const detectedMinutes = planningExtras + badgeExtras;
  
  // === PAID ===
  const monthlyHours = contractHours * WEEKS_PER_MONTH;
  const hourlyRate = monthlyHours > 0 ? totalSalary / monthlyHours : 0;
  
  let paidMinutes = 0;
  for (const v of validations || []) {
    if (v.extras_paid_eur != null && v.extras_paid_eur > 0 && hourlyRate > 0) {
      paidMinutes += Math.round((v.extras_paid_eur / hourlyRate) * 60);
    }
  }
  
  // === CONSUMED ===
  const consumedMinutes = (rextraEvents || []).reduce((sum, e) => sum + (e.minutes || 0), 0);
  
  // === FORMULA ===
  return Math.max(0, detectedMinutes - paidMinutes - consumedMinutes);
}

// ═══════════════════════════════════════════════════════════════════════════
// EDGE FUNCTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

interface SetRextraBody {
  action: "set_rextra";
  establishment_id: string;
  user_id: string;
  event_date: string;
  minutes: number;
}

interface ClearRextraBody {
  action: "clear_rextra";
  establishment_id: string;
  user_id: string;
  event_date: string;
}

type RequestBody = SetRextraBody | ClearRextraBody;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    log.info("Request received");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      log.warn("Missing authorization header");
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // SEC-05: User client uses ANON_KEY + JWT (not SERVICE_ROLE_KEY)
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Admin client for mutations (service role for bypassing RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      log.warn("Auth failed");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }
    const callerUserId = user.id;

    // Rate limit check (after auth, before business logic)
    const rateLimited = await checkRateLimit(req, adminClient, { max: 30, keyPrefix: "planning-rextra" });
    if (rateLimited) return rateLimited;

    const body: RequestBody = await req.json();
    const { action, establishment_id, user_id, event_date } = body;

    log.info("handle_request", { user_id: callerUserId, action, establishment_id, target_user_id: user_id, event_date });

    // RBAC check: planning:write required
    const { data: hasAccess, error: accessError } = await userClient.rpc("has_module_access", {
      _module_key: "planning",
      _min_level: "write",
      _establishment_id: establishment_id,
    });

    if (accessError) {
      log.error("RBAC check error", accessError);
      return new Response(
        JSON.stringify({ error: "Permission check failed" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!hasAccess) {
      return new Response(
        JSON.stringify({ error: "Forbidden: planning write access required" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { data: orgId, error: orgError } = await userClient.rpc("get_user_organization_id");
    if (orgError || !orgId) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: set_rextra
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "set_rextra") {
      const { minutes } = body as SetRextraBody;

      if (!minutes || minutes <= 0) {
        return new Response(
          JSON.stringify({ error: "Minutes must be > 0" }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Calculate current balance on-the-fly (SSOT UNIQUE)
      const currentBalance = await computeRextraBalanceForUser(adminClient, establishment_id, user_id);

      // Check if existing R.Extra on this day (for delta calculation)
      const { data: existingRextra } = await adminClient
        .from("planning_rextra_events")
        .select("id, minutes")
        .eq("establishment_id", establishment_id)
        .eq("user_id", user_id)
        .eq("event_date", event_date)
        .maybeSingle();

      const previousMinutes = existingRextra?.minutes ?? 0;
      const availableForThisDay = currentBalance + previousMinutes;

      if (minutes > availableForThisDay) {
        return new Response(
          JSON.stringify({ 
            error: "INSUFFICIENT_BALANCE",
            message: `Solde insuffisant. Disponible: ${availableForThisDay} min, demandé: ${minutes} min`,
            available: availableForThisDay,
            requested: minutes
          }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Check no leave exists
      const { data: existingLeave } = await adminClient
        .from("personnel_leaves")
        .select("id, leave_type")
        .eq("establishment_id", establishment_id)
        .eq("user_id", user_id)
        .eq("leave_date", event_date)
        .eq("status", "approved")
        .maybeSingle();

      if (existingLeave) {
        return new Response(
          JSON.stringify({ 
            error: "LEAVE_EXISTS",
            message: `Un congé (${existingLeave.leave_type}) existe déjà ce jour. Annulez-le d'abord.`
          }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Delete any existing shifts (Phase 1: exclusive)
      const { data: deletedShifts } = await adminClient
        .from("planning_shifts")
        .delete()
        .eq("establishment_id", establishment_id)
        .eq("user_id", user_id)
        .eq("shift_date", event_date)
        .select("id");

      const deletedShiftsCount = deletedShifts?.length ?? 0;

      // Upsert planning_rextra_events
      const { error: upsertError } = await adminClient
        .from("planning_rextra_events")
        .upsert({
          organization_id: orgId,
          establishment_id,
          user_id,
          event_date,
          minutes,
          created_by: callerUserId,
        }, {
          onConflict: "establishment_id,user_id,event_date",
        });

      if (upsertError) {
        log.error("Upsert R.Extra error", upsertError);
        return new Response(
          JSON.stringify({ error: "Failed to create R.Extra" }),
          { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      const newBalance = availableForThisDay - minutes;

      log.info("completed", { action: "set_rextra", user_id, event_date, minutes });
      return new Response(
        JSON.stringify({
          success: true,
          action: "set_rextra",
          minutes,
          previous_minutes: previousMinutes,
          new_balance: newBalance,
          deleted_shifts_count: deletedShiftsCount,
        }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: clear_rextra
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "clear_rextra") {
      const { data: existingRextra, error: fetchError } = await adminClient
        .from("planning_rextra_events")
        .select("id, minutes")
        .eq("establishment_id", establishment_id)
        .eq("user_id", user_id)
        .eq("event_date", event_date)
        .maybeSingle();

      if (fetchError) {
        log.error("Fetch R.Extra error", fetchError);
        return new Response(
          JSON.stringify({ error: "Failed to fetch R.Extra" }),
          { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      if (!existingRextra) {
        return new Response(
          JSON.stringify({ error: "R.Extra not found for this date" }),
          { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      const minutesToCredit = existingRextra.minutes;

      const { error: deleteError } = await adminClient
        .from("planning_rextra_events")
        .delete()
        .eq("id", existingRextra.id);

      if (deleteError) {
        log.error("Delete R.Extra error", deleteError);
        return new Response(
          JSON.stringify({ error: "Failed to delete R.Extra" }),
          { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Calculate new balance after clearing
      const newBalance = await computeRextraBalanceForUser(adminClient, establishment_id, user_id);

      return new Response(
        JSON.stringify({
          success: true,
          action: "clear_rextra",
          credited_minutes: minutesToCredit,
          new_balance: newBalance,
        }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (error) {
    log.error("Unhandled error", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});

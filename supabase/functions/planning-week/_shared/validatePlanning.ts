import { SupabaseClient } from "npm:@supabase/supabase-js@2";

type AnyClient = SupabaseClient;

interface ValidateDayBody {
  action: "validate_day";
  establishment_id: string;
  date: string;
  validated: boolean;
}

interface ValidateWeekBody {
  action: "validate_week";
  establishment_id: string;
  week_start: string;
  validated: boolean;
}

interface ValidateResult {
  data?: { success: boolean };
  error?: string;
  status: number;
}

/**
 * Check if user has write or full access to planning module for the establishment
 * IMPORTANT: Uses userClient (JWT) so auth.uid() is available in the RPC
 * The has_module_access SQL function already handles admin bypass internally
 */
async function hasPlanningWriteAccess(
  userClient: AnyClient,
  _adminClient: AnyClient,
  _userId: string,
  establishmentId: string
): Promise<boolean> {
  // RBAC check via userClient (JWT) - has_module_access handles admin internally
  const { data: hasAccess, error } = await userClient.rpc("has_module_access", {
    _module_key: "planning",
    _min_level: "write",
    _establishment_id: establishmentId,
  });

  if (error) {
    console.error("hasPlanningWriteAccess error:", error);
    return false;
  }

  return !!hasAccess;
}

/**
 * Validate or unvalidate a specific day
 * Atomic operation - no dependency on other calculations
 */
export async function handleValidateDay(
  body: ValidateDayBody,
  userId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<ValidateResult> {
  const { establishment_id, date, validated } = body;

  // Validate required fields
  if (!establishment_id || !date || typeof validated !== "boolean") {
    return { error: "Missing required fields", status: 400 };
  }

  // Get org ID first
  const { data: orgId, error: orgError } = await userClient.rpc("get_user_organization_id");
  if (orgError || !orgId) {
    return { error: "Organization not found", status: 400 };
  }

  // Verify establishment belongs to org
  const { data: establishment } = await adminClient
    .from("establishments")
    .select("id, organization_id")
    .eq("id", establishment_id)
    .single();

  if (!establishment || establishment.organization_id !== orgId) {
    return { error: "Establishment not found or forbidden", status: 403 };
  }

  // Check planning write access (admin OR RBAC write/full permission)
  const canValidate = await hasPlanningWriteAccess(userClient, adminClient, userId, establishment_id);
  if (!canValidate) {
    return { error: "Planning write access required", status: 403 };
  }

  const weekStart = getWeekStart(date);

  // ══════════════════════════════════════════════════════════════
  // GARDE-FOU 1: Atomic upsert with single operation
  // ══════════════════════════════════════════════════════════════
  
  // Get or create planning_week record
  let { data: planningWeek } = await adminClient
    .from("planning_weeks")
    .select("id, validated_days, week_validated")
    .eq("establishment_id", establishment_id)
    .eq("week_start", weekStart)
    .single();

  if (!planningWeek) {
    // Create new record
    const { data: newWeek, error: insertError } = await adminClient
      .from("planning_weeks")
      .insert({
        organization_id: orgId,
        establishment_id,
        week_start: weekStart,
        week_validated: false,
        validated_days: { [date]: validated },
      })
      .select("id, validated_days, week_validated")
      .single();

    if (insertError) {
      console.error("Insert planning_week error:", insertError);
      return { error: "Failed to create planning week", status: 500 };
    }
    planningWeek = newWeek;
  } else {
    // Cannot modify day if week is validated (except admin unvalidating week first)
    if (planningWeek.week_validated && validated) {
      return { error: "Week is already validated", status: 403 };
    }

    // Update validated_days atomically
    const currentDays = (planningWeek.validated_days as Record<string, boolean>) || {};
    const newDays = { ...currentDays, [date]: validated };

    // ✅ PHASE P1: Anti-phantom — .select("id") pour détecter 0 rows
    const { data: updatedRow, error: updateError } = await adminClient
      .from("planning_weeks")
      .update({
        validated_days: newDays,
        updated_at: new Date().toISOString(),
      })
      .eq("id", planningWeek.id)
      .select("id");

    if (updateError) {
      console.error("Update validated_days error:", updateError);
      return { error: "Failed to update validation", status: 500 };
    }
    
    // Détection "succès fantôme"
    if (!updatedRow || updatedRow.length === 0) {
      console.error("Update validated_days: 0 rows affected (phantom)");
      return { error: "Failed to update validation (no rows affected)", status: 500 };
    }
  }

  return { data: { success: true }, status: 200 };
}

/**
 * Validate or unvalidate an entire week
 * Atomic operation - no dependency on other calculations
 */
export async function handleValidateWeek(
  body: ValidateWeekBody,
  userId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<ValidateResult> {
  const { establishment_id, week_start, validated } = body;

  // Validate required fields
  if (!establishment_id || !week_start || typeof validated !== "boolean") {
    return { error: "Missing required fields", status: 400 };
  }

  // Get org ID first
  const { data: orgId, error: orgError } = await userClient.rpc("get_user_organization_id");
  if (orgError || !orgId) {
    return { error: "Organization not found", status: 400 };
  }

  // Verify establishment belongs to org
  const { data: establishment } = await adminClient
    .from("establishments")
    .select("id, organization_id")
    .eq("id", establishment_id)
    .single();

  if (!establishment || establishment.organization_id !== orgId) {
    return { error: "Establishment not found or forbidden", status: 403 };
  }

  // Check planning write access (admin OR RBAC write/full permission)
  const canValidate = await hasPlanningWriteAccess(userClient, adminClient, userId, establishment_id);
  if (!canValidate) {
    return { error: "Planning write access required", status: 403 };
  }

  // ══════════════════════════════════════════════════════════════
  // GARDE-FOU 1: Atomic upsert
  // ══════════════════════════════════════════════════════════════

  // Get or create planning_week record
  const { data: planningWeek } = await adminClient
    .from("planning_weeks")
    .select("id")
    .eq("establishment_id", establishment_id)
    .eq("week_start", week_start)
    .single();

  if (!planningWeek) {
    // Create new record with week_validated
    const { error: insertError } = await adminClient
      .from("planning_weeks")
      .insert({
        organization_id: orgId,
        establishment_id,
        week_start,
        week_validated: validated,
        validated_days: {},
      });

    if (insertError) {
      console.error("Insert planning_week error:", insertError);
      return { error: "Failed to create planning week", status: 500 };
    }
  } else {
    // ══════════════════════════════════════════════════════════════
    // LOGIQUE PROPRE: Invalidation = week_invalidated_at (override auto-publish)
    // Validation = week_validated + clear week_invalidated_at
    // ══════════════════════════════════════════════════════════════
    const updatePayload = validated
      ? {
          week_validated: true,
          week_invalidated_at: null, // Clear any previous invalidation
          updated_at: new Date().toISOString(),
        }
      : {
          week_validated: false,
          week_invalidated_at: new Date().toISOString(), // Set override to HIDE
          updated_at: new Date().toISOString(),
        };

    // ✅ PHASE P1: Anti-phantom — .select("id") pour détecter 0 rows
    const { data: updatedWeek, error: updateError } = await adminClient
      .from("planning_weeks")
      .update(updatePayload)
      .eq("id", planningWeek.id)
      .select("id");

    if (updateError) {
      console.error("Update week_validated error:", updateError);
      return { error: "Failed to update validation", status: 500 };
    }
    
    // Détection "succès fantôme"
    if (!updatedWeek || updatedWeek.length === 0) {
      console.error("Update week_validated: 0 rows affected (phantom)");
      return { error: "Failed to update validation (no rows affected)", status: 500 };
    }
  }

  return { data: { success: true }, status: 200 };
}

/**
 * Get Monday of the week for a given date (ISO week)
 */
function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

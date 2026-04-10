import { createClient } from "npm:@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";
import { handleGetWeek } from "./_shared/getWeek.ts";
import { handleCreateShift } from "./_shared/createShift.ts";
import { handleUpdateShift } from "./_shared/updateShift.ts";
import { handleDeleteShift } from "./_shared/deleteShift.ts";
import { handleValidateDay, handleValidateWeek } from "./_shared/validatePlanning.ts";
import { handleMarkLeave, type MarkLeaveBody } from "./_shared/markLeave.ts";
import { handleCancelLeave, type CancelLeaveBody } from "./_shared/cancelLeave.ts";
import { handleUpdateLeave, type UpdateLeaveBody } from "./_shared/updateLeave.ts";
import {
  handleDeleteWeekShifts,
  handleDeleteEmployeeWeekShifts,
  handleCopyPreviousWeek,
  type DeleteWeekShiftsBody,
  type DeleteEmployeeWeekShiftsBody,
  type CopyPreviousWeekBody,
} from "./_shared/bulkActions.ts";

import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const log = createLogger("planning-week");
const corsHeaders = makeCorsHeaders("POST, OPTIONS");

interface GetWeekBody {
  action: "get_week";
  establishment_id: string;
  week_start: string;
  /** Optional team-based scope filter: when provided, only employees belonging to these teams are returned.
   *  This is intersected with the user's RBAC scope (never broadens access). */
  team_ids?: string[];
}

interface CreateShiftBody {
  action: "create_shift";
  establishment_id: string;
  shift_date: string;
  user_id: string;
  start_time: string;
  end_time: string;
}

interface UpdateShiftBody {
  action: "update_shift";
  establishment_id: string;
  shift_id: string;
  start_time: string;
  end_time: string;
}

interface DeleteShiftBody {
  action: "delete_shift";
  establishment_id: string;
  shift_id: string;
}

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

type RequestBody =
  | GetWeekBody
  | CreateShiftBody
  | UpdateShiftBody
  | DeleteShiftBody
  | ValidateDayBody
  | ValidateWeekBody
  | MarkLeaveBody
  | CancelLeaveBody
  | UpdateLeaveBody
  | DeleteWeekShiftsBody
  | DeleteEmployeeWeekShiftsBody
  | CopyPreviousWeekBody;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(error: string, status = 400): Response {
  return jsonResponse({ error }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      log.warn("Missing authorization header");
      return errorResponse("Authorization header required", 401);
    }

    if (!authHeader.startsWith("Bearer ")) {
      log.warn("Invalid authorization header format");
      return errorResponse("Authorization header must be a Bearer token", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      log.error("Auth getUser failed", authError);
      return errorResponse("Unauthorized", 401);
    }

    // Rate limit: 60 req/min per IP
    const rateLimited = await checkRateLimit(req, adminClient, { max: 60, keyPrefix: "planning-week" });
    if (rateLimited) return rateLimited;

    const userId = user.id;

    const body: RequestBody = await req.json();

    log.info("handle_request", { user_id: userId, action: body.action, establishment_id: (body as { establishment_id?: string }).establishment_id });

    if (body.action === "get_week") {
      const result = await handleGetWeek(body, userId, userClient, adminClient);
      if (result.error) {
        return errorResponse(result.error, result.status);
      }
      log.info("completed", { action: "get_week" });
      return jsonResponse(result.data, result.status);
    }

    if (body.action === "create_shift") {
      const result = await handleCreateShift(body, userId, userClient, adminClient);
      if (result.error) {
        return errorResponse(result.error, result.status);
      }
      return jsonResponse(result.data, result.status);
    }

    if (body.action === "update_shift") {
      const result = await handleUpdateShift(body, userId, userClient, adminClient);
      if (result.error) {
        return errorResponse(result.error, result.status);
      }
      return jsonResponse(result.data, result.status);
    }

    if (body.action === "delete_shift") {
      const result = await handleDeleteShift(body, userId, userClient, adminClient);
      if (result.error) {
        return errorResponse(result.error, result.status);
      }
      return jsonResponse(result.data, result.status);
    }

    if (body.action === "validate_day") {
      const result = await handleValidateDay(body, userId, userClient, adminClient);
      if (result.error) {
        return errorResponse(result.error, result.status);
      }
      return jsonResponse(result.data, result.status);
    }

    if (body.action === "validate_week") {
      const result = await handleValidateWeek(body, userId, userClient, adminClient);
      if (result.error) {
        return errorResponse(result.error, result.status);
      }
      return jsonResponse(result.data, result.status);
    }

    if (body.action === "mark_leave") {
      const result = await handleMarkLeave(body, userId, userClient, adminClient);
      if (result.error) {
        return errorResponse(result.error, result.status);
      }
      return jsonResponse(result.data, result.status);
    }

    if (body.action === "cancel_leave") {
      const result = await handleCancelLeave(body, userId, userClient, adminClient);
      if (result.error) {
        return errorResponse(result.error, result.status);
      }
      return jsonResponse(result.data, result.status);
    }

    if (body.action === "update_leave") {
      const result = await handleUpdateLeave(body, userId, userClient, adminClient);
      if (result.error) {
        return errorResponse(result.error, result.status);
      }
      return jsonResponse(result.data, result.status);
    }

    // Bulk actions
    if (body.action === "delete_week_shifts") {
      const result = await handleDeleteWeekShifts(body, userId, userClient, adminClient);
      if (result.error) {
        return errorResponse(result.error, result.status);
      }
      return jsonResponse(result.data, result.status);
    }

    if (body.action === "delete_employee_week_shifts") {
      const result = await handleDeleteEmployeeWeekShifts(body, userId, userClient, adminClient);
      if (result.error) {
        return errorResponse(result.error, result.status);
      }
      return jsonResponse(result.data, result.status);
    }

    if (body.action === "copy_previous_week") {
      const result = await handleCopyPreviousWeek(body, userId, userClient, adminClient);
      if (result.error) {
        return errorResponse(result.error, result.status);
      }
      return jsonResponse(result.data, result.status);
    }

    return errorResponse("Invalid action");
  } catch (error: unknown) {
    log.error("Unhandled error", error);
    return errorResponse("Internal server error", 500);
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("establishment-breaks");
const CORS = makeCorsHeaders("POST, OPTIONS");

// DURATION type
interface DurationBreakRule {
  min_shift_minutes: number;
  break_minutes: number;
}

interface DurationBreakPolicy {
  type: "DURATION";
  paid_break: boolean;
  rules: DurationBreakRule[];
  rounding: "none" | "5min" | "15min";
  apply: "largest_match";
}

// TIMEPOINTS type
interface TimepointBreakRule {
  time: string; // HH:mm format
  break_minutes: number;
}

interface TimepointBreakPolicy {
  type: "TIMEPOINTS";
  rules: TimepointBreakRule[];
  apply_if: "SHIFT_START_LT_T_AND_SHIFT_END_GT_T";
}

type BreakPolicy = DurationBreakPolicy | TimepointBreakPolicy;

interface ValidationResult {
  valid: boolean;
  errors: string[];
  policy: BreakPolicy | null;
}

// Validate TIMEPOINTS policy
function validateTimepointPolicy(policy: TimepointBreakPolicy): string[] {
  const errors: string[] = [];
  const validBreakMinutes = [0, 15, 30, 45, 60];
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

  if (!policy.rules || policy.rules.length === 0) {
    errors.push("Au moins une règle est requise.");
    return errors;
  }

  if (policy.rules.length > 6) {
    errors.push("Maximum 6 règles autorisées.");
  }

  const seenTimes = new Set<string>();
  for (const rule of policy.rules) {
    if (!timeRegex.test(rule.time)) {
      errors.push(`Format d'heure invalide: ${rule.time}`);
    }
    if (!validBreakMinutes.includes(rule.break_minutes)) {
      errors.push(`Durée de pause invalide: ${rule.break_minutes} (0, 15, 30, 45, 60 autorisés)`);
    }
    if (seenTimes.has(rule.time)) {
      errors.push(`Heure en doublon: ${rule.time}`);
    }
    seenTimes.add(rule.time);
  }

  return errors;
}

// Parse French text into structured DURATION break policy
function parseBreakRulesFromText(inputText: string): ValidationResult {
  const lines = inputText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const errors: string[] = [];
  const rules: DurationBreakRule[] = [];
  let paidBreak = true; // default

  for (const line of lines) {
    const lowerLine = line.toLowerCase();

    // Check for paid/unpaid break
    if (lowerLine.includes("non payée") || lowerLine.includes("non payé") || lowerLine.includes("non-payée")) {
      paidBreak = false;
      continue;
    }
    if (lowerLine.includes("payée") || lowerLine.includes("payé")) {
      paidBreak = true;
      continue;
    }

    // Check for "no break if shift < X"
    const noBreakMatch = lowerLine.match(/pas de pause.*(?:shift|durée)?.*<\s*(\d+)\s*h/i);
    if (noBreakMatch) {
      continue;
    }

    // Check for shift duration -> break duration rules
    const ruleMatch = lowerLine.match(
      /(?:si\s+)?(?:shift|durée|travail)?\s*(?:>=?|≥|supérieur[e]?\s+(?:ou\s+égal[e]?\s+)?[àa]?)\s*(\d+)\s*h\s*(\d+)?\s*(?:min)?\s*(?:alors|=>|→|:)?\s*(?:pause)?\s*(\d+)\s*(?:min|minutes)?/i
    );

    if (ruleMatch) {
      const hours = parseInt(ruleMatch[1], 10);
      const minutes = ruleMatch[2] ? parseInt(ruleMatch[2], 10) : 0;
      const breakMinutes = parseInt(ruleMatch[3], 10);
      const minShiftMinutes = hours * 60 + minutes;

      if (breakMinutes < 0) {
        errors.push(`Pause négative non autorisée: "${line}"`);
        continue;
      }
      if (breakMinutes > minShiftMinutes) {
        errors.push(`Pause (${breakMinutes}min) > durée shift (${minShiftMinutes}min): "${line}"`);
        continue;
      }

      rules.push({ min_shift_minutes: minShiftMinutes, break_minutes: breakMinutes });
      continue;
    }

    // Alternative pattern: "6h -> 30 min"
    const simpleMatch = lowerLine.match(/(\d+)\s*h\s*(\d+)?\s*(?:min)?\s*(?:->|→|:|=>)\s*(\d+)\s*(?:min)?/i);
    if (simpleMatch) {
      const hours = parseInt(simpleMatch[1], 10);
      const minutes = simpleMatch[2] ? parseInt(simpleMatch[2], 10) : 0;
      const breakMinutes = parseInt(simpleMatch[3], 10);
      const minShiftMinutes = hours * 60 + minutes;

      if (breakMinutes < 0) {
        errors.push(`Pause négative non autorisée: "${line}"`);
        continue;
      }

      rules.push({ min_shift_minutes: minShiftMinutes, break_minutes: breakMinutes });
      continue;
    }

    if (lowerLine.length > 0 && !lowerLine.includes("pause") && !lowerLine.includes("break")) {
      errors.push(`Ligne non reconnue: "${line}"`);
    }
  }

  // Sort rules by min_shift_minutes ascending
  rules.sort((a, b) => a.min_shift_minutes - b.min_shift_minutes);

  // Check for duplicates
  const seen = new Set<number>();
  for (const rule of rules) {
    if (seen.has(rule.min_shift_minutes)) {
      errors.push(`Doublon: plusieurs règles pour ${Math.floor(rule.min_shift_minutes / 60)}h${rule.min_shift_minutes % 60 || ""}`);
    }
    seen.add(rule.min_shift_minutes);
  }

  if (rules.length === 0 && errors.length === 0) {
    errors.push("Aucune règle de pause détectée dans le texte.");
  }

  const policy: DurationBreakPolicy = {
    type: "DURATION",
    paid_break: paidBreak,
    rules,
    rounding: "none",
    apply: "largest_match",
  };

  return {
    valid: errors.length === 0,
    errors,
    policy: errors.length === 0 ? policy : policy,
  };
}

// Calculate break for DURATION policy
function calculateBreak(policy: DurationBreakPolicy, shiftMinutes: number): { breakMinutes: number; netMinutes: number } {
  let breakMinutes = 0;

  for (const rule of policy.rules) {
    if (shiftMinutes >= rule.min_shift_minutes) {
      breakMinutes = rule.break_minutes;
    }
  }

  const netMinutes = shiftMinutes - breakMinutes;
  return { breakMinutes, netMinutes };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    log.info("Request received");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      log.warn("Missing authorization header");
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // User client for RBAC checks (uses auth.uid())
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      log.warn("Auth failed");
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    // Rate limit check (after auth, before business logic)
    const rateLimited = await checkRateLimit(req, adminClient, { max: 30, keyPrefix: "establishment-breaks" });
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const { action, establishment_id, input_text, policy_id, shift_minutes, policy_json } = body;

    log.info("handle_request", { user_id: userId, action, establishment_id });

    // ═══════════════════════════════════════════════════════════════════════
    // RBAC CHECK - has_module_access('parametres', 'write', establishment_id)
    // All actions require admin/manager access (write on parametres)
    // ═══════════════════════════════════════════════════════════════════════
    if (establishment_id) {
      const { data: hasAccess, error: rbacErr } = await userClient.rpc("has_module_access", {
        _module_key: "parametres",
        _min_level: "write",
        _establishment_id: establishment_id,
      });

      if (rbacErr) {
        log.error("RBAC check error", rbacErr);
        return new Response(JSON.stringify({ error: "Authorization check failed" }), {
          status: 500,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      if (!hasAccess) {
        log.warn("access_denied", { user_id: userId, establishment_id, action });
        return new Response(JSON.stringify({ error: "NOT_AUTHORIZED" }), {
          status: 403,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
    }

    // ACTION: list
    if (action === "list") {
      if (!establishment_id) {
        return new Response(JSON.stringify({ error: "establishment_id required" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await adminClient
        .from("establishment_break_policies")
        .select("*")
        .eq("establishment_id", establishment_id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return new Response(JSON.stringify({ policies: data || [] }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ACTION: analyze (no DB, just parse and validate)
    if (action === "analyze") {
      if (!input_text) {
        return new Response(JSON.stringify({ error: "input_text required" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const result = parseBreakRulesFromText(input_text);

      return new Response(JSON.stringify(result), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ACTION: test (calculate break for a shift duration, no DB)
    if (action === "test") {
      if (!input_text || shift_minutes === undefined) {
        return new Response(JSON.stringify({ error: "input_text and shift_minutes required" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const parseResult = parseBreakRulesFromText(input_text);
      if (!parseResult.policy || parseResult.policy.type !== "DURATION") {
        return new Response(JSON.stringify({ error: "Invalid policy or non-DURATION type", errors: parseResult.errors }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const result = calculateBreak(parseResult.policy, shift_minutes);
      return new Response(JSON.stringify(result), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ACTION: create_timepoint (save TIMEPOINTS policy inactive)
    if (action === "create_timepoint") {
      if (!establishment_id || !policy_json) {
        return new Response(JSON.stringify({ error: "establishment_id and policy_json required" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // Validate TIMEPOINTS policy
      if (policy_json.type !== "TIMEPOINTS") {
        return new Response(JSON.stringify({ error: "policy_json must be TIMEPOINTS type" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const validationErrors = validateTimepointPolicy(policy_json as TimepointBreakPolicy);
      if (validationErrors.length > 0) {
        return new Response(JSON.stringify({ error: "Invalid policy", errors: validationErrors }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // Get max version
      const { data: existing } = await adminClient
        .from("establishment_break_policies")
        .select("version")
        .eq("establishment_id", establishment_id)
        .order("version", { ascending: false })
        .limit(1);

      const nextVersion = existing && existing.length > 0 ? existing[0].version + 1 : 1;

      const { data, error } = await adminClient
        .from("establishment_break_policies")
        .insert({
          establishment_id,
          version: nextVersion,
          is_active: false,
          input_text: input_text || "",
          policy_json: policy_json,
          created_by: userId,
        })
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ policy: data }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ACTION: create (save inactive)
    if (action === "create") {
      if (!establishment_id || !input_text) {
        return new Response(JSON.stringify({ error: "establishment_id and input_text required" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const parseResult = parseBreakRulesFromText(input_text);
      if (!parseResult.valid || !parseResult.policy) {
        return new Response(JSON.stringify({ error: "Invalid policy", errors: parseResult.errors }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // Get max version for this establishment
      const { data: existing } = await adminClient
        .from("establishment_break_policies")
        .select("version")
        .eq("establishment_id", establishment_id)
        .order("version", { ascending: false })
        .limit(1);

      const nextVersion = existing && existing.length > 0 ? existing[0].version + 1 : 1;

      const { data, error } = await adminClient
        .from("establishment_break_policies")
        .insert({
          establishment_id,
          version: nextVersion,
          is_active: false,
          input_text,
          policy_json: parseResult.policy,
          created_by: userId,
        })
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ policy: data }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ACTION: activate (atomic: deactivate others, activate this one)
    if (action === "activate") {
      if (!policy_id) {
        return new Response(JSON.stringify({ error: "policy_id required" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // Get the policy to find establishment_id and current state
      const { data: targetPolicy, error: fetchError } = await adminClient
        .from("establishment_break_policies")
        .select("establishment_id, is_active")
        .eq("id", policy_id)
        .single();

      if (fetchError || !targetPolicy) {
        return new Response(JSON.stringify({ error: "Policy not found" }), {
          status: 404,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // Idempotent: if already active, return success immediately
      if (targetPolicy.is_active) {
        const { data } = await adminClient
          .from("establishment_break_policies")
          .select("*")
          .eq("id", policy_id)
          .single();
        return new Response(JSON.stringify({ policy: data }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      try {
        // Deactivate all others for this establishment
        await adminClient
          .from("establishment_break_policies")
          .update({ is_active: false })
          .eq("establishment_id", targetPolicy.establishment_id)
          .eq("is_active", true);

        // Activate the target
        const { data, error } = await adminClient
          .from("establishment_break_policies")
          .update({ is_active: true })
          .eq("id", policy_id)
          .select()
          .single();

        if (error) {
          // Handle unique constraint violation (race condition)
          if (error.code === "23505") {
            return new Response(JSON.stringify({ error: "Activation conflict, retry" }), {
              status: 409,
              headers: { ...CORS, "Content-Type": "application/json" },
            });
          }
          throw error;
        }

        return new Response(JSON.stringify({ policy: data }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      } catch (activateError: unknown) {
        // Catch any race condition or constraint error
        const errMessage = activateError instanceof Error ? activateError.message : "";
        if (errMessage.includes("unique") || errMessage.includes("duplicate") || errMessage.includes("constraint")) {
          return new Response(JSON.stringify({ error: "Activation conflict, retry" }), {
            status: 409,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        throw activateError;
      }
    }

    // ACTION: deactivate
    if (action === "deactivate") {
      if (!policy_id) {
        return new Response(JSON.stringify({ error: "policy_id required" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await adminClient
        .from("establishment_break_policies")
        .update({ is_active: false })
        .eq("id", policy_id)
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ policy: data }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ACTION: delete
    if (action === "delete") {
      if (!policy_id) {
        return new Response(JSON.stringify({ error: "policy_id required" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // SEC-DATA-031: Audit log BEFORE deletion
      await adminClient.from("audit_logs").insert({
        user_id: userId,
        action: "hard_delete:establishment_break_policies",
        target_type: "establishment_break_policies",
        target_id: policy_id,
        metadata: {
          establishment_id,
          reason: "User-initiated break policy deletion",
        },
        ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
        user_agent: req.headers.get("user-agent") || null,
      });

      const { error } = await adminClient
        .from("establishment_break_policies")
        .delete()
        .eq("id", policy_id);

      if (error) throw error;

      log.info("completed", { action, establishment_id });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    log.error("Unhandled error", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

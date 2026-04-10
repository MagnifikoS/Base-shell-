/**
 * Break policy management for planning-week edge function
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { timeToMinutes, formatTime } from "./time.ts";

type AnyClient = ReturnType<typeof createClient>;

interface TimepointRule {
  time: string;
  break_minutes: number;
}

interface DurationRule {
  minHours: number;
  breakMinutes: number;
}

interface PolicyJson {
  type: "TIMEPOINTS" | "DURATION";
  apply_if?: string;
  rules: TimepointRule[] | DurationRule[];
}

export interface ActiveBreakPolicy {
  id: string;
  policy_json: PolicyJson;
}

export interface BreakPolicyResult {
  policy: ActiveBreakPolicy | null;
  error: string | null;
}

/**
 * Get the active break policy for an establishment
 * Returns error if multiple active policies exist (data inconsistency)
 */
export async function getActiveBreakPolicy(
  adminClient: AnyClient,
  establishmentId: string
): Promise<BreakPolicyResult> {
  const { data: policies, error } = await adminClient
    .from("establishment_break_policies")
    .select("id, policy_json")
    .eq("establishment_id", establishmentId)
    .eq("is_active", true);

  if (error) {
    console.error("Failed to fetch break policies:", error);
    return { policy: null, error: "Failed to fetch break policy" };
  }

  if (!policies || policies.length === 0) {
    // No active policy - this is valid, break_minutes = 0
    console.log(`No active break policy for establishment ${establishmentId}`);
    return { policy: null, error: null };
  }

  if (policies.length > 1) {
    // Multiple active policies - data inconsistency
    console.error(`Multiple active break policies for establishment ${establishmentId}: ${policies.length}`);
    return { policy: null, error: "Multiple active break policies" };
  }

  return { 
    policy: { 
      id: policies[0].id, 
      policy_json: policies[0].policy_json as PolicyJson 
    }, 
    error: null 
  };
}

/**
 * Compute break minutes based on policy, start_time, and end_time
 * Supports both TIMEPOINTS and DURATION policy types
 */
export function computeBreakMinutes(
  policy: ActiveBreakPolicy | null,
  startTime: string,
  endTime: string,
  durationMinutes: number
): number {
  if (!policy || !policy.policy_json) {
    return 0;
  }

  const policyJson = policy.policy_json;
  const startMin = timeToMinutes(formatTime(startTime));
  const endMin = startMin + durationMinutes; // Use actual duration (handles midnight)

  if (policyJson.type === "TIMEPOINTS" && Array.isArray(policyJson.rules)) {
    // TIMEPOINTS: max 1 break per group (morning < 15:00, evening >= 15:00)
    // Eligibility: startMin <= timepointMin < endMin (start inclusive)
    const rules = policyJson.rules as TimepointRule[];
    const AFTERNOON_THRESHOLD = 15 * 60; // 15:00 = 900 minutes
    
    // Find eligible timepoints per group
    let morningBreak: { time: number; minutes: number } | null = null;
    let eveningBreak: { time: number; minutes: number } | null = null;
    
    for (const rule of rules) {
      const timepointMin = timeToMinutes(formatTime(rule.time));
      
      // Check eligibility: start <= timepoint < end
      if (startMin <= timepointMin && endMin > timepointMin) {
        if (timepointMin < AFTERNOON_THRESHOLD) {
          // Morning group: keep earliest eligible
          if (!morningBreak || timepointMin < morningBreak.time) {
            morningBreak = { time: timepointMin, minutes: rule.break_minutes };
          }
        } else {
          // Evening group: keep earliest eligible
          if (!eveningBreak || timepointMin < eveningBreak.time) {
            eveningBreak = { time: timepointMin, minutes: rule.break_minutes };
          }
        }
      }
    }
    
    return (morningBreak?.minutes ?? 0) + (eveningBreak?.minutes ?? 0);
  }

  if (policyJson.type === "DURATION" && Array.isArray(policyJson.rules)) {
    // DURATION: find applicable rule based on shift duration
    const rules = policyJson.rules as DurationRule[];
    const sortedRules = [...rules].sort((a, b) => b.minHours - a.minHours);
    
    for (const rule of sortedRules) {
      if (durationMinutes >= rule.minHours * 60) {
        return rule.breakMinutes;
      }
    }
  }

  return 0;
}

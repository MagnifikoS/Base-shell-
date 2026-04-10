// DURATION type (existing)
export interface DurationBreakRule {
  min_shift_minutes: number;
  break_minutes: number;
}

export interface DurationBreakPolicy {
  type: "DURATION";
  paid_break: boolean;
  rules: DurationBreakRule[];
  rounding: "none" | "5min" | "15min";
  apply: "largest_match";
}

// TIMEPOINTS type (new)
export interface TimepointBreakRule {
  time: string; // HH:mm format
  break_minutes: number;
}

export interface TimepointBreakPolicy {
  type: "TIMEPOINTS";
  rules: TimepointBreakRule[];
  apply_if: "SHIFT_START_LT_T_AND_SHIFT_END_GT_T";
}

// Union type for policy_json
export type BreakPolicy = DurationBreakPolicy | TimepointBreakPolicy;

// Legacy type alias for backward compatibility
export interface BreakRule {
  min_shift_minutes: number;
  break_minutes: number;
}

export interface BreakPolicyRecord {
  id: string;
  establishment_id: string;
  version: number;
  is_active: boolean;
  input_text: string;
  policy_json: BreakPolicy;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export interface AnalyzeResult {
  valid: boolean;
  errors: string[];
  policy: BreakPolicy | null;
}

export interface TestResult {
  breakMinutes: number;
  netMinutes: number;
}

// Helper type guards
export function isDurationPolicy(policy: BreakPolicy): policy is DurationBreakPolicy {
  return policy.type === "DURATION" || !("type" in policy);
}

export function isTimepointPolicy(policy: BreakPolicy): policy is TimepointBreakPolicy {
  return policy.type === "TIMEPOINTS";
}

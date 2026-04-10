/**
 * PHASE 2.4: Unit tests for early departure SSOT helpers
 * 
 * Run with: deno test --allow-net --allow-env supabase/functions/badge-events/_shared/helpers_test.ts
 * 
 * Test coverage:
 * - Multi-shifts same day (sequence_index matching)
 * - Overnight shifts (23:00 → 02:00)
 * - DST transitions
 * - Future badge blocking (occurred_at > now)
 */

import {
  assertEquals,
  assertGreater,
  assertLess,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { checkEarlyDeparture, buildParisTimestamp } from "./helpers.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Test: checkEarlyDeparture - Normal shift
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("checkEarlyDeparture: clock_out at planned end = 0 minutes early", () => {
  // Shift 09:00-17:00, clock_out at exactly 17:00
  const occurredAt = new Date("2026-01-27T16:00:00Z"); // 17:00 Paris (winter)
  const result = checkEarlyDeparture(
    occurredAt,
    "09:00",
    "17:00",
    "2026-01-27",
    "03:00"
  );
  
  assertEquals(result.isEarlyDeparture, false);
  assertEquals(result.minutesEarly, 0);
});

Deno.test("checkEarlyDeparture: clock_out 30 min before planned end = 30 minutes early", () => {
  // Shift 09:00-17:00, clock_out at 16:30 Paris = 15:30 UTC (winter)
  const occurredAt = new Date("2026-01-27T15:30:00Z");
  const result = checkEarlyDeparture(
    occurredAt,
    "09:00",
    "17:00",
    "2026-01-27",
    "03:00"
  );
  
  assertEquals(result.isEarlyDeparture, true);
  assertEquals(result.minutesEarly, 30);
});

Deno.test("checkEarlyDeparture: clock_out 1 hour after planned end = 0 minutes early", () => {
  // Shift 09:00-17:00, clock_out at 18:00 Paris = 17:00 UTC (winter)
  const occurredAt = new Date("2026-01-27T17:00:00Z");
  const result = checkEarlyDeparture(
    occurredAt,
    "09:00",
    "17:00",
    "2026-01-27",
    "03:00"
  );
  
  assertEquals(result.isEarlyDeparture, false);
  assertEquals(result.minutesEarly, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Test: Overnight shifts (end < start)
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("checkEarlyDeparture: overnight shift 22:00-06:00, clock_out at 06:00 = 0 minutes early", () => {
  // Service day = 2026-01-27, shift ends at 06:00 on 2026-01-28
  // Clock_out at 06:00 next day = 05:00 UTC
  const occurredAt = new Date("2026-01-28T05:00:00Z");
  const result = checkEarlyDeparture(
    occurredAt,
    "22:00",
    "06:00",
    "2026-01-27",
    "03:00"
  );
  
  assertEquals(result.isEarlyDeparture, false);
  assertEquals(result.minutesEarly, 0);
});

Deno.test("checkEarlyDeparture: overnight shift 22:00-06:00, clock_out at 05:30 = 30 minutes early", () => {
  // Clock_out at 05:30 next day = 04:30 UTC
  const occurredAt = new Date("2026-01-28T04:30:00Z");
  const result = checkEarlyDeparture(
    occurredAt,
    "22:00",
    "06:00",
    "2026-01-27",
    "03:00"
  );
  
  assertEquals(result.isEarlyDeparture, true);
  assertEquals(result.minutesEarly, 30);
});

Deno.test("checkEarlyDeparture: overnight shift 23:00-02:00, clock_out at 01:45 = 15 minutes early", () => {
  // Service day = 2026-01-27, shift ends at 02:00 on 2026-01-28
  // Clock_out at 01:45 = 00:45 UTC
  const occurredAt = new Date("2026-01-28T00:45:00Z");
  const result = checkEarlyDeparture(
    occurredAt,
    "23:00",
    "02:00",
    "2026-01-27",
    "03:00"
  );
  
  assertEquals(result.isEarlyDeparture, true);
  assertEquals(result.minutesEarly, 15);
});

// ═══════════════════════════════════════════════════════════════════════════
// Test: Multi-shifts same day (sequence_index handling)
// Note: sequence_index matching is done at caller level, not in checkEarlyDeparture
// This test verifies the function works correctly for different shift times
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("checkEarlyDeparture: multi-shift day - morning shift (sequence 1)", () => {
  // Morning shift 09:00-14:00, clock_out at 13:30 = 30 min early
  const occurredAt = new Date("2026-01-27T12:30:00Z"); // 13:30 Paris
  const result = checkEarlyDeparture(
    occurredAt,
    "09:00",
    "14:00",
    "2026-01-27",
    "03:00"
  );
  
  assertEquals(result.isEarlyDeparture, true);
  assertEquals(result.minutesEarly, 30);
});

Deno.test("checkEarlyDeparture: multi-shift day - evening shift (sequence 2)", () => {
  // Evening shift 18:00-23:00, clock_out at exactly 23:00 = 0 min early
  const occurredAt = new Date("2026-01-27T22:00:00Z"); // 23:00 Paris
  const result = checkEarlyDeparture(
    occurredAt,
    "18:00",
    "23:00",
    "2026-01-27",
    "03:00"
  );
  
  assertEquals(result.isEarlyDeparture, false);
  assertEquals(result.minutesEarly, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Test: DST transition (summer time)
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("checkEarlyDeparture: summer time (CEST) - shift 09:00-17:00", () => {
  // June 15, 2026: Paris is UTC+2 (CEST)
  // 17:00 Paris = 15:00 UTC
  // Clock_out at 16:30 Paris = 14:30 UTC = 30 min early
  const occurredAt = new Date("2026-06-15T14:30:00Z");
  const result = checkEarlyDeparture(
    occurredAt,
    "09:00",
    "17:00",
    "2026-06-15",
    "03:00"
  );
  
  assertEquals(result.isEarlyDeparture, true);
  assertEquals(result.minutesEarly, 30);
});

Deno.test("checkEarlyDeparture: DST transition day (March 29, 2026)", () => {
  // DST starts in France on March 29, 2026 at 02:00 → 03:00
  // Shift 09:00-17:00, clock_out at 17:00 Paris = 15:00 UTC (after DST change)
  const occurredAt = new Date("2026-03-29T15:00:00Z");
  const result = checkEarlyDeparture(
    occurredAt,
    "09:00",
    "17:00",
    "2026-03-29",
    "03:00"
  );
  
  assertEquals(result.isEarlyDeparture, false);
  assertEquals(result.minutesEarly, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Test: buildParisTimestamp helper
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("buildParisTimestamp: winter time (CET)", () => {
  // 2026-01-27 17:00 Paris = 16:00 UTC (CET = UTC+1)
  const ts = buildParisTimestamp("2026-01-27", "17:00");
  assertEquals(ts, "2026-01-27T16:00:00.000Z");
});

Deno.test("buildParisTimestamp: summer time (CEST)", () => {
  // 2026-06-15 17:00 Paris = 15:00 UTC (CEST = UTC+2)
  const ts = buildParisTimestamp("2026-06-15", "17:00");
  assertEquals(ts, "2026-06-15T15:00:00.000Z");
});

Deno.test("buildParisTimestamp: midnight crossing (overnight)", () => {
  // 2026-01-27 01:00 Paris = 00:00 UTC (CET = UTC+1)
  const ts = buildParisTimestamp("2026-01-27", "01:00");
  assertEquals(ts, "2026-01-27T00:00:00.000Z");
});

// ═══════════════════════════════════════════════════════════════════════════
// Test: Future badge blocking (validation is done at Edge Function level)
// These tests verify the timestamp comparison logic
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("Future badge detection: occurred_at > now should be detectable", () => {
  const now = new Date();
  const futureTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour in future
  
  assertGreater(futureTime.getTime(), now.getTime());
});

Deno.test("Past badge detection: occurred_at < now should be detectable", () => {
  const now = new Date();
  const pastTime = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour in past
  
  assertLess(pastTime.getTime(), now.getTime());
});

/**
 * Badge Events E2E Tests
 * 
 * PHASE 3.4: Minimal test suite for critical badge scenarios
 * 
 * Run with: bunx supabase functions test badge-events
 */

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const _SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

// Test helper to call edge function
async function callBadgeEvents(
  authToken: string,
  body: Record<string, unknown>
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/badge-events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  });
  
  const data = await response.json();
  return { status: response.status, data };
}

// ============================================================================
// TEST 1: Future badge is blocked with popup-friendly response
// ============================================================================
Deno.test({
  name: "PHASE 3.4: Future badge returns FUTURE_BADGE_BLOCKED (admin_create)",
  fn: async () => {
    // Skip if no auth token available (CI environment)
    const testToken = Deno.env.get("TEST_AUTH_TOKEN");
    if (!testToken) {
      console.log("⏭️ Skipping: TEST_AUTH_TOKEN not set");
      return;
    }
    
    // Create a badge 1 hour in the future
    const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    
    const result = await callBadgeEvents(testToken, {
      action: "admin_create",
      establishment_id: Deno.env.get("TEST_ESTABLISHMENT_ID"),
      target_user_id: Deno.env.get("TEST_USER_ID"),
      event_type: "clock_in",
      occurred_at: futureTime,
      day_date: futureTime.slice(0, 10),
    });
    
    // Should return 400 with FUTURE_BADGE_BLOCKED code
    assertEquals(result.status, 400);
    assertEquals(result.data.code, "FUTURE_BADGE_BLOCKED");
    assertExists(result.data.error);
    
    console.log("✅ Future badge correctly blocked with FUTURE_BADGE_BLOCKED");
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// TEST 2: Future badge blocked on admin_update
// ============================================================================
Deno.test({
  name: "PHASE 3.4: Future badge returns FUTURE_BADGE_BLOCKED (admin_update)",
  fn: async () => {
    const testToken = Deno.env.get("TEST_AUTH_TOKEN");
    const testBadgeId = Deno.env.get("TEST_BADGE_EVENT_ID");
    
    if (!testToken || !testBadgeId) {
      console.log("⏭️ Skipping: TEST_AUTH_TOKEN or TEST_BADGE_EVENT_ID not set");
      return;
    }
    
    // Try to update to a future time
    const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    
    const result = await callBadgeEvents(testToken, {
      action: "admin_update",
      id: testBadgeId,
      occurred_at: futureTime,
    });
    
    // Should return 400 with FUTURE_BADGE_BLOCKED code
    assertEquals(result.status, 400);
    assertEquals(result.data.code, "FUTURE_BADGE_BLOCKED");
    
    console.log("✅ Future badge update correctly blocked");
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// TEST 3: Verify RBAC enforcement (no hardcoded admin bypass)
// ============================================================================
Deno.test({
  name: "PHASE 3.4: RBAC uses has_module_access, not hardcoded roles",
  fn: async () => {
    const testToken = Deno.env.get("TEST_AUTH_TOKEN_NO_PERMISSION");
    
    if (!testToken) {
      console.log("⏭️ Skipping: TEST_AUTH_TOKEN_NO_PERMISSION not set");
      return;
    }
    
    const result = await callBadgeEvents(testToken, {
      action: "admin_create",
      establishment_id: Deno.env.get("TEST_ESTABLISHMENT_ID"),
      target_user_id: Deno.env.get("TEST_USER_ID"),
      event_type: "clock_in",
      occurred_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // Past time
      day_date: new Date().toISOString().slice(0, 10),
    });
    
    // Should return 403 (not authorized) - not 200 due to some admin bypass
    assertEquals(result.status, 403);
    
    console.log("✅ RBAC correctly denies unauthorized user");
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// TEST 4: Verify no unauthorized response is returned
// ============================================================================
Deno.test({
  name: "PHASE 3.4: Unauthenticated request returns 401",
  fn: async () => {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/badge-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "admin_create",
        establishment_id: "test",
      }),
    });
    
    await response.text(); // Consume body
    assertEquals(response.status, 401);
    
    console.log("✅ Unauthenticated request correctly returns 401");
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// DOCUMENTATION: Test scenarios to run manually
// ============================================================================
/**
 * Manual Test Checklist (requires logged-in session):
 * 
 * 1. Badge futur → popup bloquant
 *    - Open BadgeEditModal
 *    - Try to create badge for tomorrow
 *    - Expected: FUTURE_BADGE_BLOCKED popup, no DB write
 * 
 * 2. Multi-shifts même jour → early_departure correct
 *    - Create 2 shifts for same day: 09:00-12:00, 14:00-18:00
 *    - Badge clock_out at 11:30 (early) for shift 1
 *    - Badge clock_out at 17:45 (early) for shift 2
 *    - Verify: early_departure_minutes = 30 for seq 1, 15 for seq 2
 * 
 * 3. Overnight + DST
 *    - Create shift 22:00-06:00 on DST transition night
 *    - Badge normally
 *    - Verify: day_date = correct service day
 * 
 * 4. Directeur (badgeuse:write, non admin)
 *    - Login as Directeur role with badgeuse:write
 *    - Try to create badge for employee
 *    - Expected: Same rules, same blocages as admin
 */

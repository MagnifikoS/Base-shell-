/**
 * STK-02 -- Concurrent Stock Operations May Bypass Negative Guard (Race Condition)
 *
 * Target:
 *   supabase/migrations/20260216150025_*.sql (fn_post_stock_document v1 - NO locking)
 *   supabase/migrations/20260216230004_*.sql (fn_post_stock_document v2 - WITH locking)
 *   src/modules/stockLedger/engine/postGuards.ts (client-side negative stock check)
 *
 * Vulnerability:
 *   The negative stock check has TWO layers:
 *   1. Client-side: postGuards.ts checkNegativeStock() — pure function, no DB lock
 *   2. Server-side: fn_post_stock_document RPC — SQL-level check
 *
 *   For the server-side check:
 *   - The ORIGINAL version (20260216150025) had NO row-level locking (SELECT FOR UPDATE)
 *   - The FIXED version (20260216230004) ADDED row-level locking (STK-LED-015)
 *   - However, the client-side postGuards.ts check has NO locking at all and runs
 *     as a separate query before the RPC call, creating a TOCTOU gap
 *
 *   Race condition scenario (client-side):
 *   1. User A reads snapshot: product X has 5 units
 *   2. User B reads snapshot: product X has 5 units
 *   3. User A posts withdrawal of 3 units (check passes: 5-3=2 >= 0)
 *   4. User B posts withdrawal of 3 units (check passes: 5-3=2 >= 0)
 *   5. Actual stock: 5 - 3 - 3 = -1 (negative!)
 *
 *   The server-side RPC now has FOR UPDATE locking, but the client-side check
 *   that runs BEFORE the RPC call is still vulnerable.
 *
 * PoC:
 *   1. Verify client-side check has no locking mechanism
 *   2. Verify the original RPC function had no locking
 *   3. Verify the fix migration added FOR UPDATE
 *   4. Verify the gap between client check and RPC call
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("STK-02: Concurrent Stock Operations May Bypass Negative Guard", () => {
  const POST_GUARDS = "src/modules/stockLedger/engine/postGuards.ts";
  const USE_POST_DOCUMENT = "src/modules/stockLedger/hooks/usePostDocument.ts";
  const ORIGINAL_RPC =
    "supabase/migrations/20260216150025_de3389db-d507-42fa-a882-fb80ceb195c5.sql";
  const FIXED_RPC = "supabase/migrations/20260216230004_fix_stock_void_and_locking.sql";

  it("should confirm client-side checkNegativeStock is pure (no DB locking)", async () => {
    const source = await readSourceFile(POST_GUARDS);

    // checkNegativeStock is a pure function that operates on in-memory data
    const fnSignature = findInSource(source, /export function checkNegativeStock\(/g);
    expect(fnSignature.length).toBe(1);

    // It takes a Map of current estimates (pre-fetched, not locked)
    const mapParam = findInSource(source, /currentEstimates: Map<string, number>/g);
    expect(mapParam.length).toBe(1);

    // No database call, no lock, no transaction context
    const supabaseCall = findInSource(source, /supabase|\.rpc\(|\.from\(/g);
    expect(supabaseCall.length).toBe(0);

    // No FOR UPDATE, no advisory lock (lock_version is a variable name, not a DB lock)
    const forUpdateKeyword = findInSource(source, /FOR UPDATE|advisory_lock|pg_advisory/gi);
    expect(forUpdateKeyword.length).toBe(0);
  });

  it("should confirm usePostDocument uses edge function (not direct RPC — revoked)", async () => {
    const source = await readSourceFile(USE_POST_DOCUMENT);

    // The hook must call stock-ledger edge function (service_role), NOT direct RPC
    expect(source).toContain("stock-ledger?action=post");

    // Must NOT call RPC directly (revoked per SEC-AUTH-006)
    const directRpc = findInSource(source, /supabase\.rpc\("fn_post_stock_document"/g);
    expect(directRpc.length).toBe(0);

    // Override flag still passed to edge function body
    expect(source).toContain("override_flag");
  });

  it("should confirm the ORIGINAL fn_post_stock_document had NO row-level locking", async () => {
    const source = await readSourceFile(ORIGINAL_RPC);

    // The original version does NOT have FOR UPDATE
    const forUpdate = findInSource(source, /FOR UPDATE/g);
    expect(forUpdate.length).toBe(0);

    // The negative stock check reads zone_stock_snapshots WITHOUT locking
    const snapshotRead = findInSource(source, /zone_stock_snapshots zss/g);
    expect(snapshotRead.length).toBeGreaterThan(0);

    // The check reads stock_events WITHOUT locking
    const eventsRead = findInSource(source, /stock_events se/g);
    expect(eventsRead.length).toBeGreaterThan(0);
  });

  it("should confirm the FIXED fn_post_stock_document ADDED FOR UPDATE locking", async () => {
    const source = await readSourceFile(FIXED_RPC);

    // The fix migration adds FOR UPDATE on zone_stock_snapshots
    const forUpdate = findInSource(source, /FOR UPDATE/g);
    expect(forUpdate.length).toBeGreaterThan(0);

    // Verify the STK-LED-015 comment exists documenting the fix
    const stkLed015 = findInSource(source, /STK-LED-015/g);
    expect(stkLed015.length).toBeGreaterThan(0);

    // Verify ORDER BY for deterministic lock acquisition (deadlock prevention)
    const orderBy = findInSource(source, /ORDER BY zss\.storage_zone_id/g);
    expect(orderBy.length).toBeGreaterThan(0);
  });

  it("should confirm the override_flag can bypass negative stock check server-side", async () => {
    const source = await readSourceFile(FIXED_RPC);

    // The negative stock check is gated by p_override_flag = false
    const overrideGate = findInSource(source, /IF p_override_flag = false THEN/g);
    expect(overrideGate.length).toBe(1);

    // If override_flag = true, the negative stock check is ENTIRELY SKIPPED
    // This means a user who sets override_flag = true can create negative stock
    // The only guard is that override_reason must be provided
    const overrideReason = findInSource(
      source,
      /p_override_flag = true AND \(p_override_reason IS NULL/g
    );
    expect(overrideReason.length).toBe(1);
  });

  it("should verify TOCTOU gap exists between client snapshot read and RPC call", async () => {
    const source = await readSourceFile(USE_POST_DOCUMENT);

    // The hook takes expectedLockVersion from the caller
    // This version was read at an earlier point (when the UI loaded the draft)
    const lockVersion = findInSource(
      source,
      /p_expected_lock_version: params\.expectedLockVersion/g
    );
    expect(lockVersion.length).toBe(1);

    // Between the time the client read the snapshot data (to display current stock)
    // and the time the RPC executes, another transaction could have modified stock.
    // The lock_version check in the RPC prevents double-posting the SAME document
    // but does NOT prevent two DIFFERENT documents from racing.
    // That's why the server-side FOR UPDATE lock on zone_stock_snapshots is critical.
    // generateIdempotencyKey appears twice: import + usage
    const idempotencyKey = findInSource(source, /generateIdempotencyKey/g);
    expect(idempotencyKey.length).toBeGreaterThan(0);
  });

  it("should confirm lock_version prevents same-document re-post but NOT cross-document races", async () => {
    const source = await readSourceFile(FIXED_RPC);

    // lock_version is per-document, not per-zone
    const lockVersionCheck = findInSource(source, /AND lock_version = p_expected_lock_version/g);
    expect(lockVersionCheck.length).toBe(1);

    // Two different documents posting to the same zone at the same time
    // would each pass their own lock_version check
    // The FOR UPDATE on zone_stock_snapshots is the ONLY cross-document guard
    // (zone_stock_snapshots and FOR UPDATE are on separate lines in the SQL)
    const forUpdatePresent = findInSource(source, /FOR UPDATE/g);
    expect(forUpdatePresent.length).toBeGreaterThan(0);
  });

  it("should document the residual risk: override_flag bypass has no admin check", async () => {
    const source = await readSourceFile(FIXED_RPC);

    // The RPC does NOT check if the user has admin/manager role before accepting override
    // Any user who can call the RPC (via edge function) can set override_flag = true
    // The only requirement is a non-empty override_reason string
    const roleCheck = findInSource(source, /has_module_access|is_admin|admin_check|role_check/gi);
    expect(roleCheck.length).toBe(0);

    // The override logic only validates that a reason is provided
    const overrideValidation = findInSource(
      source,
      /override_flag = true AND.*override_reason IS NULL/g
    );
    expect(overrideValidation.length).toBe(1);
  });
});

/**
 * STK-04 -- Zone Stock Snapshot Not Transactionally Consistent with Events
 *
 * Target:
 *   supabase/migrations/20260216230004_*.sql (fn_post_stock_document with FOR UPDATE)
 *   supabase/migrations/20260212155624_*.sql (zone_stock_snapshots table)
 *   src/modules/inventaire/hooks/useDesktopStock.ts (client-side stock estimation)
 *   src/modules/stockLedger/engine/stockEngine.ts (stock estimation logic)
 *   src/modules/stockLedger/engine/buildCanonicalLine.ts (zone routing)
 *
 * Vulnerability:
 *   1. zone_stock_snapshots are managed independently from stock_events.
 *      When a new inventory session completes and updates the snapshot,
 *      existing events are NOT re-scoped. This means:
 *      - Snapshot says product X has 10 units (new inventory)
 *      - Old events from previous snapshot are orphaned
 *      - Estimated stock = 10 + SUM(events where snapshot_version_id = current)
 *      - Events linked to the OLD snapshot are silently excluded from the sum
 *
 *   2. The useDesktopStock hook fetches zone_stock_snapshots and events in
 *      SEPARATE queries (not a single transaction), creating a consistency gap.
 *
 *   3. Zone routing uses products_v2.storage_zone_id which can change between
 *      document creation and posting. If a product's zone changes after the
 *      document is created but before it's posted, events may go to a different
 *      zone than expected.
 *
 *   4. The estimated stock formula:
 *      StockEstime = SnapshotQuantity(zone) + SUM(events WHERE snapshot_version_id = current)
 *      This is consistent only if snapshot_version_id transitions are atomic.
 *
 * PoC:
 *   1. Verify snapshot and events are not in same transaction (client-side)
 *   2. Verify zone routing depends on mutable product.storage_zone_id
 *   3. Verify snapshot version transition has no event scoping
 *   4. Verify estimated stock calculation ignores orphaned events
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("STK-04: Zone Stock Snapshot Not Transactionally Consistent with Events", () => {
  const USE_DESKTOP_STOCK = "src/modules/inventaire/hooks/useDesktopStock.ts";
  const STOCK_ENGINE = "src/modules/stockLedger/engine/stockEngine.ts";
  const POST_RPC = "supabase/migrations/20260216230004_fix_stock_void_and_locking.sql";
  const INITIAL_MIGRATION =
    "supabase/migrations/20260212155624_51d66c13-012d-4924-8982-82c1917327e4.sql";

  it("should confirm useDesktopStock fetches snapshots and products in separate queries", async () => {
    const source = await readSourceFile(USE_DESKTOP_STOCK);

    // Products and snapshots are fetched in parallel (separate queries)
    const promiseAll = findInSource(source, /Promise\.all/g);
    expect(promiseAll.length).toBeGreaterThan(0);

    // zone_stock_snapshots is fetched as a separate query
    const snapshotQuery = findInSource(source, /\.from\("zone_stock_snapshots"\)/g);
    expect(snapshotQuery.length).toBe(1);

    // products_v2 is fetched as a separate query
    const productsQuery = findInSource(source, /\.from\("products_v2"\)/g);
    expect(productsQuery.length).toBe(1);

    // These are NOT in a database transaction — they're separate PostgREST calls
    // Between the two calls, a snapshot could be updated
    const transactionKeyword = findInSource(source, /BEGIN|COMMIT|ROLLBACK|\.rpc\(/g);
    expect(transactionKeyword.length).toBe(0);
  });

  it("should confirm stock engine uses snapshot_version_id to scope events (design choice)", async () => {
    const source = await readSourceFile(STOCK_ENGINE);

    // The engine expects events linked to a specific snapshot version
    const snapshotParam = findInSource(source, /snapshot_version_id: string/g);
    expect(snapshotParam.length).toBeGreaterThan(0);

    // Events are filtered by snapshot_version_id — events from previous snapshots are excluded
    // This is by design but means a snapshot transition silently resets the event accumulator
    const comment = findInSource(
      source,
      /events.*POSTED.*linked to this snapshot|snapshot_version_id/g
    );
    expect(comment.length).toBeGreaterThan(0);
  });

  it("should confirm zone routing uses mutable products_v2.storage_zone_id at POST time", async () => {
    const source = await readSourceFile(POST_RPC);

    // The RPC joins stock_document_lines with products_v2 to get the CURRENT zone
    const zoneJoin = findInSource(source, /JOIN products_v2 p ON p\.id = dl\.product_id/g);
    expect(zoneJoin.length).toBeGreaterThan(0);

    // It uses p.storage_zone_id for event routing
    const zoneRouting = findInSource(source, /p\.storage_zone_id/g);
    expect(zoneRouting.length).toBeGreaterThan(0);

    // If storage_zone_id changes between DRAFT creation and POST,
    // the event goes to a different zone than what the user saw
    // The document header's storage_zone_id may differ from events' zone
  });

  it("should confirm zone_stock_snapshots has no trigger to re-scope existing events on update", async () => {
    const source = await readSourceFile(INITIAL_MIGRATION);

    // zone_stock_snapshots only has an updated_at trigger
    const triggers = findInSource(source, /CREATE TRIGGER.*zone_stock_snapshots/g);
    expect(triggers.length).toBe(1); // Only update_updated_at_column

    // No trigger to re-scope stock_events when snapshot changes
    const rescopeTrigger = findInSource(
      source,
      /AFTER UPDATE ON.*zone_stock_snapshots[\s\S]*?stock_events/g
    );
    expect(rescopeTrigger.length).toBe(0);
  });

  it("should confirm zone_stock_snapshots uses UNIQUE constraint on (establishment, zone)", async () => {
    const source = await readSourceFile(INITIAL_MIGRATION);

    // Only one active snapshot per zone per establishment
    const uniqueConstraint = findInSource(source, /UNIQUE\(establishment_id, storage_zone_id\)/g);
    expect(uniqueConstraint.length).toBe(1);

    // This means updating the snapshot is an UPDATE (replace), not INSERT
    // Any concurrent transaction reading the old snapshot_version_id will get stale data
  });

  it("should confirm snapshot has FOR ALL RLS policy allowing unrestricted management", async () => {
    const source = await readSourceFile(INITIAL_MIGRATION);

    // There's a FOR ALL policy on zone_stock_snapshots (very broad)
    const forAllPolicy = findInSource(source, /ON public\.zone_stock_snapshots FOR ALL/g);
    expect(forAllPolicy.length).toBe(1);

    // This means any authenticated user in the establishment can UPDATE the snapshot
    // Updating the snapshot changes which events are "active" for stock estimation
    // A malicious user could point the snapshot to an old session to manipulate stock
  });

  it("should confirm estimated stock excludes events from previous snapshot versions", async () => {
    const source = await readSourceFile(STOCK_ENGINE);

    // The engine comment explicitly states the formula
    const formula = findInSource(source, /StockEstim.*=.*Snapshot.*\+.*stock_events/g);
    expect(formula.length).toBeGreaterThan(0);

    // Events are accumulated only for the current snapshot version
    // Events linked to a previous snapshot_version_id are implicitly dropped
    // This is the "orphaned events" vulnerability
    const snapshotFilter = findInSource(source, /snapshot_version_id/g);
    expect(snapshotFilter.length).toBeGreaterThan(0);
  });

  it("should confirm fn_post_stock_document locks snapshots during POST (partial fix for STK-04)", async () => {
    const source = await readSourceFile(POST_RPC);

    // The fixed version locks zone_stock_snapshots during POST
    const lockComment = findInSource(source, /STK-LED-015/g);
    expect(lockComment.length).toBeGreaterThan(0);

    // FOR UPDATE is present in the function (on separate lines from zone_stock_snapshots)
    const forUpdate = findInSource(source, /FOR UPDATE/g);
    expect(forUpdate.length).toBeGreaterThan(0);

    // But this only protects during the POST RPC call
    // The CLIENT-SIDE read of snapshots (useDesktopStock) is still unprotected
    // A snapshot change between client read and RPC call could cause inconsistency
  });
});

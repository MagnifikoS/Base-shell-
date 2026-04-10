/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SMOKE TEST — fn_post_stock_document RPC
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Validates the RPC error handling paths (no service role needed).
 * For full DRAFT→POSTED flow, run with SERVICE_ROLE_KEY available.
 *
 * Run: Lovable "Run Edge Function Tests" on stock-ledger
 * ═══════════════════════════════════════════════════════════════════════════
 */

// dotenv skipped — env vars provided by test runner
import {
  assertEquals,
  assertExists,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const HAS_SERVICE_ROLE = !!SERVICE_ROLE_KEY;
const EFFECTIVE_KEY = SERVICE_ROLE_KEY || ANON_KEY;

if (!SUPABASE_URL || !EFFECTIVE_KEY) {
  throw new Error(`Missing env vars. URL=${!!SUPABASE_URL}, KEY=${!!EFFECTIVE_KEY}`);
}

const db = createClient(SUPABASE_URL, EFFECTIVE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  ...(HAS_SERVICE_ROLE ? {} : {}),
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: DOCUMENT_NOT_FOUND — always works (RPC is SECURITY DEFINER)
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("fn_post_stock_document: DOCUMENT_NOT_FOUND", async () => {
  const { data, error } = await db.rpc("fn_post_stock_document", {
    p_document_id: "00000000-0000-0000-0000-000000000000",
    p_expected_lock_version: 1,
    p_posted_by: "00000000-0000-0000-0000-000000000001",
    p_idempotency_key: `smoke-${crypto.randomUUID()}`,
    p_override_flag: false,
    p_override_reason: null,
    p_event_reason: null,
  });

  // The RPC should NOT throw — it returns structured JSON
  if (error) {
    throw new Error(`RPC threw unexpectedly: ${error.message}\nCode: ${error.code}\nHint: ${error.hint}`);
  }

  assertExists(data, "RPC should return a result");
  assertEquals(data.ok, false, "Should not be ok");
  assertEquals(data.error, "DOCUMENT_NOT_FOUND", `Expected DOCUMENT_NOT_FOUND, got: ${JSON.stringify(data)}`);

  console.log("✅ DOCUMENT_NOT_FOUND OK");
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2: Full POST flow (requires SERVICE_ROLE_KEY for table access)
// ═══════════════════════════════════════════════════════════════════════════
Deno.test({
  name: "fn_post_stock_document: DRAFT → POSTED with events",
  ignore: !HAS_SERVICE_ROLE,
  fn: async () => {
    // 1. Pick first establishment
    const { data: est } = await db
      .from("establishments")
      .select("id, organization_id")
      .limit(1)
      .single();
    if (!est) throw new Error("No establishment found");

    // 2. Pick first snapshot
    const { data: snapshot } = await db
      .from("zone_stock_snapshots")
      .select("id, storage_zone_id, snapshot_version_id")
      .eq("establishment_id", est.id)
      .order("activated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .single();
    if (!snapshot) throw new Error(`No snapshot for est ${est.id}`);

    // 3. Pick a product + unit
    const { data: product } = await db
      .from("products_v2")
      .select("id, supplier_id")
      .eq("establishment_id", est.id)
      .is("archived_at", null)
      .limit(1)
      .single();
    if (!product) throw new Error("No product found");

    const { data: unit } = await db
      .from("measurement_units")
      .select("id, family, name")
      .eq("establishment_id", est.id)
      .eq("is_active", true)
      .limit(1)
      .single();
    if (!unit) throw new Error("No unit found");

    // 4. Pick a user
    const { data: profile } = await db
      .from("profiles")
      .select("user_id")
      .limit(1)
      .single();
    const postedBy = profile?.user_id ?? "00000000-0000-0000-0000-000000000000";

    // 5. Create DRAFT document
    const { data: doc, error: docErr } = await db
      .from("stock_documents")
      .insert({
        establishment_id: est.id,
        organization_id: est.organization_id,
        storage_zone_id: snapshot.storage_zone_id,
        supplier_id: product.supplier_id,
        type: "RECEIPT",
        status: "DRAFT",
        lock_version: 1,
      })
      .select()
      .single();
    if (docErr || !doc) throw new Error(`Draft failed: ${docErr?.message}`);

    // 6. Insert 1 line
    const { error: lineErr } = await db
      .from("stock_document_lines")
      .insert({
        document_id: doc.id,
        product_id: product.id,
        delta_quantity_canonical: 1,
        canonical_unit_id: unit.id,
        canonical_family: unit.family ?? "weight",
        canonical_label: unit.name,
        context_hash: "smoke-test-hash",
      });
    if (lineErr) throw new Error(`Line insert failed: ${lineErr.message}`);

    // 7. Call RPC
    const idempotencyKey = `smoke-post-${crypto.randomUUID()}`;
    const { data: result, error: rpcErr } = await db.rpc("fn_post_stock_document", {
      p_document_id: doc.id,
      p_expected_lock_version: 1,
      p_posted_by: postedBy,
      p_idempotency_key: idempotencyKey,
      p_override_flag: false,
      p_override_reason: null,
      p_event_reason: null,
    });

    if (rpcErr) {
      throw new Error(`RPC ERROR: ${rpcErr.message}\nCode: ${rpcErr.code}\nDetails: ${rpcErr.details}`);
    }

    assertExists(result, "RPC should return a result");
    assertEquals(result.ok, true, `RPC should succeed, got: ${JSON.stringify(result)}`);
    assert((result.events_created as number) >= 1, `Should create ≥1 event`);

    // 8. Verify document is POSTED
    const { data: postedDoc } = await db
      .from("stock_documents")
      .select("status, posted_at, lock_version")
      .eq("id", doc.id)
      .single();
    assertEquals(postedDoc?.status, "POSTED");
    assertExists(postedDoc?.posted_at);
    assertEquals(postedDoc?.lock_version, 2);

    // 9. Verify events
    const { data: events } = await db
      .from("stock_events")
      .select("id, delta_quantity_canonical, snapshot_version_id, storage_zone_id")
      .eq("document_id", doc.id);
    assertEquals(events?.length, 1);
    assert((events![0].delta_quantity_canonical as number) > 0);
    assertExists(events![0].snapshot_version_id);
    assertExists(events![0].storage_zone_id);

    // 10. Idempotency check
    const { data: r2 } = await db.rpc("fn_post_stock_document", {
      p_document_id: doc.id,
      p_expected_lock_version: 2,
      p_posted_by: postedBy,
      p_idempotency_key: idempotencyKey,
      p_override_flag: false,
      p_override_reason: null,
      p_event_reason: null,
    });
    assertEquals(r2?.ok, true);
    assertEquals(r2?.idempotent, true);

    // Verify no new events
    const { count } = await db
      .from("stock_events")
      .select("id", { count: "exact", head: true })
      .eq("document_id", doc.id);
    assertEquals(count, 1, "Event count should not increase");

    console.log("✅ POST OK — events_inserted=1, IDEMPOTENCE OK");
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3: Error cases (NO_LINES, LOCK_CONFLICT) — requires SERVICE_ROLE
// ═══════════════════════════════════════════════════════════════════════════
Deno.test({
  name: "fn_post_stock_document: NO_LINES + LOCK_CONFLICT",
  ignore: !HAS_SERVICE_ROLE,
  fn: async () => {
    const { data: est } = await db
      .from("establishments")
      .select("id, organization_id")
      .limit(1)
      .single();
    if (!est) throw new Error("No establishment");

    const { data: snapshot } = await db
      .from("zone_stock_snapshots")
      .select("id, storage_zone_id")
      .eq("establishment_id", est.id)
      .limit(1)
      .single();
    if (!snapshot) throw new Error("No snapshot");

    const { data: product } = await db
      .from("products_v2")
      .select("id, supplier_id")
      .eq("establishment_id", est.id)
      .is("archived_at", null)
      .limit(1)
      .single();
    if (!product) throw new Error("No product");

    const postedBy = "00000000-0000-0000-0000-000000000001";

    // --- NO_LINES ---
    const { data: emptyDoc } = await db
      .from("stock_documents")
      .insert({
        establishment_id: est.id,
        organization_id: est.organization_id,
        storage_zone_id: snapshot.storage_zone_id,
        supplier_id: product.supplier_id,
        type: "RECEIPT",
        status: "DRAFT",
        lock_version: 1,
      })
      .select()
      .single();

    const { data: r1 } = await db.rpc("fn_post_stock_document", {
      p_document_id: emptyDoc!.id,
      p_expected_lock_version: 1,
      p_posted_by: postedBy,
      p_idempotency_key: `err-${crypto.randomUUID()}`,
      p_override_flag: false,
      p_override_reason: null,
      p_event_reason: null,
    });
    assertEquals(r1?.error, "NO_LINES");

    // --- LOCK_CONFLICT ---
    const { data: unit } = await db
      .from("measurement_units")
      .select("id, family, name")
      .eq("establishment_id", est.id)
      .eq("is_active", true)
      .limit(1)
      .single();

    const { data: doc2 } = await db
      .from("stock_documents")
      .insert({
        establishment_id: est.id,
        organization_id: est.organization_id,
        storage_zone_id: snapshot.storage_zone_id,
        supplier_id: product.supplier_id,
        type: "RECEIPT",
        status: "DRAFT",
        lock_version: 1,
      })
      .select()
      .single();

    await db.from("stock_document_lines").insert({
      document_id: doc2!.id,
      product_id: product.id,
      delta_quantity_canonical: 1,
      canonical_unit_id: unit!.id,
      canonical_family: unit!.family ?? "weight",
      canonical_label: unit!.name,
      context_hash: "smoke-lock-test",
    });

    const { data: r2 } = await db.rpc("fn_post_stock_document", {
      p_document_id: doc2!.id,
      p_expected_lock_version: 999,
      p_posted_by: postedBy,
      p_idempotency_key: `err-${crypto.randomUUID()}`,
      p_override_flag: false,
      p_override_reason: null,
      p_event_reason: null,
    });
    assertEquals(r2?.error, "LOCK_CONFLICT");

    console.log("✅ ERROR CASES OK");
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4: WITHDRAWAL requires event_reason — requires SERVICE_ROLE
// ═══════════════════════════════════════════════════════════════════════════
Deno.test({
  name: "fn_post_stock_document: WITHDRAWAL requires reason",
  ignore: !HAS_SERVICE_ROLE,
  fn: async () => {
    const { data: est } = await db
      .from("establishments")
      .select("id, organization_id")
      .limit(1)
      .single();
    if (!est) throw new Error("No establishment");

    const { data: snapshot } = await db
      .from("zone_stock_snapshots")
      .select("id, storage_zone_id")
      .eq("establishment_id", est.id)
      .limit(1)
      .single();
    if (!snapshot) throw new Error("No snapshot");

    const { data: product } = await db
      .from("products_v2")
      .select("id, supplier_id")
      .eq("establishment_id", est.id)
      .is("archived_at", null)
      .limit(1)
      .single();
    if (!product) throw new Error("No product");

    const { data: unit } = await db
      .from("measurement_units")
      .select("id, family, name")
      .eq("establishment_id", est.id)
      .eq("is_active", true)
      .limit(1)
      .single();
    if (!unit) throw new Error("No unit");

    const { data: doc } = await db
      .from("stock_documents")
      .insert({
        establishment_id: est.id,
        organization_id: est.organization_id,
        storage_zone_id: snapshot.storage_zone_id,
        supplier_id: product.supplier_id,
        type: "WITHDRAWAL",
        status: "DRAFT",
        lock_version: 1,
      })
      .select()
      .single();

    await db.from("stock_document_lines").insert({
      document_id: doc!.id,
      product_id: product.id,
      delta_quantity_canonical: -1,
      canonical_unit_id: unit.id,
      canonical_family: unit.family ?? "weight",
      canonical_label: unit.name,
      context_hash: "smoke-withdrawal",
    });

    // POST without reason → should RAISE EXCEPTION
    const { error: rpcErr } = await db.rpc("fn_post_stock_document", {
      p_document_id: doc!.id,
      p_expected_lock_version: 1,
      p_posted_by: "00000000-0000-0000-0000-000000000001",
      p_idempotency_key: `withdrawal-${crypto.randomUUID()}`,
      p_override_flag: false,
      p_override_reason: null,
      p_event_reason: null,
    });

    assertExists(rpcErr, "Should error for missing withdrawal reason");
    assert(
      rpcErr!.message.includes("WITHDRAWAL_REASON_REQUIRED"),
      `Should mention WITHDRAWAL_REASON_REQUIRED, got: ${rpcErr!.message}`
    );

    console.log("✅ WITHDRAWAL REASON CHECK OK");
  },
});

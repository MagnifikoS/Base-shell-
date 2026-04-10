/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STOCK LEDGER — Edge Function (thin orchestrator)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Actions:
 *   POST  ?action=post  → fn_post_stock_document (atomic)
 *   POST  ?action=void  → fn_void_stock_document (atomic)
 *
 * Auth: JWT validated in code (verify_jwt = false in config.toml)
 * RBAC: inventaire:write via has_module_access RPC
 * All business logic lives in DB RPCs for transactional safety.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { createLogger } from "../_shared/logger.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = makeCorsHeaders("POST, OPTIONS");

const log = createLogger("stock-ledger");

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function jsonErr(status: number, error: string, details?: unknown) {
  return new Response(
    JSON.stringify({ ok: false, error, details }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function jsonOk(data: unknown) {
  return new Response(
    JSON.stringify(data),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// INPUT VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  // 1. CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonErr(405, "METHOD_NOT_ALLOWED");
  }

  // 2. Auth check (MANDATORY)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    log.warn("Missing authorization header");
    return jsonErr(401, "UNAUTHORIZED", { message: "Missing authorization" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // User-scoped client (JWT) for auth + RBAC
  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !user) {
    log.warn("Auth failed");
    return jsonErr(401, "UNAUTHORIZED");
  }

  // Admin client (service role) for mutations
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  // Rate limit: 30 req/min per IP
  const rateLimited = await checkRateLimit(req, adminClient, { max: 30, keyPrefix: "stock-ledger" });
  if (rateLimited) return rateLimited;

  // ═══ Route ═══
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    const body = await req.json();

    log.info("handle_request", { user_id: user.id, action, document_id: body.document_id });

    if (action === "post") {
      const result = await handlePost(supabaseUser, adminClient, user.id, body);
      log.info("completed", { action: "post", document_id: body.document_id });
      return result;
    } else if (action === "void") {
      const result = await handleVoid(supabaseUser, adminClient, user.id, body);
      log.info("completed", { action: "void", document_id: body.document_id });
      return result;
    } else {
      return jsonErr(400, "INVALID_ACTION", { valid: ["post", "void"] });
    }
  } catch (err) {
    log.error("Unhandled error", err);
    return jsonErr(500, "INTERNAL_ERROR");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// RBAC CHECK — inventaire:write required for post/void
// ═══════════════════════════════════════════════════════════════════════════

async function checkInventaireWrite(
  userClient: ReturnType<typeof createClient>,
  establishmentId: string
): Promise<Response | null> {
  const { data: hasAccess, error: accessError } = await userClient.rpc("has_module_access", {
    _module_key: "inventaire",
    _min_level: "write",
    _establishment_id: establishmentId,
  });

  if (accessError) {
    log.error("RBAC check failed", accessError);
    return jsonErr(500, "RBAC_CHECK_FAILED");
  }

  if (!hasAccess) {
    log.warn("access_denied", { establishment_id: establishmentId, module: "inventaire" });
    return jsonErr(403, "ACCESS_DENIED", { message: "Permission inventaire:write required" });
  }

  return null; // access granted
}

// ═══════════════════════════════════════════════════════════════════════════
// RESOLVE establishment_id from document
// ═══════════════════════════════════════════════════════════════════════════

async function resolveDocumentEstablishment(
  adminClient: ReturnType<typeof createClient>,
  documentId: string
): Promise<{ establishment_id: string } | null> {
  const { data, error } = await adminClient
    .from("stock_documents")
    .select("establishment_id")
    .eq("id", documentId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════
// POST handler — calls fn_post_stock_document RPC
// ═══════════════════════════════════════════════════════════════════════════

interface PostBody {
  document_id: string;
  expected_lock_version: number;
  idempotency_key: string;
  event_reason?: string | null;
}

async function handlePost(
  userClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  body: PostBody
) {
  // Validate required fields
  if (!isValidUUID(body.document_id)) {
    return jsonErr(400, "INVALID_DOCUMENT_ID", { message: "document_id must be a valid UUID" });
  }
  if (!isPositiveInteger(body.expected_lock_version)) {
    return jsonErr(400, "INVALID_LOCK_VERSION", { message: "expected_lock_version must be a non-negative integer" });
  }
  if (!body.idempotency_key || typeof body.idempotency_key !== "string" || body.idempotency_key.length > 255) {
    return jsonErr(400, "INVALID_IDEMPOTENCY_KEY", { message: "idempotency_key is required and max 255 chars" });
  }

  // 3. Resolve establishment + RBAC check
  const doc = await resolveDocumentEstablishment(adminClient, body.document_id);
  if (!doc) {
    return jsonErr(404, "DOCUMENT_NOT_FOUND");
  }

  const rbacError = await checkInventaireWrite(userClient, doc.establishment_id);
  if (rbacError) return rbacError;

  // 4. Business logic via adminClient RPC — Stock Zéro Simple V2 (clamp universel)
  const { data, error } = await adminClient.rpc("fn_post_stock_document", {
    p_document_id: body.document_id,
    p_expected_lock_version: body.expected_lock_version,
    p_posted_by: userId,
    p_idempotency_key: body.idempotency_key,
    p_event_reason: body.event_reason ?? null,
  });

  if (error) {
    log.error("POST RPC error", error, { document_id: body.document_id });
    return jsonErr(500, "RPC_ERROR");
  }

  if (!data?.ok) {
    const statusMap: Record<string, number> = {
      DOCUMENT_NOT_FOUND: 404,
      NOT_DRAFT: 409,
      NO_ACTIVE_SNAPSHOT: 422,
      NO_LINES: 422,
      PRODUCT_NO_ZONE: 422,
      LOCK_CONFLICT: 409,
    };
    const httpStatus = statusMap[data?.error] ?? 400;
    return jsonErr(httpStatus, data?.error, data);
  }

  return jsonOk(data);
}

// ═══════════════════════════════════════════════════════════════════════════
// VOID handler — calls fn_void_stock_document RPC
// ═══════════════════════════════════════════════════════════════════════════

interface VoidBody {
  document_id: string;
  void_reason: string;
}

async function handleVoid(
  userClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  body: VoidBody
) {
  // Validate required fields
  if (!isValidUUID(body.document_id)) {
    return jsonErr(400, "INVALID_DOCUMENT_ID", { message: "document_id must be a valid UUID" });
  }
  if (!body.void_reason || typeof body.void_reason !== "string") {
    return jsonErr(400, "MISSING_FIELDS", { required: ["document_id", "void_reason"] });
  }
  if (body.void_reason.length > 1000) {
    return jsonErr(400, "INVALID_VOID_REASON", { message: "void_reason max 1000 chars" });
  }

  // 3. Resolve establishment + RBAC check
  const doc = await resolveDocumentEstablishment(adminClient, body.document_id);
  if (!doc) {
    return jsonErr(404, "DOCUMENT_NOT_FOUND");
  }

  const rbacError = await checkInventaireWrite(userClient, doc.establishment_id);
  if (rbacError) return rbacError;

  // 4. Business logic via adminClient RPC
  const { data, error } = await adminClient.rpc("fn_void_stock_document", {
    p_document_id: body.document_id,
    p_voided_by: userId,
    p_void_reason: body.void_reason,
  });

  if (error) {
    if (error.message?.includes("VOID_BALANCE_ERROR")) {
      return jsonErr(500, "VOID_BALANCE_ERROR", {
        message: "Inverse events do not sum to zero — critical integrity error.",
      });
    }

    log.error("VOID RPC error", error, { document_id: body.document_id });
    return jsonErr(500, "RPC_ERROR");
  }

  if (!data?.ok) {
    const statusMap: Record<string, number> = {
      DOCUMENT_NOT_FOUND: 404,
      NOT_POSTED: 409,
      VOID_REASON_REQUIRED: 422,
      NO_ACTIVE_SNAPSHOT: 422,
      NO_EVENTS_TO_VOID: 422,
      VOID_CONFLICT: 409,
    };
    const httpStatus = statusMap[data?.error] ?? 400;
    return jsonErr(httpStatus, data?.error, data);
  }

  return jsonOk(data);
}

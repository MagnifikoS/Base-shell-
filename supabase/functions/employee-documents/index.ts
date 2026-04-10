import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("employee-documents");
const CORS = makeCorsHeaders("POST, OPTIONS");

const DOCUMENT_TYPES = [
  "piece_identite_fr",
  "piece_identite_eu",
  "passeport_fr",
  "passeport_eu",
  "passeport_etranger",
  "recepisse",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    log.info("Request received");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      log.warn("Missing or invalid authorization header");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      log.warn("auth_failed", { reason: "invalid_token" });
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const currentUserId = claimsData.user.id;

    // Rate limit check (after auth, before business logic — using null for in-memory since adminClient is not created yet)
    const rateLimited = await checkRateLimit(req, null, { max: 30, keyPrefix: "employee-documents" });
    if (rateLimited) return rateLimited;

    // Get request body early to extract establishment_id for RBAC V2
    const body = await req.json();
    const { action, establishment_id } = body;

    // ═══════════════════════════════════════════════════════════════════════════
    // RBAC V2: has_module_access replaces has_role("Administrateur")
    // Directors and Admins can both manage employee documents
    // ═══════════════════════════════════════════════════════════════════════════
    if (!establishment_id) {
      return new Response(
        JSON.stringify({ error: "establishment_id is required for RBAC V2" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { data: hasWriteAccess, error: rbacError } = await supabaseUser.rpc("has_module_access", {
      _module_key: "salaries",
      _min_level: "read",
      _establishment_id: establishment_id,
    });

    if (rbacError) {
      log.error("RBAC check error", rbacError);
      return new Response(
        JSON.stringify({ error: "Failed to check permissions" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const canManageDocuments = !!hasWriteAccess;

    log.info("handle_request", { user_id: currentUserId, action, establishment_id });

    // Get organization ID
    const { data: orgId, error: orgError } = await supabaseUser.rpc("get_user_organization_id");
    if (orgError || !orgId) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Helper: check if user has write access for mutations
    async function checkWriteAccess(): Promise<boolean> {
      const { data } = await supabaseUser.rpc("has_module_access", {
        _module_key: "salaries",
        _min_level: "write",
        _establishment_id: establishment_id,
      });
      return !!data;
    }

    // Helper: verify target user belongs to org
    async function verifyUserInOrg(targetUserId: string): Promise<boolean> {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("user_id", targetUserId)
        .eq("organization_id", orgId)
        .maybeSingle();
      return !!data;
    }

    switch (action) {
      // =============================================
      // LIST: Get documents for a user
      // =============================================
      case "list": {
        const { user_id } = body;

        if (!user_id) {
          return new Response(
            JSON.stringify({ error: "user_id is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // RBAC V2: canManageDocuments (salaries:read) or self can list documents
        if (!canManageDocuments && currentUserId !== user_id) {
          return new Response(
            JSON.stringify({ error: "Forbidden" }),
            { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const userInOrg = await verifyUserInOrg(user_id);
        if (!userInOrg) {
          return new Response(
            JSON.stringify({ error: "User not found in organization" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const { data: documents, error: docsError } = await supabaseAdmin
          .from("employee_documents")
          .select("id, file_name, file_type, file_size, document_type, created_at")
          .eq("organization_id", orgId)
          .eq("user_id", user_id)
          .order("created_at", { ascending: false });

        if (docsError) throw docsError;

        return new Response(
          JSON.stringify({ documents: documents || [] }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // =============================================
      // UPLOAD: Upload document for employee
      // =============================================
      case "upload": {
        // RBAC V2: require salaries:write for upload
        const hasWriteForUpload = await checkWriteAccess();
        if (!hasWriteForUpload) {
          return new Response(
            JSON.stringify({ error: "Forbidden: salaries:write access required" }),
            { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const { user_id, file_name, file_type, file_size, document_type, file_base64 } = body;

        if (!user_id || !file_name || !file_type || !file_size || !document_type || !file_base64) {
          return new Response(
            JSON.stringify({ error: "Missing required fields" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (!DOCUMENT_TYPES.includes(document_type)) {
          return new Response(
            JSON.stringify({ error: `Invalid document_type. Must be one of: ${DOCUMENT_TYPES.join(", ")}` }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const userInOrg = await verifyUserInOrg(user_id);
        if (!userInOrg) {
          return new Response(
            JSON.stringify({ error: "User not found in organization" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Generate document ID
        const documentId = crypto.randomUUID();

        // Sanitize filename
        const sanitizedFileName = file_name
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .substring(0, 100);

        // Build storage path: {org_id}/{user_id}/{document_type}/{doc_id}-{filename}
        const storagePath = `${orgId}/${user_id}/${document_type}/${documentId}-${sanitizedFileName}`;

        // Decode base64 and upload
        const fileBytes = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));

        const { error: uploadError } = await supabaseAdmin.storage
          .from("employee-documents")
          .upload(storagePath, fileBytes, {
            contentType: file_type,
            upsert: false,
          });

        if (uploadError) {
          log.error("Storage upload error", uploadError);
          return new Response(
            JSON.stringify({ error: "Failed to upload file" }),
            { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Insert metadata record
        const { data: docRecord, error: insertError } = await supabaseAdmin
          .from("employee_documents")
          .insert({
            id: documentId,
            organization_id: orgId,
            user_id,
            file_name: file_name,
            file_type,
            file_size,
            storage_path: storagePath,
            document_type,
            created_by: currentUserId,
          })
          .select("id, file_name, file_type, file_size, document_type, created_at")
          .single();

        if (insertError) {
          // Rollback: delete uploaded file
          await supabaseAdmin.storage.from("employee-documents").remove([storagePath]);
          throw insertError;
        }

        return new Response(
          JSON.stringify({ success: true, document: docRecord }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // =============================================
      // DOWNLOAD: Get signed URL for document
      // =============================================
      case "download": {
        const { document_id } = body;

        if (!document_id) {
          return new Response(
            JSON.stringify({ error: "document_id is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Get document metadata
        const { data: doc, error: docError } = await supabaseAdmin
          .from("employee_documents")
          .select("id, user_id, storage_path, file_name, organization_id")
          .eq("id", document_id)
          .maybeSingle();

        if (docError || !doc) {
          return new Response(
            JSON.stringify({ error: "Document not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Verify org and access
        if (doc.organization_id !== orgId) {
          return new Response(
            JSON.stringify({ error: "Forbidden" }),
            { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // RBAC V2: canManageDocuments (salaries:read) or document owner can download
        if (!canManageDocuments && currentUserId !== doc.user_id) {
          return new Response(
            JSON.stringify({ error: "Forbidden" }),
            { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Create short-lived signed URL (5 minutes)
        const { data: signedData, error: signError } = await supabaseAdmin.storage
          .from("employee-documents")
          .createSignedUrl(doc.storage_path, 300);

        if (signError || !signedData) {
          log.error("Signed URL error", signError);
          return new Response(
            JSON.stringify({ error: "Failed to generate download URL" }),
            { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ url: signedData.signedUrl, file_name: doc.file_name }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // =============================================
      // DELETE: Delete document
      // =============================================
      case "delete": {
        // RBAC V2: require salaries:write for delete
        const hasWriteForDelete = await checkWriteAccess();
        if (!hasWriteForDelete) {
          return new Response(
            JSON.stringify({ error: "Forbidden: salaries:write access required" }),
            { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const { document_id } = body;

        if (!document_id) {
          return new Response(
            JSON.stringify({ error: "document_id is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Get document metadata
        const { data: doc, error: docError } = await supabaseAdmin
          .from("employee_documents")
          .select("id, storage_path, organization_id")
          .eq("id", document_id)
          .maybeSingle();

        if (docError || !doc) {
          return new Response(
            JSON.stringify({ error: "Document not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Verify org
        if (doc.organization_id !== orgId) {
          return new Response(
            JSON.stringify({ error: "Forbidden" }),
            { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // SEC-DATA-031: Audit log BEFORE deletion
        const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
          || req.headers.get("x-real-ip")
          || null;
        await supabaseAdmin.from("audit_logs").insert({
          organization_id: orgId,
          user_id: currentUserId,
          action: "hard_delete:employee_documents",
          target_type: "employee_documents",
          target_id: document_id,
          metadata: {
            storage_path: doc.storage_path,
            reason: "User-initiated employee document deletion",
          },
          ip_address: clientIp,
          user_agent: req.headers.get("user-agent") || null,
        });

        // Delete from storage
        const { error: storageDeleteError } = await supabaseAdmin.storage
          .from("employee-documents")
          .remove([doc.storage_path]);

        if (storageDeleteError) {
          log.warn("storage_delete_error", { error: storageDeleteError.message });
        }

        // Delete metadata record
        const { error: deleteError } = await supabaseAdmin
          .from("employee_documents")
          .delete()
          .eq("id", document_id);

        if (deleteError) throw deleteError;

        log.info("completed", { action: "delete", document_id });
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    log.error("Unhandled error", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});

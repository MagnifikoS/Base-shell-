import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { createLogger } from "../_shared/logger.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = makeCorsHeaders("POST, OPTIONS");

// =============================================
// Encryption utilities (AES-GCM)
// =============================================
const ENCRYPTION_VERSION = 1;

// SEC-13: Accept salt parameter for per-encryption random salt (new format)
// or fixed salt for backwards compatibility (old format)
async function getEncryptionKey(salt: Uint8Array): Promise<CryptoKey> {
  const keyData = Deno.env.get("EMPLOYEE_DATA_KEY");
  if (!keyData) {
    throw new Error("EMPLOYEE_DATA_KEY not configured");
  }

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyData),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Fixed salt used by the old encryption format (v1) — kept for backwards compatibility
const LEGACY_FIXED_SALT = new TextEncoder().encode("employee_data_salt_v1");

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// SEC-13: New format uses a random 16-byte salt per encryption
// Output: base64(iv):base64(salt):base64(ciphertext)
async function encrypt(plaintext: string): Promise<string> {
  if (!plaintext) return "";

  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await getEncryptionKey(salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  );

  // New format: base64(iv):base64(salt):base64(ciphertext)
  return `${toBase64(iv)}:${toBase64(salt)}:${toBase64(new Uint8Array(ciphertext))}`;
}

// SEC-13: Decrypt supports BOTH old format (single base64 blob) and new format (iv:salt:ciphertext)
async function decrypt(encrypted: string): Promise<string> {
  if (!encrypted) return "";

  try {
    // Detect format: new format contains colons separating base64 segments
    if (encrypted.includes(":")) {
      // New format: base64(iv):base64(salt):base64(ciphertext)
      const parts = encrypted.split(":");
      if (parts.length !== 3) {
        throw new Error("Invalid encrypted format: expected 3 colon-separated parts");
      }
      const iv = fromBase64(parts[0]);
      const salt = fromBase64(parts[1]);
      const ciphertext = fromBase64(parts[2]);
      const key = await getEncryptionKey(salt);

      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ciphertext
      );
      return new TextDecoder().decode(plaintext);
    } else {
      // Old format: single base64 blob with iv (12 bytes) + ciphertext
      const combined = fromBase64(encrypted);
      const iv = combined.slice(0, 12);
      const ciphertext = combined.slice(12);
      const key = await getEncryptionKey(LEGACY_FIXED_SALT);

      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ciphertext
      );
      return new TextDecoder().decode(plaintext);
    }
  } catch (err) {
    // SEC-17: Throw explicit error instead of silently returning ""
    // Silent failure could mask key rotation issues or data corruption
    log.warn("decryption_failed", { error: err instanceof Error ? err.message : String(err) });
    throw new Error("Decryption failed: sensitive data could not be decrypted. Check EMPLOYEE_DATA_KEY configuration.");
  }
}

function extractLast4(value: string | null): string | null {
  if (!value || value.length < 4) return null;
  return value.slice(-4);
}

function extractLast2(value: string | null): string | null {
  if (!value || value.length < 2) return null;
  return value.slice(-2);
}

// =============================================
// Helper: Deduce establishment_id from target user
// Returns: { establishmentId, error, status }
// =============================================
async function deduceEstablishmentId(
  supabaseAdmin: ReturnType<typeof createClient>,
  targetUserId: string
): Promise<{ establishmentId: string | null; error: string | null; status: number }> {
  const { data: targetEstabs, error: targetEstabsError } = await supabaseAdmin
    .from("user_establishments")
    .select("establishment_id")
    .eq("user_id", targetUserId);

  if (targetEstabsError) {
    return { establishmentId: null, error: "Failed to lookup user establishments", status: 500 };
  }

  if (!targetEstabs || targetEstabs.length === 0) {
    return { establishmentId: null, error: "User has no establishment", status: 404 };
  }

  if (targetEstabs.length > 1) {
    return { establishmentId: null, error: "establishment_id required (user has multiple)", status: 400 };
  }

  return { establishmentId: targetEstabs[0].establishment_id, error: null, status: 200 };
}

// =============================================
// Helper: Check RBAC V2 module access
// =============================================
async function checkModuleAccess(
  supabaseUser: ReturnType<typeof createClient>,
  moduleKey: string,
  minLevel: "read" | "write" | "full",
  establishmentId: string
): Promise<boolean> {
  const { data: hasAccess, error } = await supabaseUser.rpc("has_module_access", {
    _module_key: moduleKey,
    _min_level: minLevel,
    _establishment_id: establishmentId,
  });

  if (error) {
    log.error("has_module_access error", error);
    return false;
  }

  return hasAccess === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const log = createLogger("employees");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const currentUserId = claimsData.user.id;

    // Get organization ID
    const { data: orgId, error: orgError } = await supabaseUser.rpc("get_user_organization_id");
    if (orgError || !orgId) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Rate limit: 30 req/min per IP
    const rateLimited = await checkRateLimit(req, supabaseAdmin, { max: 30, keyPrefix: "employees" });
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const { action } = body;

    // Client context for audit logging (DATA-01)
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || null;
    const clientUserAgent = req.headers.get("user-agent") || null;

    // Audit logging helper
    async function logAudit(actionName: string, targetType: string, targetId: string, metadata?: Record<string, unknown>) {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: orgId,
        user_id: currentUserId,
        action: actionName,
        target_type: targetType,
        target_id: targetId,
        metadata: metadata || null,
        ip_address: clientIp,
        user_agent: clientUserAgent,
      });
    }

    // Get the "Salarié" role ID
    async function getSalarieRoleId(): Promise<string | null> {
      const { data } = await supabaseAdmin
        .from("roles")
        .select("id")
        .eq("name", "Salarié")
        .maybeSingle();
      return data?.id || null;
    }

    switch (action) {
      // =============================================
      // LIST: Get all employees (users with role "Salarié")
      // RBAC V2: has_module_access("salaries", "read", establishment_id)
      // =============================================
      case "list": {
        const { establishment_id: requestedEstablishmentId, include_disabled } = body;

        // ========== STEP 0: establishment_id is REQUIRED ==========
        if (!requestedEstablishmentId || typeof requestedEstablishmentId !== "string") {
          return new Response(
            JSON.stringify({ error: "establishment_id required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ========== STEP 1: RBAC V2 check ==========
        const canRead = await checkModuleAccess(supabaseUser, "salaries", "read", requestedEstablishmentId);
        if (!canRead) {
          return new Response(
            JSON.stringify({ error: "Forbidden: No read access to salaries module" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ========== STEP 2: Load permissions V2 for scope info ==========
        const { data: perms, error: permsError } = await supabaseUser.rpc("get_my_permissions_v2", {
          _establishment_id: requestedEstablishmentId,
        });
        if (permsError || !perms) {
          return new Response(
            JSON.stringify({ error: "Failed to load permissions" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const salariesPerm = (perms.permissions || []).find((p: { module_key: string }) => p.module_key === "salaries");
        const scope = salariesPerm?.scope ?? "self";
        const teamIds: string[] = perms.team_ids ?? [];
        const callerEstablishmentIds: string[] = perms.establishment_ids ?? [];

        // ========== STEP 3: Anti-spoof establishment_id ==========
        if (!callerEstablishmentIds.includes(requestedEstablishmentId)) {
          return new Response(
            JSON.stringify({ error: "Forbidden: Establishment not authorized" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ========== STEP 4: Build allowed user_ids based on scope ==========
        let allowedUserIds: string[] | null = null; // null = no filter (org scope)

        if (scope === "self") {
          allowedUserIds = [currentUserId];
        } else if (scope === "team") {
          if (teamIds.length === 0) {
            return new Response(
              JSON.stringify({ employees: [] }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          const { data: teamUsers } = await supabaseAdmin
            .from("user_teams")
            .select("user_id")
            .in("team_id", teamIds);
          allowedUserIds = [...new Set((teamUsers || []).map((tu: { user_id: string }) => tu.user_id))];
          if (allowedUserIds.length === 0) {
            return new Response(
              JSON.stringify({ employees: [] }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } else if (scope === "establishment") {
          const estabIdsToUse = [requestedEstablishmentId];
          const { data: estabUsers } = await supabaseAdmin
            .from("user_establishments")
            .select("user_id")
            .in("establishment_id", estabIdsToUse);
          allowedUserIds = [...new Set((estabUsers || []).map((eu: { user_id: string }) => eu.user_id))];
          if (allowedUserIds.length === 0) {
            return new Response(
              JSON.stringify({ employees: [] }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } else if (scope === "org") {
          // org scope: filter by requested establishment only
          const { data: estabUsers } = await supabaseAdmin
            .from("user_establishments")
            .select("user_id")
            .eq("establishment_id", requestedEstablishmentId);
          allowedUserIds = [...new Set((estabUsers || []).map((eu: { user_id: string }) => eu.user_id))];
          if (allowedUserIds.length === 0) {
            return new Response(
              JSON.stringify({ employees: [] }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        // ========== STEP 5: Get "Salarié" role and filter ==========
        const salarieRoleId = await getSalarieRoleId();
        if (!salarieRoleId) {
          return new Response(
            JSON.stringify({ employees: [] }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get all user_ids with role "Salarié"
        const { data: salarieUserRoles } = await supabaseAdmin
          .from("user_roles")
          .select("user_id")
          .eq("role_id", salarieRoleId);

        if (!salarieUserRoles || salarieUserRoles.length === 0) {
          return new Response(
            JSON.stringify({ employees: [] }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        let salarieUserIds = salarieUserRoles.map((ur: { user_id: string }) => ur.user_id);

        // Apply scope filter
        if (allowedUserIds !== null) {
          const allowedSet = new Set(allowedUserIds);
          salarieUserIds = salarieUserIds.filter((id: string) => allowedSet.has(id));
        }

        if (salarieUserIds.length === 0) {
          return new Response(
            JSON.stringify({ employees: [] }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ========== STEP 6: Query profiles with org filter ==========
        let profilesQuery = supabaseAdmin
          .from("profiles")
          .select("id, user_id, email, full_name, second_first_name, status, created_at")
          .eq("organization_id", orgId) // DEFENSE IN DEPTH: always filter by org
          .in("user_id", salarieUserIds)
          .order("full_name", { ascending: true, nullsFirst: false });

        // By default, exclude disabled users unless explicitly requested
        if (!include_disabled) {
          profilesQuery = profilesQuery.neq("status", "disabled");
        }

        const { data: profiles, error: profilesError } = await profilesQuery;

        if (profilesError) throw profilesError;

        const userIds = (profiles || []).map((p: { user_id: string }) => p.user_id);

        if (userIds.length === 0) {
          return new Response(
            JSON.stringify({ employees: [] }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Batch load establishments
        const { data: allUserEstabs } = await supabaseAdmin
          .from("user_establishments")
          .select("user_id, establishment_id, establishments(id, name, status)")
          .in("user_id", userIds);

        // Batch load teams
        const { data: allUserTeams } = await supabaseAdmin
          .from("user_teams")
          .select("user_id, team_id, teams(id, name, status)")
          .in("user_id", userIds);

        // Batch load employee_details for position
        const { data: allDetails } = await supabaseAdmin
          .from("employee_details")
          .select("user_id, position")
          .in("user_id", userIds);

        // Build maps
        const estabsMap = new Map<string, Array<{ id: string; name: string }>>();
        (allUserEstabs || []).forEach((ue: { user_id: string; establishments: { id: string; name: string; status: string } | null }) => {
          const existing = estabsMap.get(ue.user_id) || [];
          if (ue.establishments && ue.establishments.status === "active") {
            existing.push({ id: ue.establishments.id, name: ue.establishments.name });
          }
          estabsMap.set(ue.user_id, existing);
        });

        const teamsMap = new Map<string, Array<{ id: string; name: string }>>();
        (allUserTeams || []).forEach((ut: { user_id: string; teams: { id: string; name: string; status: string } | null }) => {
          const existing = teamsMap.get(ut.user_id) || [];
          if (ut.teams && ut.teams.status === "active") {
            existing.push({ id: ut.teams.id, name: ut.teams.name });
          }
          teamsMap.set(ut.user_id, existing);
        });

        const detailsMap = new Map<string, { position: string | null }>();
        (allDetails || []).forEach((d: { user_id: string; position: string | null }) => {
          detailsMap.set(d.user_id, { position: d.position });
        });

        // Compose result (mobile-optimized payload)
        const employees = (profiles || []).map((profile: { user_id: string; email: string; full_name: string | null; second_first_name: string | null; status: string }) => ({
          user_id: profile.user_id,
          email: profile.email,
          full_name: profile.full_name,
          second_first_name: profile.second_first_name,
          status: profile.status,
          position: detailsMap.get(profile.user_id)?.position || null,
          establishments: estabsMap.get(profile.user_id) || [],
          teams: teamsMap.get(profile.user_id) || [],
        }));

        log.info("completed", { action: "list", count: employees.length });
        return new Response(
          JSON.stringify({ employees }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // =============================================
      // GET: Get single employee details
      // RBAC V2: has_module_access("salaries", "read", establishment_id)
      // =============================================
      case "get": {
        const { user_id } = body;

        if (!user_id) {
          return new Response(
            JSON.stringify({ error: "user_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ========== STEP 0: Deduce establishment_id from target user ==========
        const { establishmentId: targetEstablishmentId, error: deduceError, status: deduceStatus } = 
          await deduceEstablishmentId(supabaseAdmin, user_id);

        if (deduceError) {
          return new Response(
            JSON.stringify({ error: deduceError }),
            { status: deduceStatus, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ========== STEP 1: RBAC V2 check ==========
        const canRead = await checkModuleAccess(supabaseUser, "salaries", "read", targetEstablishmentId!);
        if (!canRead) {
          return new Response(
            JSON.stringify({ error: "Forbidden: No read access to salaries module" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ========== STEP 2: Load permissions V2 for scope enforcement ==========
        const { data: perms, error: permsError } = await supabaseUser.rpc("get_my_permissions_v2", {
          _establishment_id: targetEstablishmentId,
        });
        if (permsError || !perms) {
          return new Response(
            JSON.stringify({ error: "Failed to load permissions" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const salariesPerm = (perms.permissions || []).find((p: { module_key: string }) => p.module_key === "salaries");
        const scope = salariesPerm?.scope ?? "self";
        const teamIds: string[] = perms.team_ids ?? [];
        const callerEstablishmentIds: string[] = perms.establishment_ids ?? [];

        // ========== STEP 3: Validate access based on scope ==========
        const isSelf = user_id === currentUserId;

        if (scope === "self" && !isSelf) {
          return new Response(
            JSON.stringify({ error: "Forbidden: Can only view your own profile" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (scope === "team" && !isSelf) {
          if (teamIds.length === 0) {
            return new Response(
              JSON.stringify({ error: "Forbidden: No team access" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          // Check if target user is in caller's teams
          const { data: targetTeams } = await supabaseAdmin
            .from("user_teams")
            .select("team_id")
            .eq("user_id", user_id)
            .in("team_id", teamIds);
          
          if (!targetTeams || targetTeams.length === 0) {
            return new Response(
              JSON.stringify({ error: "Forbidden: User not in your teams" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        if (scope === "establishment" && !isSelf) {
          if (callerEstablishmentIds.length === 0) {
            return new Response(
              JSON.stringify({ error: "Forbidden: No establishment access" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          // Check if target user is in caller's establishments
          const { data: targetEstabs } = await supabaseAdmin
            .from("user_establishments")
            .select("establishment_id")
            .eq("user_id", user_id)
            .in("establishment_id", callerEstablishmentIds);
          
          if (!targetEstabs || targetEstabs.length === 0) {
            return new Response(
              JSON.stringify({ error: "Forbidden: User not in your establishments" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
        // scope === "org" → no additional check needed (org_id filter below)

        // ========== STEP 4: Get profile with org filter ==========
        const { data: profile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .select("id, user_id, email, full_name, second_first_name, status, created_at")
          .eq("user_id", user_id)
          .eq("organization_id", orgId) // DEFENSE IN DEPTH
          .single();

        if (profileError || !profile) {
          return new Response(
            JSON.stringify({ error: "Employee not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get role
        const { data: userRole } = await supabaseAdmin
          .from("user_roles")
          .select("roles(id, name)")
          .eq("user_id", user_id)
          .maybeSingle();

        // Get establishments
        const { data: userEstabs } = await supabaseAdmin
          .from("user_establishments")
          .select("establishments(id, name)")
          .eq("user_id", user_id);

        // Get teams
        const { data: userTeams } = await supabaseAdmin
          .from("user_teams")
          .select("teams(id, name)")
          .eq("user_id", user_id);

        // Get employee details (may not exist yet)
        const { data: employeeDetails } = await supabaseAdmin
          .from("employee_details")
          .select("*")
          .eq("user_id", user_id)
          .maybeSingle();

        // ========== STEP 5: Check write access for sensitive data ==========
        const canWrite = await checkModuleAccess(supabaseUser, "salaries", "write", targetEstablishmentId!);

        // Build details response based on write access (not hardcoded admin)
        let detailsResponse = null;
        if (employeeDetails) {
          if (canWrite) {
            // Write access: decrypt sensitive data and return full info
            const decryptedIban = await decrypt(employeeDetails.iban_encrypted || "");
            const decryptedSsn = await decrypt(employeeDetails.ssn_encrypted || "");

            // SEC-19: Audit log for sensitive data access (IBAN/SSN decryption)
            const hasIban = !!(employeeDetails.iban_encrypted);
            const hasSsn = !!(employeeDetails.ssn_encrypted);
            if (hasIban || hasSsn) {
              await logAudit("sensitive_data_read", "employee_details", user_id, {
                fields_accessed: [
                  ...(hasIban ? ["iban"] : []),
                  ...(hasSsn ? ["ssn"] : []),
                ],
                establishment_id: targetEstablishmentId,
              });
            }
            
            detailsResponse = {
              phone: employeeDetails.phone,
              address: employeeDetails.address,
              position: employeeDetails.position,
              id_type: employeeDetails.id_type,
              id_issue_date: employeeDetails.id_issue_date,
              id_expiry_date: employeeDetails.id_expiry_date,
              iban: decryptedIban,
              iban_last4: employeeDetails.iban_last4,
              social_security_number: decryptedSsn,
              ssn_last2: employeeDetails.ssn_last2,
              contract_type: employeeDetails.contract_type,
              contract_start_date: employeeDetails.contract_start_date,
              contract_hours: employeeDetails.contract_hours,
              gross_salary: employeeDetails.gross_salary,
              net_salary: employeeDetails.net_salary,
              contract_end_date: employeeDetails.contract_end_date,
              cp_n1: employeeDetails.cp_n1,
              cp_n: employeeDetails.cp_n,
              total_salary: employeeDetails.total_salary,
              has_navigo_pass: employeeDetails.has_navigo_pass ?? false,
              navigo_pass_number: employeeDetails.navigo_pass_number ?? null,
            };
          } else {
            // Read-only: only non-sensitive fields + masked versions
            detailsResponse = {
              phone: employeeDetails.phone,
              address: employeeDetails.address,
              position: employeeDetails.position,
              id_type: employeeDetails.id_type,
              id_issue_date: employeeDetails.id_issue_date,
              id_expiry_date: employeeDetails.id_expiry_date,
              iban: null,
              iban_last4: employeeDetails.iban_last4,
              social_security_number: null,
              ssn_last2: employeeDetails.ssn_last2,
              contract_type: employeeDetails.contract_type,
              contract_start_date: employeeDetails.contract_start_date,
              contract_hours: employeeDetails.contract_hours,
              gross_salary: null,
              net_salary: null,
              contract_end_date: employeeDetails.contract_end_date,
              cp_n1: null,
              cp_n: null,
              total_salary: null,
              has_navigo_pass: employeeDetails.has_navigo_pass ?? false,
              navigo_pass_number: employeeDetails.navigo_pass_number ?? null,
            };
          }
        }

        return new Response(
          JSON.stringify({
            employee: {
              user_id: profile.user_id,
              email: profile.email,
              full_name: profile.full_name,
              second_first_name: profile.second_first_name,
              status: profile.status,
              created_at: profile.created_at,
              role: (userRole as { roles: { id: string; name: string } | null } | null)?.roles || null,
              establishments: (userEstabs || []).map((ue: { establishments: { id: string; name: string } | null }) => ue.establishments).filter(Boolean),
              teams: (userTeams || []).map((ut: { teams: { id: string; name: string } | null }) => ut.teams).filter(Boolean),
              details: detailsResponse,
            },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // =============================================
      // UPDATE: Update employee details
      // RBAC V2: has_module_access("salaries", "write", establishment_id)
      // =============================================
      case "update": {
        const { user_id, details, second_first_name } = body;

        if (!user_id) {
          return new Response(
            JSON.stringify({ error: "user_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ========== STEP 0: Deduce establishment_id from target user ==========
        const { establishmentId: targetEstablishmentId, error: deduceError, status: deduceStatus } = 
          await deduceEstablishmentId(supabaseAdmin, user_id);

        if (deduceError) {
          return new Response(
            JSON.stringify({ error: deduceError }),
            { status: deduceStatus, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ========== STEP 1: Self-update exception (second_first_name only) ==========
        const isSelf = user_id === currentUserId;
        
        if (isSelf && !details) {
          // Self user can update their own second_first_name without write access
          // Verify user exists in this org
          const { data: profile, error: profileError } = await supabaseAdmin
            .from("profiles")
            .select("id, email")
            .eq("user_id", user_id)
            .eq("organization_id", orgId)
            .single();

          if (profileError || !profile) {
            return new Response(
              JSON.stringify({ error: "Employee not found" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Update second_first_name in profiles if provided
          if (second_first_name !== undefined) {
            const { error: profileUpdateError } = await supabaseAdmin
              .from("profiles")
              .update({ second_first_name: second_first_name || null })
              .eq("user_id", user_id);

            if (profileUpdateError) throw profileUpdateError;
          }

          await logAudit("employee_details_updated", "employee", user_id, { 
            email: profile.email,
            second_first_name_updated: second_first_name !== undefined,
            self_update: true,
          });

          return new Response(
            JSON.stringify({ success: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ========== STEP 2: RBAC V2 check for write access ==========
        const canWrite = await checkModuleAccess(supabaseUser, "salaries", "write", targetEstablishmentId!);
        if (!canWrite) {
          return new Response(
            JSON.stringify({ error: "Forbidden: No write access to salaries module" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Verify user exists in this org
        const { data: profile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .select("id, email")
          .eq("user_id", user_id)
          .eq("organization_id", orgId)
          .single();

        if (profileError || !profile) {
          return new Response(
            JSON.stringify({ error: "Employee not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Update second_first_name in profiles if provided
        if (second_first_name !== undefined) {
          const { error: profileUpdateError } = await supabaseAdmin
            .from("profiles")
            .update({ second_first_name: second_first_name || null })
            .eq("user_id", user_id);

          if (profileUpdateError) throw profileUpdateError;
        }

        // Update employee_details if details are provided
        if (details) {
          // Encrypt sensitive data
          const ibanValue = details?.iban || null;
          const ssnValue = details?.social_security_number || null;
          
          const ibanEncrypted = ibanValue ? await encrypt(ibanValue) : null;
          const ssnEncrypted = ssnValue ? await encrypt(ssnValue) : null;
          const ibanLast4 = extractLast4(ibanValue);
          const ssnLast2 = extractLast2(ssnValue);

          // Check if employee_details exists
          const { data: existingDetails } = await supabaseAdmin
            .from("employee_details")
            .select("id")
            .eq("user_id", user_id)
            .maybeSingle();

          // Cohérence métier: si has_navigo_pass=false, forcer navigo_pass_number=null
          const hasNavigoPass = details?.has_navigo_pass ?? false;
          const navigoPassNumber = hasNavigoPass 
            ? (details?.navigo_pass_number?.trim() || null) 
            : null;

          const detailsPayload = {
            phone: details?.phone || null,
            address: details?.address || null,
            position: details?.position || null,
            id_type: details?.id_type || null,
            id_issue_date: details?.id_issue_date || null,
            id_expiry_date: details?.id_expiry_date || null,
            // Store encrypted versions, not plain text
            iban: null, // Always null now - we use iban_encrypted
            social_security_number: null, // Always null now - we use ssn_encrypted
            iban_encrypted: ibanEncrypted,
            ssn_encrypted: ssnEncrypted,
            iban_last4: ibanLast4,
            ssn_last2: ssnLast2,
            encryption_version: ENCRYPTION_VERSION,
            contract_type: details?.contract_type || null,
            contract_start_date: details?.contract_start_date || null,
            contract_hours: details?.contract_hours || null,
            gross_salary: details?.gross_salary || null,
            net_salary: details?.net_salary || null,
            contract_end_date: details?.contract_end_date || null,
            cp_n1: details?.cp_n1 ?? null,
            cp_n: details?.cp_n ?? null,
            total_salary: details?.total_salary ?? null,
            has_navigo_pass: hasNavigoPass,
            navigo_pass_number: navigoPassNumber,
          };

          if (existingDetails) {
            // Update
            const { error: updateError } = await supabaseAdmin
              .from("employee_details")
              .update(detailsPayload)
              .eq("user_id", user_id);

            if (updateError) throw updateError;
          } else {
            // Insert
            const { error: insertError } = await supabaseAdmin
              .from("employee_details")
              .insert({
                user_id,
                organization_id: orgId,
                ...detailsPayload,
              });

            if (insertError) throw insertError;
          }
        }

        // DATA-01: Field-level tracking for sensitive data updates
        const sensitiveFieldsChanged: string[] = [];
        if (body.iban !== undefined) sensitiveFieldsChanged.push("iban");
        if (body.social_security_number !== undefined) sensitiveFieldsChanged.push("ssn");
        if (body.gross_salary !== undefined) sensitiveFieldsChanged.push("gross_salary");
        if (body.net_salary !== undefined) sensitiveFieldsChanged.push("net_salary");
        if (body.total_salary !== undefined) sensitiveFieldsChanged.push("total_salary");

        await logAudit("employee_details_updated", "employee", user_id, { 
          email: profile.email,
          second_first_name_updated: second_first_name !== undefined,
          ...(sensitiveFieldsChanged.length > 0 && { sensitive_fields_changed: sensitiveFieldsChanged }),
        });

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // =============================================
      // SUSPEND: End contract / suspend employee
      // RBAC V2: has_module_access("salaries", "write", establishment_id)
      // =============================================
      case "suspend": {
        const { user_id, contract_end_date } = body;

        if (!user_id) {
          return new Response(
            JSON.stringify({ error: "user_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (!contract_end_date) {
          return new Response(
            JSON.stringify({ error: "contract_end_date is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ========== STEP 0: Deduce establishment_id from target user ==========
        const { establishmentId: targetEstablishmentId, error: deduceError, status: deduceStatus } = 
          await deduceEstablishmentId(supabaseAdmin, user_id);

        if (deduceError) {
          return new Response(
            JSON.stringify({ error: deduceError }),
            { status: deduceStatus, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ========== STEP 1: RBAC V2 check ==========
        const canWrite = await checkModuleAccess(supabaseUser, "salaries", "write", targetEstablishmentId!);
        if (!canWrite) {
          return new Response(
            JSON.stringify({ error: "Forbidden: No write access to salaries module" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Verify user exists and is active
        const { data: profile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .select("id, email, status")
          .eq("user_id", user_id)
          .eq("organization_id", orgId)
          .single();

        if (profileError || !profile) {
          return new Response(
            JSON.stringify({ error: "Employee not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (profile.status !== "active") {
          return new Response(
            JSON.stringify({ error: "Employee is not active" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Update profile status to disabled
        const { error: profileUpdateError } = await supabaseAdmin
          .from("profiles")
          .update({ status: "disabled" })
          .eq("user_id", user_id);

        if (profileUpdateError) throw profileUpdateError;

        // Update or create employee_details with contract_end_date
        const { data: existingDetails } = await supabaseAdmin
          .from("employee_details")
          .select("id")
          .eq("user_id", user_id)
          .maybeSingle();

        if (existingDetails) {
          await supabaseAdmin
            .from("employee_details")
            .update({ contract_end_date })
            .eq("user_id", user_id);
        } else {
          await supabaseAdmin
            .from("employee_details")
            .insert({
              user_id,
              organization_id: orgId,
              contract_end_date,
            });
        }

        await logAudit("employee_contract_ended", "employee", user_id, {
          email: profile.email,
          contract_end_date,
        });

        return new Response(
          JSON.stringify({ success: true, message: "Employee suspended" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // =============================================
      // REACTIVATE: Reintegrate suspended employee
      // RBAC V2: has_module_access("salaries", "write", establishment_id)
      // =============================================
      case "reactivate": {
        const { user_id, reactivate_mode, rehire_start_date } = body;

        if (!user_id) {
          return new Response(
            JSON.stringify({ error: "user_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const mode = reactivate_mode || "mistake";
        if (mode !== "mistake" && mode !== "rehire") {
          return new Response(
            JSON.stringify({ error: "reactivate_mode must be 'mistake' or 'rehire'" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (mode === "rehire" && !rehire_start_date) {
          return new Response(
            JSON.stringify({ error: "rehire_start_date is required for rehire mode" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ========== STEP 0: Deduce establishment_id from target user ==========
        const { establishmentId: targetEstablishmentId, error: deduceError, status: deduceStatus } = 
          await deduceEstablishmentId(supabaseAdmin, user_id);

        if (deduceError) {
          return new Response(
            JSON.stringify({ error: deduceError }),
            { status: deduceStatus, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ========== STEP 1: RBAC V2 check ==========
        const canWrite = await checkModuleAccess(supabaseUser, "salaries", "write", targetEstablishmentId!);
        if (!canWrite) {
          return new Response(
            JSON.stringify({ error: "Forbidden: No write access to salaries module" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Verify user exists and is disabled
        const { data: profile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .select("id, email, status")
          .eq("user_id", user_id)
          .eq("organization_id", orgId)
          .single();

        if (profileError || !profile) {
          return new Response(
            JSON.stringify({ error: "Employee not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (profile.status !== "disabled") {
          return new Response(
            JSON.stringify({ error: "Employee is not suspended" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Update profile status to active
        const { error: profileUpdateError } = await supabaseAdmin
          .from("profiles")
          .update({ status: "active" })
          .eq("user_id", user_id);

        if (profileUpdateError) throw profileUpdateError;

        // Update employee_details based on mode
        if (mode === "mistake") {
          // Just clear contract_end_date
          await supabaseAdmin
            .from("employee_details")
            .update({ contract_end_date: null })
            .eq("user_id", user_id);
        } else {
          // Rehire: clear end date + set new start date
          await supabaseAdmin
            .from("employee_details")
            .update({ 
              contract_end_date: null,
              contract_start_date: rehire_start_date,
            })
            .eq("user_id", user_id);
        }

        await logAudit("employee_reactivated", "employee", user_id, {
          email: profile.email,
          mode,
          rehire_start_date: mode === "rehire" ? rehire_start_date : null,
        });

        return new Response(
          JSON.stringify({ success: true, message: "Employee reactivated", mode }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // =============================================
      // HARD_DELETE: RGPD right-to-erasure — permanently delete employee data
      // Requires admin role (not just write access)
      // WARNING: This action is IRREVERSIBLE
      // =============================================
      case "hard_delete": {
        const { user_id: targetUserId, confirm } = body;

        if (!targetUserId) {
          return new Response(
            JSON.stringify({ error: "user_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Require explicit confirmation
        if (confirm !== true) {
          return new Response(
            JSON.stringify({ error: "Explicit confirmation required: set confirm=true. This action is IRREVERSIBLE." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Prevent self-deletion
        if (targetUserId === currentUserId) {
          return new Response(
            JSON.stringify({ error: "Cannot delete your own account" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // RBAC: Require admin role (hard delete is an admin-only operation)
        const { data: isAdmin, error: adminCheckError } = await supabaseUser.rpc("is_admin", {
          _user_id: currentUserId,
        });
        if (adminCheckError || !isAdmin) {
          return new Response(
            JSON.stringify({ error: "Forbidden: Admin access required for hard delete" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Verify user exists in this organization
        const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
          .from("profiles")
          .select("id, user_id, email, organization_id")
          .eq("user_id", targetUserId)
          .eq("organization_id", orgId)
          .single();

        if (targetProfileError || !targetProfile) {
          return new Response(
            JSON.stringify({ error: "Employee not found in this organization" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Track affected records for the audit summary
        const deletionSummary: Record<string, number | string> = {};

        // ========== STORAGE FILES: Delete employee documents from Storage bucket ==========
        // Must happen BEFORE deleting employee_documents rows (need storage_path)
        const { data: docRows } = await supabaseAdmin
          .from("employee_documents")
          .select("storage_path")
          .eq("user_id", targetUserId);

        if (docRows && docRows.length > 0) {
          const storagePaths = docRows.map((d: { storage_path: string }) => d.storage_path).filter(Boolean);
          if (storagePaths.length > 0) {
            const { error: storageErr } = await supabaseAdmin.storage
              .from("employee-documents")
              .remove(storagePaths);
            if (storageErr) {
              log.error("hard_delete: storage removal error", storageErr);
              deletionSummary.storage_files_error = storageErr.message;
            } else {
              deletionSummary.storage_files_deleted = storagePaths.length;
            }
          }
        }

        // ========== CASCADING DELETE: children first, in dependency order ==========
        // SEC-DATA-031: This is the CANONICAL hard-delete list.
        // employee-archives/hard_delete delegates here to avoid divergence.

        // 1. extra_events (depends on badge_events FK — delete first)
        const { count: extraEventsCount, error: extraEventsErr } = await supabaseAdmin
          .from("extra_events")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (extraEventsErr) log.error("hard_delete: extra_events error", extraEventsErr);
        else deletionSummary.extra_events = extraEventsCount ?? 0;

        // 2. badge_events
        const { count: badgeCount, error: badgeErr } = await supabaseAdmin
          .from("badge_events")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (badgeErr) log.error("hard_delete: badge_events error", badgeErr);
        else deletionSummary.badge_events = badgeCount ?? 0;

        // 3. badge_events_duplicates_archive
        const { count: badgeDupCount, error: badgeDupErr } = await supabaseAdmin
          .from("badge_events_duplicates_archive")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (badgeDupErr) log.error("hard_delete: badge_events_duplicates_archive error", badgeDupErr);
        else deletionSummary.badge_events_duplicates_archive = badgeDupCount ?? 0;

        // 4. badge_pin_failures
        const { count: pinFailCount, error: pinFailErr } = await supabaseAdmin
          .from("badge_pin_failures")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (pinFailErr) log.error("hard_delete: badge_pin_failures error", pinFailErr);
        else deletionSummary.badge_pin_failures = pinFailCount ?? 0;

        // 5. user_badge_pins
        const { count: pinsCount, error: pinsErr } = await supabaseAdmin
          .from("user_badge_pins")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (pinsErr) log.error("hard_delete: user_badge_pins error", pinsErr);
        else deletionSummary.user_badge_pins = pinsCount ?? 0;

        // 6. user_devices
        const { count: devicesCount, error: devicesErr } = await supabaseAdmin
          .from("user_devices")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (devicesErr) log.error("hard_delete: user_devices error", devicesErr);
        else deletionSummary.user_devices = devicesCount ?? 0;

        // 7. personnel_leaves
        const { count: leavesCount, error: leavesErr } = await supabaseAdmin
          .from("personnel_leaves")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (leavesErr) log.error("hard_delete: personnel_leaves error", leavesErr);
        else deletionSummary.personnel_leaves = leavesCount ?? 0;

        // 8. personnel_leave_requests
        const { count: leaveReqCount, error: leaveReqErr } = await supabaseAdmin
          .from("personnel_leave_requests")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (leaveReqErr) log.error("hard_delete: personnel_leave_requests error", leaveReqErr);
        else deletionSummary.personnel_leave_requests = leaveReqCount ?? 0;

        // 9. planning_rextra_events
        const { count: rextraCount, error: rextraErr } = await supabaseAdmin
          .from("planning_rextra_events")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (rextraErr) log.error("hard_delete: planning_rextra_events error", rextraErr);
        else deletionSummary.planning_rextra_events = rextraCount ?? 0;

        // 10. planning_shifts
        const { count: shiftsCount, error: shiftsErr } = await supabaseAdmin
          .from("planning_shifts")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (shiftsErr) log.error("hard_delete: planning_shifts error", shiftsErr);
        else deletionSummary.planning_shifts = shiftsCount ?? 0;

        // 11. payroll_employee_month_validation
        const { count: payrollValCount, error: payrollValErr } = await supabaseAdmin
          .from("payroll_employee_month_validation")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (payrollValErr) log.error("hard_delete: payroll_employee_month_validation error", payrollValErr);
        else deletionSummary.payroll_employee_month_validation = payrollValCount ?? 0;

        // 12. payroll_employee_month_carry
        const { count: payrollCarryCount, error: payrollCarryErr } = await supabaseAdmin
          .from("payroll_employee_month_carry")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (payrollCarryErr) log.error("hard_delete: payroll_employee_month_carry error", payrollCarryErr);
        else deletionSummary.payroll_employee_month_carry = payrollCarryCount ?? 0;

        // 13. payroll_employee_extra_counter
        const { count: payrollExtraCount, error: payrollExtraErr } = await supabaseAdmin
          .from("payroll_employee_extra_counter")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (payrollExtraErr) log.error("hard_delete: payroll_employee_extra_counter error", payrollExtraErr);
        else deletionSummary.payroll_employee_extra_counter = payrollExtraCount ?? 0;

        // 14. employee_details (contains encrypted PII)
        const { count: detailsCount, error: detailsErr } = await supabaseAdmin
          .from("employee_details")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (detailsErr) log.error("hard_delete: employee_details error", detailsErr);
        else deletionSummary.employee_details = detailsCount ?? 0;

        // 15. employee_documents (DB rows — storage files already deleted above)
        const { count: docsCount, error: docsErr } = await supabaseAdmin
          .from("employee_documents")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (docsErr) log.error("hard_delete: employee_documents error", docsErr);
        else deletionSummary.employee_documents = docsCount ?? 0;

        // 16. user_teams
        const { count: teamsCount, error: teamsErr } = await supabaseAdmin
          .from("user_teams")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (teamsErr) log.error("hard_delete: user_teams error", teamsErr);
        else deletionSummary.user_teams = teamsCount ?? 0;

        // 17. user_establishments
        const { count: estabsCount, error: estabsErr } = await supabaseAdmin
          .from("user_establishments")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (estabsErr) log.error("hard_delete: user_establishments error", estabsErr);
        else deletionSummary.user_establishments = estabsCount ?? 0;

        // 18. user_roles
        const { count: rolesCount, error: rolesErr } = await supabaseAdmin
          .from("user_roles")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (rolesErr) log.error("hard_delete: user_roles error", rolesErr);
        else deletionSummary.user_roles = rolesCount ?? 0;

        // 19. invitations (by email)
        const { count: invCount } = await supabaseAdmin
          .from("invitations")
          .delete({ count: "exact" })
          .eq("email", targetProfile.email)
          .eq("organization_id", orgId);
        deletionSummary.invitations = invCount ?? 0;

        // ========== NULLIFY created_by references in operational tables ==========
        // These records belong to the establishment (not the employee), so we
        // nullify the author reference instead of deleting the record.

        // 20. cash_day_reports.created_by / updated_by
        const { count: cashCreatedBy } = await supabaseAdmin
          .from("cash_day_reports")
          .update({ created_by: null })
          .eq("created_by", targetUserId);
        const { count: cashUpdatedBy } = await supabaseAdmin
          .from("cash_day_reports")
          .update({ updated_by: null })
          .eq("updated_by", targetUserId);
        deletionSummary.cash_day_reports_nullified = (cashCreatedBy ?? 0) + (cashUpdatedBy ?? 0);

        // 21. stock_documents.created_by
        const { count: stockDocsNullified } = await supabaseAdmin
          .from("stock_documents")
          .update({ created_by: null })
          .eq("created_by", targetUserId);
        deletionSummary.stock_documents_nullified = stockDocsNullified ?? 0;

        // 22. bl_app_documents.created_by
        const { count: blDocsNullified } = await supabaseAdmin
          .from("bl_app_documents")
          .update({ created_by: null })
          .eq("created_by", targetUserId);
        deletionSummary.bl_app_documents_nullified = blDocsNullified ?? 0;

        // 23. profiles (delete last before auth user)
        const { count: profileCount, error: profileDeleteErr } = await supabaseAdmin
          .from("profiles")
          .delete({ count: "exact" })
          .eq("user_id", targetUserId);
        if (profileDeleteErr) log.error("hard_delete: profiles error", profileDeleteErr);
        else deletionSummary.profiles = profileCount ?? 0;

        // 24. Auth user (last — this triggers CASCADE on any remaining FK to auth.users)
        const { error: authDeleteErr } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
        if (authDeleteErr) {
          log.error("hard_delete: auth user error", authDeleteErr);
          deletionSummary.auth_user_error = authDeleteErr.message;
        } else {
          deletionSummary.auth_user = 1;
        }

        // Audit log (RGPD: log the action and summary, NOT the deleted personal data)
        await logAudit("employee_hard_deleted", "employee", targetUserId, {
          email_hash: targetProfile.email ? `***@${targetProfile.email.split("@")[1]}` : null,
          reason: "RGPD right to erasure",
          deleted_by: currentUserId,
          deletion_summary: deletionSummary,
        });

        return new Response(
          JSON.stringify({
            success: true,
            message: "Employee data permanently deleted (RGPD Art. 17)",
            summary: deletionSummary,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        log.warn("validation_failed", { reason: "unknown_action", action });
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    // SEC-20: Log detailed error server-side, return generic message to client
    log.error("Unhandled error", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

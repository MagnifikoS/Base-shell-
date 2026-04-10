/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EDGE FUNCTION: commandes-api  (v2026-03-04T20:15)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Orchestrator for Commandes B2B V0 + V1 (Stage 2).
 * Actions:
 *   POST ?action=send    → fn_send_commande
 *   POST ?action=open    → fn_open_commande
 *   POST ?action=ship    → fn_ship_commande (Stage 2)
 *   POST ?action=receive → fn_receive_commande (Stage 2)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { createLogger } from "../_shared/logger.ts";
import { sendWebPush } from "../_shared/webpush.ts";

const corsHeaders = makeCorsHeaders("POST, OPTIONS");
const log = createLogger("commandes-api");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PUSH_RETRIES = 1;

function isValidUUID(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

async function deliverPushToUsers(
  admin: ReturnType<typeof createClient>,
  userIds: string[],
  pushPayload: { title: string; body: string; url?: string },
): Promise<void> {
  if (userIds.length === 0) return;

  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPublicKey || !vapidPrivateKey) {
    log.warn("VAPID keys not configured — skipping push delivery");
    return;
  }

  const { data: subscriptions, error: subErr } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  if (subErr || !subscriptions || subscriptions.length === 0) {
    if (subErr) log.warn("Push subscriptions fetch error", { error: subErr.message });
    return;
  }

  const payloadStr = JSON.stringify(pushPayload);

  for (const sub of subscriptions) {
    for (let attempt = 0; attempt <= MAX_PUSH_RETRIES; attempt++) {
      try {
        const response = await sendWebPush(
          sub.endpoint, sub.p256dh, sub.auth,
          payloadStr, vapidPublicKey, vapidPrivateKey,
        );
        if (response.ok) {
          log.info("Push delivered", { user_id: sub.user_id, endpoint: sub.endpoint.slice(0, 50) });
          break;
        }
        if (response.status === 404 || response.status === 410) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
          log.info("Cleaned expired push subscription", { id: sub.id });
          break;
        }
        if (attempt === MAX_PUSH_RETRIES) {
          log.warn("Push delivery failed after retries", { status: response.status, user_id: sub.user_id });
        }
      } catch (err) {
        if (attempt === MAX_PUSH_RETRIES) {
          log.warn("Push delivery exception", { error: (err as Error).message, user_id: sub.user_id });
        }
      }
    }
  }
}

/**
 * Filter user IDs to only those who have at least "read" access to "commandes" module.
 * Checks user_roles → role_permissions for the given establishment.
 * Also includes platform admins (is_admin RPC).
 */
async function filterUsersByCommandeAccess(
  admin: ReturnType<typeof createClient>,
  userIds: string[],
  establishmentId: string,
): Promise<string[]> {
  if (userIds.length === 0) return [];

  // Get roles assigned to these users for this establishment
  const { data: userRoles } = await admin
    .from("user_roles")
    .select("user_id, role_id")
    .in("user_id", userIds)
    .eq("establishment_id", establishmentId);

  if (!userRoles || userRoles.length === 0) {
    // No roles assigned → check if any are platform admins
    const adminIds: string[] = [];
    for (const uid of userIds) {
      const { data: adm } = await admin.rpc("is_admin", { _user_id: uid });
      if (adm) adminIds.push(uid);
    }
    return adminIds;
  }

  // Get role IDs that have commandes access (read or write)
  const roleIds = [...new Set(userRoles.map((ur: { role_id: string }) => ur.role_id))];
  const { data: perms } = await admin
    .from("role_permissions")
    .select("role_id, access_level")
    .in("role_id", roleIds)
    .eq("module_key", "commandes");

  const allowedRoleIds = new Set(
    (perms ?? [])
      .filter((p: { access_level: string }) => p.access_level !== "none")
      .map((p: { role_id: string }) => p.role_id)
  );

  // Users who have at least one allowed role
  const allowedByRole = new Set(
    userRoles
      .filter((ur: { role_id: string }) => allowedRoleIds.has(ur.role_id))
      .map((ur: { user_id: string }) => ur.user_id)
  );

  // Also check platform admins for users not covered by roles
  for (const uid of userIds) {
    if (!allowedByRole.has(uid)) {
      const { data: adm } = await admin.rpc("is_admin", { _user_id: uid });
      if (adm) allowedByRole.add(uid);
    }
  }

  return userIds.filter((uid) => allowedByRole.has(uid));
}

function jsonErr(status: number, error: string, details?: unknown) {
  // D — Never leak raw PostgreSQL errors to the client
  return new Response(
    JSON.stringify({ ok: false, error, ...(status < 500 && details ? { details } : {}) }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function jsonOk(data: unknown) {
  return new Response(
    JSON.stringify(data),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * Helper: fetch commande with establishment names
 */
async function fetchCommandeContext(admin: ReturnType<typeof createClient>, commandeId: string) {
  const { data: commande } = await admin
    .from("commandes")
    .select("id, client_establishment_id, supplier_establishment_id, created_by, shipped_by, establishments!commandes_client_establishment_id_fkey(organization_id)")
    .eq("id", commandeId)
    .single();

  if (!commande) return null;

  const { data: establishments } = await admin
    .from("establishments")
    .select("id, name")
    .in("id", [commande.client_establishment_id, commande.supplier_establishment_id]);

  const clientName = establishments?.find(
    (e: { id: string; name: string }) => e.id === commande.client_establishment_id
  )?.name || "Client";
  const supplierName = establishments?.find(
    (e: { id: string; name: string }) => e.id === commande.supplier_establishment_id
  )?.name || "Fournisseur";

  return { commande, clientName, supplierName };
}

Deno.serve(async (req) => {
  console.log("commandes-api version 2026-03-04T20:15");
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonErr(405, "Method not allowed");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const svcRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonErr(401, "Missing authorization");

  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !user) return jsonErr(401, "Unauthorized");

  const admin = createClient(supabaseUrl, svcRoleKey);

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    const body = await req.json().catch(() => ({}));

    switch (action) {
      // ── SEND ──
      case "send": {
        const { commande_id } = body;
        if (!isValidUUID(commande_id)) return jsonErr(400, "Invalid commande_id");

        // Resolve client establishment from DB (never trust body)
        const { data: cmdSend } = await admin
          .from("commandes")
          .select("client_establishment_id")
          .eq("id", commande_id)
          .single();
        if (!cmdSend) return jsonErr(404, "Commande not found");

        const { data: hasAccess } = await supabaseUser.rpc("has_module_access", {
          _module_key: "commandes",
          _min_level: "write",
          _establishment_id: cmdSend.client_establishment_id,
        });
        if (!hasAccess) return jsonErr(403, "Access denied");

        const { data: result, error: rpcErr } = await admin.rpc("fn_send_commande", {
          p_commande_id: commande_id,
        });
        if (rpcErr) {
          log.error("fn_send_commande failed", null, { rpc_message: rpcErr.message, rpc_details: rpcErr.details, rpc_hint: rpcErr.hint, rpc_code: rpcErr.code });
          return jsonErr(500, "send_failed");
        }
        if (!result?.ok) {
          // Forward unconvertible_prices detail to frontend
          if (result?.error === "unconvertible_prices" && result?.lines) {
            return new Response(JSON.stringify({
              ok: false,
              error: "unconvertible_prices",
              lines: result.lines,
            }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          return jsonErr(400, result?.error || "send_failed");
        }

        const ctx = await fetchCommandeContext(admin, commande_id);

        if (ctx) {
          const { data: rules } = await admin
            .from("notification_rules")
            .select("id, alert_type")
            .in("alert_type", ["commande_envoyee", "commande_recue"]);

          const envoyeeRule = rules?.find((r: { alert_type: string }) => r.alert_type === "commande_envoyee");
          const recueRule = rules?.find((r: { alert_type: string }) => r.alert_type === "commande_recue");

          const { data: allSupplierMembers } = await admin
            .from("user_establishments")
            .select("user_id")
            .eq("establishment_id", ctx.commande.supplier_establishment_id);

          const supplierMembers = allSupplierMembers
            ? await filterUsersByCommandeAccess(
                admin,
                allSupplierMembers.map((m: { user_id: string }) => m.user_id),
                ctx.commande.supplier_establishment_id,
              ).then((ids) => ids.map((user_id) => ({ user_id })))
            : null;

          const notifEvents = [];

          if (envoyeeRule) {
            notifEvents.push({
              rule_id: envoyeeRule.id,
              establishment_id: ctx.commande.client_establishment_id,
              alert_key: `commande_envoyee:${ctx.commande.id}:${ctx.commande.created_by}`,
              alert_type: "commande_envoyee",
              recipient_user_id: ctx.commande.created_by,
              payload: {
                title: "Commande envoyée",
                body: `Votre commande a été envoyée à ${ctx.supplierName}`,
                commande_id: ctx.commande.id,
              },
            });
          }

          if (recueRule && supplierMembers) {
            for (const member of supplierMembers) {
              notifEvents.push({
                rule_id: recueRule.id,
                establishment_id: ctx.commande.supplier_establishment_id,
                alert_key: `commande_recue:${ctx.commande.id}:${member.user_id}`,
                alert_type: "commande_recue",
                recipient_user_id: member.user_id,
                payload: {
                  title: "Nouvelle commande reçue",
                  body: `Commande reçue de ${ctx.clientName}`,
                  commande_id: ctx.commande.id,
                },
              });
            }
          }

          if (notifEvents.length > 0) {
            const { error: notifErr } = await admin.from("notification_events").insert(notifEvents);
            if (notifErr && !notifErr.message.includes("duplicate")) {
              log.warn("Notification insert partial failure", { error: notifErr.message });
            }

            const pushRecipients = notifEvents
              .filter((e: { alert_type: string }) => e.alert_type === "commande_recue")
              .map((e: { recipient_user_id: string }) => e.recipient_user_id);
            if (pushRecipients.length > 0) {
              await deliverPushToUsers(admin, pushRecipients, {
                title: "Nouvelle commande reçue",
                body: `Commande reçue de ${ctx.clientName}`,
                url: "/commandes",
              });
            }

            await deliverPushToUsers(admin, [ctx.commande.created_by], {
              title: "Commande envoyée",
              body: `Votre commande a été envoyée à ${ctx.supplierName}`,
              url: "/commandes",
            });
          }

          await admin.from("audit_logs").insert({
            organization_id: (ctx.commande.establishments as { organization_id: string })?.organization_id ?? commande_id,
            user_id: user.id,
            action: "commande_sent",
            target_type: "commande",
            target_id: commande_id,
            metadata: { line_count: result.line_count },
          }).then(({ error: auditErr }) => {
            if (auditErr) log.warn("Audit log failed", { error: auditErr.message });
          });
        }

        log.info("Commande sent", { commande_id, user_id: user.id });
        return jsonOk(result);
      }

      // ── OPEN ──
      case "open": {
        const { commande_id } = body;
        if (!isValidUUID(commande_id)) return jsonErr(400, "Invalid commande_id");

        // Fetch commande to get supplier establishment for RBAC scope check
        const { data: cmdOpen } = await admin
          .from("commandes")
          .select("supplier_establishment_id")
          .eq("id", commande_id)
          .single();
        if (!cmdOpen) return jsonErr(404, "Commande not found");

        const { data: hasAccessOpen } = await supabaseUser.rpc("has_module_access", {
          _module_key: "commandes",
          _min_level: "write",
          _establishment_id: cmdOpen.supplier_establishment_id,
        });
        if (!hasAccessOpen) return jsonErr(403, "Access denied");

        const { data: result, error: rpcErr } = await admin.rpc("fn_open_commande", {
          p_commande_id: commande_id,
          p_user_id: user.id,
        });
        if (rpcErr) {
          log.error("fn_open_commande failed", null, { rpc_message: rpcErr.message, rpc_details: rpcErr.details, rpc_hint: rpcErr.hint, rpc_code: rpcErr.code });
          return jsonErr(500, "open_failed");
        }
        if (!result?.ok) {
          return jsonErr(400, result?.error || "open_failed");
        }

        if (!result.already_opened) {
          const ctx = await fetchCommandeContext(admin, commande_id);
          if (ctx) {
            const { data: supplierEst } = await admin
              .from("establishments")
              .select("name")
              .eq("id", ctx.commande.supplier_establishment_id)
              .single();

            const { data: ouverteRule } = await admin
              .from("notification_rules")
              .select("id")
              .eq("alert_type", "commande_ouverte")
              .single();

            if (ouverteRule) {
              const notifBody = `${supplierEst?.name || "Le fournisseur"} a consulté votre commande (verrouillée)`;
              await admin.from("notification_events").insert({
                rule_id: ouverteRule.id,
                establishment_id: ctx.commande.client_establishment_id,
                alert_key: `commande_ouverte:${ctx.commande.id}:${ctx.commande.created_by}`,
                alert_type: "commande_ouverte",
                recipient_user_id: ctx.commande.created_by,
                payload: {
                  title: "Commande consultée",
                  body: notifBody,
                  commande_id: ctx.commande.id,
                },
              }).then(({ error }) => {
                if (error && !error.message.includes("duplicate")) {
                  log.warn("Notif insert failed", { error: error.message });
                }
              });

              await deliverPushToUsers(admin, [ctx.commande.created_by], {
                title: "Commande consultée",
                body: notifBody,
                url: "/commandes",
              });
            }

            await admin.from("audit_logs").insert({
              organization_id: (ctx.commande.establishments as { organization_id: string })?.organization_id ?? ctx.commande.client_establishment_id,
              user_id: user.id,
              action: "commande_opened",
              target_type: "commande",
              target_id: commande_id,
              metadata: {},
            }).then(({ error: auditErr }) => {
              if (auditErr) log.warn("Audit log failed", { error: auditErr.message });
            });
          }
        }

        log.info("Commande opened", { commande_id, user_id: user.id, already: result.already_opened });
        return jsonOk(result);
      }

      // ── SHIP (Stage 2) ──
      case "ship": {
        const { commande_id, lines } = body;
        if (!isValidUUID(commande_id)) return jsonErr(400, "Invalid commande_id");
        if (!Array.isArray(lines) || lines.length === 0) return jsonErr(400, "Missing lines");

        // Fetch commande to get supplier establishment for RBAC scope check
        const { data: cmdShip } = await admin
          .from("commandes")
          .select("supplier_establishment_id")
          .eq("id", commande_id)
          .single();
        if (!cmdShip) return jsonErr(404, "Commande not found");

        const { data: hasAccessShip } = await supabaseUser.rpc("has_module_access", {
          _module_key: "commandes",
          _min_level: "write",
          _establishment_id: cmdShip.supplier_establishment_id,
        });
        if (!hasAccessShip) return jsonErr(403, "Access denied");

        // Atomic RPC — p_lines must be passed as raw array (not stringified) for jsonb
        const { data: result, error: rpcErr } = await admin.rpc("fn_ship_commande", {
          p_commande_id: commande_id,
          p_user_id: user.id,
          p_lines: lines,
        });
        if (rpcErr) {
          log.error("fn_ship_commande failed", null, { rpc_message: rpcErr.message, rpc_details: rpcErr.details, rpc_hint: rpcErr.hint, rpc_code: rpcErr.code });
          return jsonErr(500, "ship_failed");
        }
        if (!result?.ok) {
          return jsonErr(400, result?.error || "ship_failed");
        }

        // Notifications — determine partial/complete from DB truth, not frontend input
        const ctx = await fetchCommandeContext(admin, commande_id);
        if (ctx) {
          const { data: shippedLines } = await admin
            .from("commande_lines")
            .select("line_status, shipped_quantity, canonical_quantity")
            .eq("commande_id", commande_id);

          const isPartial = shippedLines?.some(
            (l: { line_status: string | null; shipped_quantity: number | null; canonical_quantity: number }) =>
              l.line_status === "rupture" || l.line_status === "modifie" ||
              (l.shipped_quantity != null && l.shipped_quantity < l.canonical_quantity)
          ) ?? false;
          const alertType = isPartial ? "commande_expediee_partielle" : "commande_expediee_complete";
          const labelType = isPartial ? "partiellement expédiée" : "expédiée";

          const { data: expedieeRule } = await admin
            .from("notification_rules")
            .select("id")
            .eq("alert_type", alertType)
            .single();

          // Notify client members with commandes access
          const { data: allClientMembers } = await admin
            .from("user_establishments")
            .select("user_id")
            .eq("establishment_id", ctx.commande.client_establishment_id);

          const clientMembers = allClientMembers
            ? await filterUsersByCommandeAccess(
                admin,
                allClientMembers.map((m: { user_id: string }) => m.user_id),
                ctx.commande.client_establishment_id,
              ).then((ids) => ids.map((user_id) => ({ user_id })))
            : null;

          if (expedieeRule && clientMembers) {
            const notifEvents = clientMembers.map((m: { user_id: string }) => ({
              rule_id: expedieeRule.id,
              establishment_id: ctx.commande.client_establishment_id,
              alert_key: `${alertType}:${ctx.commande.id}:${m.user_id}`,
              alert_type: alertType,
              recipient_user_id: m.user_id,
              payload: {
                title: "Commande expédiée",
                body: `Votre commande a été ${labelType} par ${ctx.supplierName}`,
                commande_id: ctx.commande.id,
              },
            }));

            const { error: notifErr } = await admin.from("notification_events").insert(notifEvents);
            if (notifErr && !notifErr.message.includes("duplicate")) {
              log.warn("Notif insert failed", { error: notifErr.message });
            }

            await deliverPushToUsers(
              admin,
              clientMembers.map((m: { user_id: string }) => m.user_id),
              {
                title: "Commande expédiée",
                body: `Votre commande a été ${labelType} par ${ctx.supplierName}`,
                url: "/commandes",
              }
            );
          }

          await admin.from("audit_logs").insert({
            organization_id: (ctx.commande.establishments as { organization_id: string })?.organization_id ?? ctx.commande.client_establishment_id,
            user_id: user.id,
            action: "commande_shipped",
            target_type: "commande",
            target_id: commande_id,
            metadata: { line_count: result.line_count },
          }).then(({ error: auditErr }) => {
            if (auditErr) log.warn("Audit log failed", { error: auditErr.message });
          });
        }

        log.info("Commande shipped", { commande_id, user_id: user.id });
        return jsonOk(result);
      }

      // ── RECEIVE (Stage 2) ──
      case "receive": {
        const { commande_id, lines } = body;
        if (!isValidUUID(commande_id)) return jsonErr(400, "Invalid commande_id");
        if (!Array.isArray(lines) || lines.length === 0) return jsonErr(400, "Missing lines");

        // Resolve client establishment from DB (never trust body)
        const { data: cmdReceive } = await admin
          .from("commandes")
          .select("client_establishment_id")
          .eq("id", commande_id)
          .single();
        if (!cmdReceive) return jsonErr(404, "Commande not found");

        const { data: hasAccess } = await supabaseUser.rpc("has_module_access", {
          _module_key: "commandes",
          _min_level: "write",
          _establishment_id: cmdReceive.client_establishment_id,
        });
        if (!hasAccess) return jsonErr(403, "Access denied");

        // Atomic RPC — p_lines must be passed as raw array (not stringified) for jsonb
        const { data: result, error: rpcErr } = await admin.rpc("fn_receive_commande", {
          p_commande_id: commande_id,
          p_user_id: user.id,
          p_lines: lines,
        });
        if (rpcErr) {
          log.error("fn_receive_commande failed", null, { rpc_message: rpcErr.message, rpc_details: rpcErr.details, rpc_hint: rpcErr.hint, rpc_code: rpcErr.code });
          return jsonErr(500, "receive_failed");
        }
        if (!result?.ok) {
          return jsonErr(400, result?.error || "receive_failed");
        }

        // Litige is now created atomically inside fn_receive_commande
        const hasLitige = result.has_litige === true;

        // Notifications
        const ctx = await fetchCommandeContext(admin, commande_id);
        if (ctx) {
          const receptionType = result.reception_type === "complete" ? "complète" : "partielle";
          const alertType = hasLitige
            ? "commande_litige"
            : result.reception_type === "complete"
              ? "commande_reception_validee_complete"
              : "commande_reception_validee_partielle";

          const notifTitle = hasLitige ? "Commande en litige" : "Réception validée";
          const notifBody = hasLitige
            ? `${ctx.clientName} a signalé des écarts sur la commande`
            : `${ctx.clientName} a validé la réception — ${receptionType}`;

          const { data: recueRule } = await admin
            .from("notification_rules")
            .select("id")
            .eq("alert_type", alertType)
            .single();

          const { data: allSupplierMembers2 } = await admin
            .from("user_establishments")
            .select("user_id")
            .eq("establishment_id", ctx.commande.supplier_establishment_id);

          const supplierMembers = allSupplierMembers2
            ? await filterUsersByCommandeAccess(
                admin,
                allSupplierMembers2.map((m: { user_id: string }) => m.user_id),
                ctx.commande.supplier_establishment_id,
              ).then((ids) => ids.map((user_id) => ({ user_id })))
            : null;

          if (recueRule && supplierMembers) {
            const notifEvents = supplierMembers.map((m: { user_id: string }) => ({
              rule_id: recueRule.id,
              establishment_id: ctx.commande.supplier_establishment_id,
              alert_key: `${alertType}:${ctx.commande.id}:${m.user_id}`,
              alert_type: alertType,
              recipient_user_id: m.user_id,
              payload: { title: notifTitle, body: notifBody, commande_id: ctx.commande.id },
            }));

            const { error: notifErr } = await admin.from("notification_events").insert(notifEvents);
            if (notifErr && !notifErr.message.includes("duplicate")) {
              log.warn("Notif insert failed", { error: notifErr.message });
            }

            await deliverPushToUsers(
              admin,
              supplierMembers.map((m: { user_id: string }) => m.user_id),
              { title: notifTitle, body: notifBody, url: "/commandes" }
            );
          }

          await admin.from("audit_logs").insert({
            organization_id: (ctx.commande.establishments as { organization_id: string })?.organization_id ?? ctx.commande.client_establishment_id,
            user_id: user.id,
            action: hasLitige ? "commande_litige_created" : "commande_received",
            target_type: "commande",
            target_id: commande_id,
            metadata: { reception_type: result.reception_type, line_count: result.line_count, has_litige: hasLitige },
          }).then(({ error: auditErr }) => {
            if (auditErr) log.warn("Audit log failed", { error: auditErr.message });
          });
        }

        log.info("Commande received", { commande_id, user_id: user.id, type: result.reception_type, has_litige: hasLitige });
        return jsonOk(result);
      }

      // ── RESOLVE LITIGE (Stage 4) ──
      case "resolve_litige": {
        const { litige_id } = body;
        if (!isValidUUID(litige_id)) return jsonErr(400, "Invalid litige_id");

        // Fetch litige → commande → supplier establishment for RBAC
        const { data: litigeRow } = await admin
          .from("litiges")
          .select("commande_id")
          .eq("id", litige_id)
          .single();
        let resolveEstId: string | null = null;
        if (litigeRow?.commande_id) {
          const { data: cmdResolve } = await admin.from("commandes").select("supplier_establishment_id").eq("id", litigeRow.commande_id).single();
          resolveEstId = cmdResolve?.supplier_establishment_id ?? null;
        }

        const { data: hasAccessResolve } = await supabaseUser.rpc("has_module_access", {
          _module_key: "commandes",
          _min_level: "write",
          _establishment_id: resolveEstId,
        });
        if (!hasAccessResolve) return jsonErr(403, "Access denied");

        const { data: result, error: rpcErr } = await admin.rpc("fn_resolve_litige", {
          p_litige_id: litige_id,
          p_user_id: user.id,
        });
        if (rpcErr) {
          log.error("fn_resolve_litige failed", null, { rpc_message: rpcErr.message ?? "none", rpc_details: rpcErr.details ?? "none", rpc_hint: rpcErr.hint ?? "none", rpc_code: rpcErr.code ?? "none", raw: JSON.stringify(rpcErr) });
          return jsonErr(500, "resolve_failed");
        }
        if (!result?.ok) {
          return jsonErr(400, result?.error || "resolve_failed");
        }

        // Notify client that litige is resolved
        const { data: litigeRowNotif } = await admin
          .from("litiges")
          .select("commande_id")
          .eq("id", litige_id)
          .single();

        if (litigeRowNotif) {
          const ctx = await fetchCommandeContext(admin, litigeRowNotif.commande_id);
          if (ctx) {
            const { data: litigeRule } = await admin
              .from("notification_rules")
              .select("id")
              .eq("alert_type", "commande_litige_resolue")
              .single();

            const { data: allClientMembers2 } = await admin
              .from("user_establishments")
              .select("user_id")
              .eq("establishment_id", ctx.commande.client_establishment_id);

            const clientMembers = allClientMembers2
              ? await filterUsersByCommandeAccess(
                  admin,
                  allClientMembers2.map((m: { user_id: string }) => m.user_id),
                  ctx.commande.client_establishment_id,
                ).then((ids) => ids.map((user_id) => ({ user_id })))
              : null;

            if (litigeRule && clientMembers) {
              const notifEvents = clientMembers.map((m: { user_id: string }) => ({
                rule_id: litigeRule.id,
                establishment_id: ctx.commande.client_establishment_id,
                alert_key: `commande_litige_resolue:${litigeRowNotif.commande_id}:${m.user_id}`,
                alert_type: "commande_litige_resolue",
                recipient_user_id: m.user_id,
                payload: {
                  title: "Litige confirmé",
                  body: `${ctx.supplierName} a validé la correction`,
                  commande_id: litigeRowNotif.commande_id,
                },
              }));
              await admin.from("notification_events").insert(notifEvents);
              await deliverPushToUsers(
                admin,
                clientMembers.map((m: { user_id: string }) => m.user_id),
                { title: "Litige confirmé", body: `${ctx.supplierName} a validé la correction`, url: "/commandes" }
              );
            }

            await admin.from("audit_logs").insert({
              organization_id: (ctx.commande.establishments as { organization_id: string })?.organization_id ?? ctx.commande.client_establishment_id,
              user_id: user.id,
              action: "litige_resolved",
              target_type: "commande",
              target_id: litigeRowNotif.commande_id,
              metadata: { litige_id, adjusted_lines: result.adjusted_lines },
            });
          }
        }

        log.info("Litige resolved", { litige_id, user_id: user.id });
        return jsonOk(result);
      }

      // ── CANCEL SHIPMENT ──
      case "cancel_shipment": {
        const { commande_id } = body;
        if (!isValidUUID(commande_id)) return jsonErr(400, "Invalid commande_id");

        // Resolve supplier establishment for RBAC (supplier cancels their own shipment)
        const { data: cmdCancel } = await admin
          .from("commandes")
          .select("supplier_establishment_id")
          .eq("id", commande_id)
          .single();
        if (!cmdCancel) return jsonErr(404, "Commande not found");

        const { data: hasAccessCancel } = await supabaseUser.rpc("has_module_access", {
          _module_key: "commandes",
          _min_level: "write",
          _establishment_id: cmdCancel.supplier_establishment_id,
        });
        if (!hasAccessCancel) return jsonErr(403, "Access denied");

        const { data: result, error: rpcErr } = await admin.rpc("fn_cancel_b2b_shipment", {
          p_commande_id: commande_id,
          p_user_id: user.id,
        });
        if (rpcErr) {
          log.error("fn_cancel_b2b_shipment failed", null, { rpc_message: rpcErr.message, rpc_details: rpcErr.details });
          return jsonErr(500, "cancel_shipment_failed");
        }
        if (!result?.ok) {
          return jsonErr(400, result?.error || "cancel_shipment_failed", { message: result?.message });
        }

        log.info("Shipment cancelled", { commande_id, user_id: user.id, voided: result.voided_documents });
        return jsonOk(result);
      }

      default:
        return jsonErr(400, `Unknown action: ${action}`);
    }
  } catch (err) {
    log.error("Unhandled error", err);
    return jsonErr(500, "Internal server error");
  }
});

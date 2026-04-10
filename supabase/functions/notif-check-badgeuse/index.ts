/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EDGE FUNCTION: notif-check-badgeuse
 * 
 * NotifEngine V2.9 — Split no_badge into no_badge_arrival / no_badge_departure
 * 
 * Detects:
 *   A) "late" — employee clocked in but late_minutes > threshold
 *   B) "no_badge_arrival" — shift started but NO clock_in after threshold
 *   C) "no_badge_departure" — shift ended, clock_in present, no clock_out after threshold
 *   D) "missing_clock_out" — legacy: shift ended, clock_in present, no clock_out
 * 
 * Each anomaly type gets its own incident. No bestRule recalculation at send time.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { sendWebPush } from "../_shared/webpush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-cron-secret, x-idempotency-key",
};

// ═══ Constants ═══
const MAX_PUSH_RETRIES = 2;
const RETRY_BASE_MS = 500;
const MAX_INCIDENTS_PER_ESTABLISHMENT = 50;
const EXECUTION_TIMEOUT_MS = 25_000;
const INCIDENT_REOPEN_COOLDOWN_MINUTES = 30;
const MISSING_CLOCK_OUT_TTL_HOURS = 12;

function backoffSleep(attempt: number): Promise<void> {
  const delay = RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 200;
  return new Promise(r => setTimeout(r, delay));
}

function isRetryable(status: number): boolean {
  return status >= 500 || status === 429;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const executionStart = Date.now();

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const svcRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronSecret = Deno.env.get("NOTIF_CRON_SECRET");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const DEBUG = Deno.env.get("NOTIF_ENGINE_DEBUG") === "true";

  // ═══ KILL SWITCH ═══
  const engineMode = Deno.env.get("NOTIF_ENGINE_DISABLED") === "true"
    ? "disabled"
    : (Deno.env.get("NOTIF_ENGINE_MODE") || "full");

  if (engineMode === "disabled") {
    console.log("[notif-check] Engine DISABLED via kill switch");
    return new Response(
      JSON.stringify({ disabled: true, mode: "disabled" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const DETECT_ONLY = engineMode === "detect_only";

  try {
    // ═══ Auth guard ═══
    const authHeader = req.headers.get("Authorization");
    const cronSecretHeader = req.headers.get("x-cron-secret");
    const isServiceRole = authHeader === `Bearer ${svcRoleKey}`;
    const hasCronSecret = !!(cronSecret && cronSecretHeader && cronSecretHeader === cronSecret);

    let authMethod = "none";

    if (isServiceRole) {
      authMethod = "service_role";
    } else if (hasCronSecret) {
      authMethod = "cron_secret";
    } else if (authHeader?.startsWith("Bearer ")) {
      try {
        const userClient = createClient(supabaseUrl, anonKey || svcRoleKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: userData, error: getUserError } = await userClient.auth.getUser();
        if (!getUserError && userData?.user) {
          const adminClient = createClient(supabaseUrl, svcRoleKey);
          const { data: adminCheck } = await adminClient.rpc("is_admin", { _user_id: userData.user.id });
          if (adminCheck) authMethod = "admin_jwt";
        }
      } catch { /* auth failed */ }
    }

    if (authMethod === "none") {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══ Parse body & dryRun ═══
    let bodyJson: Record<string, unknown> = {};
    try { bodyJson = await req.clone().json(); } catch { /* no body */ }
    const url = new URL(req.url);
    const isDryRun = url.searchParams.get("dryRun") === "1" || bodyJson.dryRun === true;

    const admin = createClient(supabaseUrl, svcRoleKey);

    // ═══ VAPID check ═══
    if (!vapidPrivateKey || !vapidPublicKey) {
      return new Response(
        JSON.stringify({ error: "VAPID keys not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══ Current time (Paris) for display only ═══
    const nowParis = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" }));
    const currentHour = nowParis.getHours();
    const currentMinute = nowParis.getMinutes();
    const currentTimeStr = `${String(currentHour).padStart(2, "0")}:${String(currentMinute).padStart(2, "0")}`;
    const nowUtcIso = new Date().toISOString();

    // ═══ SSOT: Service day per establishment via RPC + cutoff ═══
    function getParisOffsetHours(dateStr: string): number {
      const refDate = new Date(`${dateStr}T12:00:00Z`);
      const parisFormatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Paris",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = parisFormatter.formatToParts(refDate);
      const parisHour = parseInt(parts.find((p) => p.type === "hour")?.value || "12", 10);
      return parisHour - 12;
    }

    function parisToUtcIso(dateStr: string, timeHHMM: string): string {
      const [h, m] = timeHHMM.split(":").map(Number);
      const offset = getParisOffsetHours(dateStr);
      const utcDate = new Date(`${dateStr}T00:00:00Z`);
      utcDate.setUTCHours(h - offset, m, 0, 0);
      return utcDate.toISOString();
    }

    function fmtDate(d: Date): string {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    function nextDay(dateStr: string): string {
      const [y, mo, d] = dateStr.split("-").map(Number);
      const nd = new Date(y, mo - 1, d + 1);
      return fmtDate(nd);
    }

    interface EstServiceDay {
      serviceDay: string;
      cutoff: string;
      startUtc: string;
      endUtc: string;
    }
    const estServiceDays = new Map<string, EstServiceDay>();

    if (DEBUG) console.log(`[notif-check][DEBUG] time=${currentTimeStr} nowUtc=${nowUtcIso}`);

    // ═══ Fetch enabled rules ═══
    const { data: rules, error: rulesErr } = await admin
      .from("notification_rules")
      .select("*")
      .eq("category", "badgeuse")
      .eq("enabled", true)
      .order("priority", { ascending: true });

    if (rulesErr) {
      console.error("[notif-check] Rules error:", rulesErr.message);
      return new Response(JSON.stringify({ error: rulesErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!rules || rules.length === 0) {
      return new Response(JSON.stringify({ processed: 0, sent: 0, message: "No active rules" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const allEstablishmentIds = [...new Set(rules.map((r: Record<string, unknown>) => r.establishment_id as string))];

    // ═══ Debug endpoint ═══
    if (req.method === "GET" && DEBUG) {
      const estId = url.searchParams.get("establishment_id");
      if (estId) {
        const [evRes, ruRes, subRes] = await Promise.all([
          admin.from("notification_events").select("id, alert_key, alert_type, recipient_user_id, sent_at, payload").eq("establishment_id", estId).order("sent_at", { ascending: false }).limit(50),
          admin.from("notification_rules").select("id, alert_type, enabled, priority, scope, recipient_role_ids").eq("establishment_id", estId),
          admin.from("push_subscriptions").select("id, user_id, establishment_id").or(`establishment_id.eq.${estId},establishment_id.is.null`),
        ]);
        return new Response(JSON.stringify({ events: evRes.data?.length ?? 0, rules: ruRes.data?.length ?? 0, subscriptions: subRes.data?.length ?? 0, recent_events: evRes.data?.slice(0, 10), rules_detail: ruRes.data }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ═══ SSOT: Fetch service day + cutoff per establishment ═══
    const { data: estCutoffs } = await admin
      .from("establishments")
      .select("id, service_day_cutoff")
      .in("id", allEstablishmentIds);

    const serviceDayResults = await Promise.all(
      allEstablishmentIds.map(async (estId) => {
        const { data } = await admin.rpc("get_service_day_now", { _establishment_id: estId });
        return { estId, serviceDay: data as string | null };
      })
    );

    for (const { estId, serviceDay } of serviceDayResults) {
      if (!serviceDay) {
        console.warn(`[notif-check] No service day returned for ${estId}, skipping`);
        continue;
      }
      const estRow = (estCutoffs || []).find(e => e.id === estId);
      const rawCutoff = (estRow?.service_day_cutoff as string) ?? "03:00:00";
      const cutoff = rawCutoff.slice(0, 5);

      const startUtc = parisToUtcIso(serviceDay, cutoff);
      const endUtc = parisToUtcIso(nextDay(serviceDay), cutoff);

      estServiceDays.set(estId, { serviceDay, cutoff, startUtc, endUtc });

      if (DEBUG) console.log(`[notif-check][DEBUG] est=${estId} serviceDay=${serviceDay} cutoff=${cutoff} range=[${startUtc}, ${endUtc})`);
    }

    // ═══ Pre-fetch caches ═══
    const estShiftsCache = new Map<string, Array<Record<string, unknown>>>();
    const estBadgesCache = new Map<string, Array<Record<string, unknown>>>();

    async function getEstShifts(estId: string) {
      if (estShiftsCache.has(estId)) return estShiftsCache.get(estId)!;
      const sd = estServiceDays.get(estId);
      if (!sd) { estShiftsCache.set(estId, []); return []; }
      const { data } = await admin
        .from("planning_shifts")
        .select("id, user_id, shift_date, start_time, end_time")
        .eq("establishment_id", estId)
        .eq("shift_date", sd.serviceDay);
      const result = data || [];
      estShiftsCache.set(estId, result);
      return result;
    }

    async function getEstBadges(estId: string) {
      if (estBadgesCache.has(estId)) return estBadgesCache.get(estId)!;
      const sd = estServiceDays.get(estId);
      if (!sd) { estBadgesCache.set(estId, []); return []; }
      const { data } = await admin
        .from("badge_events")
        .select("id, user_id, establishment_id, event_type, day_date, late_minutes, effective_at, shift_id, shift_match_status")
        .eq("establishment_id", estId)
        .gte("effective_at", sd.startUtc)
        .lt("effective_at", sd.endUtc);
      const result = data || [];
      estBadgesCache.set(estId, result);
      return result;
    }

    await Promise.all(allEstablishmentIds.map(id => Promise.all([getEstShifts(id), getEstBadges(id)])));

    // ═══ Employee name cache ═══
    const employeeNameCache = new Map<string, string>();
    async function resolveEmployeeName(userId: string): Promise<string> {
      if (employeeNameCache.has(userId)) return employeeNameCache.get(userId)!;
      try {
        const { data } = await admin.auth.admin.getUserById(userId);
        const meta = data?.user?.user_metadata;
        const name = meta?.display_name || meta?.full_name || meta?.name;
        if (name && typeof name === "string" && name.trim()) {
          employeeNameCache.set(userId, name.trim());
          return name.trim();
        }
      } catch { /* fallback */ }
      employeeNameCache.set(userId, "");
      return "";
    }

    // ═══ Detect anomalies → incident candidates ═══
    function elapsedSinceShiftTime(shiftDate: string, timeStr: string): number {
      const shiftUtc = parisToUtcIso(shiftDate, timeStr.slice(0, 5));
      const elapsedMs = Date.now() - new Date(shiftUtc).getTime();
      return Math.floor(elapsedMs / 60_000);
    }

    function elapsedSinceShiftEnd(shiftDate: string, startTime: string, endTime: string): number {
      const isOvernight = endTime < startTime;
      const endDate = isOvernight ? nextDay(shiftDate) : shiftDate;
      const endUtc = parisToUtcIso(endDate, endTime.slice(0, 5));
      const elapsedMs = Date.now() - new Date(endUtc).getTime();
      return Math.floor(elapsedMs / 60_000);
    }

    interface Anomaly {
      establishmentId: string;
      userId: string;
      shiftId: string;
      alertType: string;
      minutes: number;
      ruleId: string;
    }
    const shiftAnomalies = new Map<string, Anomaly>();
    const dryRunDetails: Record<string, unknown>[] = [];

    for (const rule of rules) {
      const estId = rule.establishment_id as string;

      if (rule.alert_type === "late") {
        // ═══ SSOT: Use MIN of all per-role delayMinutes for detection threshold ═══
        const ruleConfig = (rule.config ?? {}) as Record<string, unknown>;
        const roleIds: string[] = (rule.recipient_role_ids as string[]) || [];
        const minDelay = roleIds.reduce((min, rid) => {
          const rc = (ruleConfig[`role_${rid}`] as Record<string, unknown>) ?? {};
          const d = rc.delayMinutes as number;
          return typeof d === "number" && d > 0 ? Math.min(min, d) : min;
        }, rule.min_severity || 5);

        const badges = await getEstBadges(estId);
        const lateEvents = badges.filter((b: Record<string, unknown>) =>
          b.event_type === "clock_in" && (b.late_minutes as number) > minDelay && b.shift_id && b.shift_match_status !== "unmatched"
        );
        if (isDryRun) dryRunDetails.push({ rule_id: rule.id, alert_type: "late", establishment_id: estId, late_events: lateEvents.length });

        for (const event of lateEvents) {
          const key = `${event.shift_id}:late`;
          if (!shiftAnomalies.has(key)) {
            shiftAnomalies.set(key, {
              establishmentId: estId,
              userId: event.user_id as string,
              shiftId: event.shift_id as string,
              alertType: "late",
              minutes: event.late_minutes as number,
              ruleId: rule.id as string,
            });
          }
        }

      } else if (rule.alert_type === "no_badge_arrival") {
        // ═══ V2.9: ARRIVAL — no clock_in after shift start + delay ═══
        const ruleConfig = (rule.config ?? {}) as Record<string, unknown>;
        const roleIds: string[] = (rule.recipient_role_ids as string[]) || [];
        const minDelay = roleIds.reduce((min, rid) => {
          const rc = (ruleConfig[`role_${rid}`] as Record<string, unknown>) ?? {};
          const d = rc.delayMinutes as number;
          return typeof d === "number" && d > 0 ? Math.min(min, d) : min;
        }, rule.min_severity || 5);

        const shifts = await getEstShifts(estId);
        const badges = await getEstBadges(estId);
        const clockedInShiftIds = new Set(
          badges.filter((b: Record<string, unknown>) => b.event_type === "clock_in" && b.shift_id)
            .map((b: Record<string, unknown>) => b.shift_id as string)
        );
        const clockedInUsers = new Set(
          badges.filter((b: Record<string, unknown>) => b.event_type === "clock_in")
            .map((b: Record<string, unknown>) => b.user_id as string)
        );

        if (isDryRun) dryRunDetails.push({ rule_id: rule.id, alert_type: "no_badge_arrival", establishment_id: estId, shifts: shifts.length, clock_ins: clockedInShiftIds.size });

        for (const shift of shifts) {
          const elapsed = elapsedSinceShiftTime(shift.shift_date as string, shift.start_time as string);
          if (elapsed < minDelay) continue;
          if (clockedInShiftIds.has(shift.id as string)) continue;
          if (clockedInUsers.has(shift.user_id as string)) continue;

          // ═══ V2.9: Unique key per alert_type — no collision with departure ═══
          const key = `${shift.id}:no_badge_arrival`;
          if (!shiftAnomalies.has(key)) {
            shiftAnomalies.set(key, {
              establishmentId: estId,
              userId: shift.user_id as string,
              shiftId: shift.id as string,
              alertType: "no_badge_arrival",
              minutes: elapsed,
              ruleId: rule.id as string,
            });
          }
        }

      } else if (rule.alert_type === "no_badge_departure") {
        // ═══ V2.9: DEPARTURE — clock_in exists but no clock_out after shift end + delay ═══
        const ruleConfig = (rule.config ?? {}) as Record<string, unknown>;
        const roleIds: string[] = (rule.recipient_role_ids as string[]) || [];
        const minDelay = roleIds.reduce((min, rid) => {
          const rc = (ruleConfig[`role_${rid}`] as Record<string, unknown>) ?? {};
          const d = rc.delayMinutes as number;
          return typeof d === "number" && d > 0 ? Math.min(min, d) : min;
        }, rule.min_severity || 5);

        const shifts = await getEstShifts(estId);
        const badges = await getEstBadges(estId);
        const clockedInShiftIds = new Set(
          badges.filter((b: Record<string, unknown>) => b.event_type === "clock_in" && b.shift_id)
            .map((b: Record<string, unknown>) => b.shift_id as string)
        );
        const clockedInUsers = new Set(
          badges.filter((b: Record<string, unknown>) => b.event_type === "clock_in")
            .map((b: Record<string, unknown>) => b.user_id as string)
        );
        const clockedOutShiftIds = new Set(
          badges.filter((b: Record<string, unknown>) => b.event_type === "clock_out" && b.shift_id)
            .map((b: Record<string, unknown>) => b.shift_id as string)
        );
        const clockedOutUsers = new Set(
          badges.filter((b: Record<string, unknown>) => b.event_type === "clock_out")
            .map((b: Record<string, unknown>) => b.user_id as string)
        );

        if (isDryRun) dryRunDetails.push({ rule_id: rule.id, alert_type: "no_badge_departure", establishment_id: estId, shifts: shifts.length });

        for (const shift of shifts) {
          // ═══ V2.9 FIX: Use elapsedSinceShiftEnd (not elapsedSinceShiftTime) ═══
          const elapsed = elapsedSinceShiftEnd(
            shift.shift_date as string,
            shift.start_time as string,
            shift.end_time as string,
          );
          if (elapsed < minDelay) continue;

          // ═══ V2.9: MUST have clock_in — absence = no departure alert ═══
          const hasClockIn = clockedInShiftIds.has(shift.id as string) || clockedInUsers.has(shift.user_id as string);
          const hasClockOut = clockedOutShiftIds.has(shift.id as string) || clockedOutUsers.has(shift.user_id as string);
          if (!hasClockIn || hasClockOut) continue;

          const key = `${shift.id}:no_badge_departure`;
          if (!shiftAnomalies.has(key)) {
            shiftAnomalies.set(key, {
              establishmentId: estId,
              userId: shift.user_id as string,
              shiftId: shift.id as string,
              alertType: "no_badge_departure",
              minutes: elapsed,
              ruleId: rule.id as string,
            });
          }
        }

      } else if (rule.alert_type === "missing_clock_out") {
        const thresholdMinutes = rule.min_severity || 5;
        const shifts = await getEstShifts(estId);
        const badges = await getEstBadges(estId);

        const clockedInShiftIds = new Set(
          badges.filter((b: Record<string, unknown>) => b.event_type === "clock_in" && b.shift_id)
            .map((b: Record<string, unknown>) => b.shift_id as string)
        );
        const clockedOutShiftIds = new Set(
          badges.filter((b: Record<string, unknown>) => b.event_type === "clock_out" && b.shift_id)
            .map((b: Record<string, unknown>) => b.shift_id as string)
        );
        const clockedInUsers = new Set(
          badges.filter((b: Record<string, unknown>) => b.event_type === "clock_in")
            .map((b: Record<string, unknown>) => b.user_id as string)
        );
        const clockedOutUsers = new Set(
          badges.filter((b: Record<string, unknown>) => b.event_type === "clock_out")
            .map((b: Record<string, unknown>) => b.user_id as string)
        );

        if (isDryRun) dryRunDetails.push({ rule_id: rule.id, alert_type: "missing_clock_out", establishment_id: estId, shifts: shifts.length });

        for (const shift of shifts) {
          const elapsed = elapsedSinceShiftEnd(
            shift.shift_date as string,
            shift.start_time as string,
            shift.end_time as string,
          );
          if (elapsed < thresholdMinutes) continue;

          const hasClockIn = clockedInShiftIds.has(shift.id as string) || clockedInUsers.has(shift.user_id as string);
          const hasClockOut = clockedOutShiftIds.has(shift.id as string) || clockedOutUsers.has(shift.user_id as string);
          if (!hasClockIn || hasClockOut) continue;

          const key = `${shift.id}:missing_clock_out`;
          if (!shiftAnomalies.has(key)) {
            shiftAnomalies.set(key, {
              establishmentId: estId,
              userId: shift.user_id as string,
              shiftId: shift.id as string,
              alertType: "missing_clock_out",
              minutes: elapsed,
              ruleId: rule.id as string,
            });
          }
        }
      }
    }

    if (DEBUG) console.log(`[notif-check][DEBUG] anomalies=${shiftAnomalies.size}`);

    // ═══ Incident lifecycle: OPEN / RESOLVE ═══
    const shiftIds = [...shiftAnomalies.values()].map(a => a.shiftId);
    const { data: existingOpen } = shiftIds.length > 0
      ? await admin.from("notification_incidents")
          .select("id, shift_id, alert_type, user_id, notify_count, last_notified_at")
          .in("shift_id", shiftIds)
          .eq("status", "OPEN")
      : { data: [] };

    const existingOpenKeys = new Set(
      (existingOpen || []).map((e: { shift_id: string; alert_type: string; user_id: string }) =>
        `${e.shift_id}:${e.alert_type}:${e.user_id}`)
    );

    // ═══ Anti-flapping ═══
    const reopenCooldownIso = new Date(Date.now() - INCIDENT_REOPEN_COOLDOWN_MINUTES * 60_000).toISOString();
    const { data: recentlyResolved } = shiftIds.length > 0
      ? await admin.from("notification_incidents")
          .select("shift_id, alert_type, user_id, resolved_at")
          .in("shift_id", shiftIds)
          .eq("status", "RESOLVED")
          .not("resolved_at", "is", null)
          .gte("resolved_at", reopenCooldownIso)
      : { data: [] };

    const recentlyResolvedKeys = new Set(
      (recentlyResolved || []).map((e: { shift_id: string; alert_type: string; user_id: string }) =>
        `${e.shift_id}:${e.alert_type}:${e.user_id}`)
    );

    if (shiftIds.length > 0) {
      const { data: nullResolvedIncidents } = await admin.from("notification_incidents")
        .select("id, shift_id, alert_type, user_id")
        .in("shift_id", shiftIds)
        .eq("status", "RESOLVED")
        .is("resolved_at", null);
      if (nullResolvedIncidents && nullResolvedIncidents.length > 0) {
        console.warn(`[notif-check][WARN] ${nullResolvedIncidents.length} RESOLVED incidents with NULL resolved_at`);
      }
    }

    if (DEBUG && recentlyResolvedKeys.size > 0) {
      console.log(`[notif-check][DEBUG] anti-flapping: ${recentlyResolvedKeys.size} recently resolved keys blocked`);
    }

    // ═══ V2.9: INSERT new incidents WITH rule_id ═══
    const blockedReopenKeys: string[] = [];
    const incidentsToInsert = [...shiftAnomalies.values()]
      .filter(a => {
        const key = `${a.shiftId}:${a.alertType}:${a.userId}`;
        if (existingOpenKeys.has(key)) return false;
        if (recentlyResolvedKeys.has(key)) {
          blockedReopenKeys.push(key);
          return false;
        }
        return true;
      })
      .map(a => ({
        establishment_id: a.establishmentId,
        user_id: a.userId,
        shift_id: a.shiftId,
        alert_type: a.alertType,
        status: "OPEN" as const,
        metadata: { minutes: a.minutes },
        rule_id: a.ruleId,
      }));

    if (blockedReopenKeys.length > 0 && DEBUG) {
      console.log(`[notif-check][DEBUG] anti-flapping blocked ${blockedReopenKeys.length} reopens`);
    }

    if (incidentsToInsert.length > 0) {
      const { error: upsertErr } = await admin.from("notification_incidents").insert(incidentsToInsert);
      if (upsertErr && !upsertErr.message.includes("duplicate")) {
        console.error(`[notif-check][incidents] open error: ${upsertErr.message}`);
      }
    }

    // ═══ TTL expiration: auto-resolve missing_clock_out OPEN > TTL ═══
    const ttlCutoffIso = new Date(Date.now() - MISSING_CLOCK_OUT_TTL_HOURS * 3600_000).toISOString();
    const { data: ttlExpiredIncidents } = await admin
      .from("notification_incidents")
      .select("id, metadata")
      .in("establishment_id", allEstablishmentIds)
      .eq("status", "OPEN")
      .eq("alert_type", "missing_clock_out")
      .lt("opened_at", ttlCutoffIso);

    let ttlResolvedCount = 0;
    if (ttlExpiredIncidents && ttlExpiredIncidents.length > 0) {
      for (const inc of ttlExpiredIncidents) {
        const existingMeta = (inc.metadata && typeof inc.metadata === "object" && !Array.isArray(inc.metadata))
          ? inc.metadata as Record<string, unknown>
          : {};
        const mergedMeta = { ...existingMeta, resolved_reason: "TTL_EXPIRED", ttl_hours: MISSING_CLOCK_OUT_TTL_HOURS };
        await admin.from("notification_incidents")
          .update({ status: "RESOLVED", resolved_at: new Date().toISOString(), metadata: mergedMeta })
          .eq("id", inc.id);
      }
      ttlResolvedCount = ttlExpiredIncidents.length;
      if (DEBUG) console.log(`[notif-check][DEBUG] TTL expired missing_clock_out resolved=${ttlResolvedCount}`);
    }

    // RESOLVE incidents whose anomaly is no longer detected
    const { data: allOpenIncidents } = await admin
      .from("notification_incidents")
      .select("id, shift_id, alert_type, user_id, establishment_id, metadata")
      .in("establishment_id", allEstablishmentIds)
      .eq("status", "OPEN");

    let standardResolvedCount = 0;
    if (allOpenIncidents && allOpenIncidents.length > 0) {
      const openShiftIds = [...new Set(allOpenIncidents.map(inc => inc.shift_id))];
      const { data: existingShifts } = openShiftIds.length > 0
        ? await admin.from("planning_shifts").select("id").in("id", openShiftIds)
        : { data: [] };
      const existingShiftIdSet = new Set((existingShifts ?? []).map((s: { id: string }) => s.id));

      for (const inc of allOpenIncidents) {
        // ═══ V2.9: anomalyKey uses the full alert_type (no_badge_arrival, no_badge_departure, etc.) ═══
        const anomalyKey = `${inc.shift_id}:${inc.alert_type}`;
        const shiftDeleted = !existingShiftIdSet.has(inc.shift_id);
        const anomalyCleared = !shiftAnomalies.has(anomalyKey);

        let reason: string | null = null;
        if (shiftDeleted) {
          reason = "SHIFT_DELETED";
        } else if (anomalyCleared) {
          reason = "ANOMALY_CLEARED";
        }

        if (reason) {
          const existingMeta = (inc.metadata && typeof inc.metadata === "object" && !Array.isArray(inc.metadata))
            ? inc.metadata as Record<string, unknown>
            : {};
          const mergedMeta = { ...existingMeta, resolved_reason: reason };

          await admin.from("notification_incidents")
            .update({ status: "RESOLVED", resolved_at: new Date().toISOString(), metadata: mergedMeta })
            .eq("id", inc.id);
          standardResolvedCount++;

          if (DEBUG && shiftDeleted) {
            console.log(`[notif-check][DEBUG] resolving incident ${inc.id}: SHIFT_DELETED`);
          }
        }
      }
      if (DEBUG && standardResolvedCount > 0) console.log(`[notif-check][DEBUG] incidents resolved=${standardResolvedCount}`);
    }

    if (DEBUG) console.log(`[notif-check][DEBUG] incidents opened=${incidentsToInsert.length} blocked_reopen=${blockedReopenKeys.length}`);

    // ═══ DRY RUN ═══
    if (isDryRun) {
      const serviceDayInfo = Object.fromEntries(
        [...estServiceDays.entries()].map(([estId, sd]) => [estId, {
          serviceDay: sd.serviceDay,
          cutoff: sd.cutoff,
          startUtc: sd.startUtc,
          endUtc: sd.endUtc,
          shifts_loaded: estShiftsCache.get(estId)?.length ?? 0,
          badges_loaded: estBadgesCache.get(estId)?.length ?? 0,
        }])
      );
      return new Response(JSON.stringify({
        dryRun: true, engine_mode: engineMode, auth_method: authMethod,
        time: currentTimeStr,
        service_days: serviceDayInfo,
        rules_count: rules.length, anomalies: shiftAnomalies.size,
        incidents_opened: incidentsToInsert.length,
        blocked_reopen_count: blockedReopenKeys.length,
        ttl_resolved_count: ttlResolvedCount,
        anomaly_details: [...shiftAnomalies.values()].map(a => ({ shiftId: a.shiftId, alertType: a.alertType, userId: a.userId, minutes: a.minutes, ruleId: a.ruleId })),
        rule_details: dryRunDetails,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══ Push helper ═══
    const extractDomain = (endpoint: string): string => {
      try { return new URL(endpoint).hostname; } catch { return "unknown"; }
    };

    type DeliveryRow = { establishment_id: string; recipient_user_id: string; alert_key: string; push_subscription_id: string | null; endpoint_domain: string | null; status: string; http_status: number | null; error_message: string | null; retry_count?: number };

    async function sendPushToRecipient(
      recipientId: string, establishmentId: string, alertKey: string, title: string, body: string,
    ): Promise<{ sentForUser: boolean; fallbackUsed: boolean; deliveryRows: DeliveryRow[] }> {
      const { data: scopedSubs } = await admin.from("push_subscriptions")
        .select("id, endpoint, p256dh, auth, establishment_id")
        .eq("user_id", recipientId).eq("establishment_id", establishmentId);

      let subs = scopedSubs && scopedSubs.length > 0 ? scopedSubs : null;
      let fallbackUsed = false;

      if (!subs) {
        const { data: anySubs } = await admin.from("push_subscriptions")
          .select("id, endpoint, p256dh, auth, establishment_id")
          .eq("user_id", recipientId);
        subs = anySubs;
        if (subs && subs.length > 0) fallbackUsed = true;
      }

      const deliveryRows: DeliveryRow[] = [];

      if (!subs || subs.length === 0) {
        deliveryRows.push({ establishment_id: establishmentId, recipient_user_id: recipientId, alert_key: alertKey, push_subscription_id: null, endpoint_domain: null, status: "no_subscription", http_status: null, error_message: null });
        return { sentForUser: false, fallbackUsed, deliveryRows };
      }

      const pushPayload = JSON.stringify({ title, body, url: "/badgeuse" });
      let anyDeviceDelivered = false;

      for (const sub of subs) {
        const domain = extractDomain(sub.endpoint);
        let lastStatus = "failed";
        let lastHttpStatus: number | null = null;
        let lastError: string | null = null;
        let retryCount = 0;

        for (let attempt = 0; attempt <= MAX_PUSH_RETRIES; attempt++) {
          try {
            const response = await sendWebPush(sub.endpoint, sub.p256dh, sub.auth, pushPayload, vapidPublicKey, vapidPrivateKey);
            if (response.ok) {
              lastStatus = "delivered"; lastHttpStatus = response.status; lastError = null; anyDeviceDelivered = true; break;
            } else if (response.status === 404 || response.status === 410) {
              await admin.from("push_subscriptions").delete().eq("id", sub.id);
              lastStatus = "expired"; lastHttpStatus = response.status; lastError = `Subscription expired (${response.status})`; break;
            } else if (isRetryable(response.status) && attempt < MAX_PUSH_RETRIES) {
              retryCount++;
              lastError = (await response.text().catch(() => "")).slice(0, 500);
              lastHttpStatus = response.status;
              await backoffSleep(attempt);
            } else {
              lastStatus = "failed"; lastHttpStatus = response.status;
              lastError = (await response.text().catch(() => "")).slice(0, 500); break;
            }
          } catch (err) {
            lastError = (err as Error).message.slice(0, 500);
            if (attempt < MAX_PUSH_RETRIES) { retryCount++; await backoffSleep(attempt); }
            else { lastStatus = "failed"; }
          }
        }

        deliveryRows.push({ establishment_id: establishmentId, recipient_user_id: recipientId, alert_key: alertKey, push_subscription_id: sub.id, endpoint_domain: domain, status: lastStatus, http_status: lastHttpStatus, error_message: lastError, ...(retryCount > 0 ? { retry_count: retryCount } : {}) });
      }

      return { sentForUser: anyDeviceDelivered, fallbackUsed, deliveryRows };
    }

    // ═══ V2.9 SEND: Use incident.rule_id — NO bestRule recalculation ═══
    let totalSent = 0;
    let totalSkipped = 0;
    let totalRetries = 0;

    // Build a rule lookup map by id for O(1) access
    const ruleById = new Map<string, Record<string, unknown>>();
    for (const r of rules) {
      ruleById.set(r.id as string, r);
    }

    const { data: v2Incidents } = await admin
      .from("notification_incidents")
      .select("id, establishment_id, user_id, shift_id, alert_type, metadata, last_notified_at, notify_count, rule_id")
      .in("establishment_id", allEstablishmentIds)
      .eq("status", "OPEN")
      .limit(MAX_INCIDENTS_PER_ESTABLISHMENT * allEstablishmentIds.length);

    if (v2Incidents && v2Incidents.length > 0) {
      if (DEBUG) console.log(`[notif-check][DEBUG] processing ${v2Incidents.length} OPEN incidents`);

      const estIncidentCounts = new Map<string, number>();
      for (const inc of v2Incidents) {
        const c = estIncidentCounts.get(inc.establishment_id) ?? 0;
        estIncidentCounts.set(inc.establishment_id, c + 1);
      }

      for (const inc of v2Incidents) {
        if (Date.now() - executionStart > EXECUTION_TIMEOUT_MS) {
          console.warn(`[notif-check] Execution timeout reached after ${Date.now() - executionStart}ms, stopping`);
          break;
        }

        const estCount = estIncidentCounts.get(inc.establishment_id) ?? 0;
        if (estCount > MAX_INCIDENTS_PER_ESTABLISHMENT) continue;

        // ═══ V2.9: Use incident's rule_id directly — NO bestRule recalculation ═══
        let incidentRule: Record<string, unknown> | undefined;

        if (inc.rule_id) {
          // Primary path: use the rule that created this incident
          incidentRule = ruleById.get(inc.rule_id as string);
        }

        if (!incidentRule) {
          // Fallback for legacy incidents without rule_id:
          // find matching rule by establishment + alert_type (old behavior, will be deprecated)
          const matchingRules = rules.filter((r: Record<string, unknown>) =>
            r.establishment_id === inc.establishment_id && r.alert_type === inc.alert_type
          ).sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
            ((a.priority as number) ?? 100) - ((b.priority as number) ?? 100)
          );
          if (matchingRules.length === 0) continue;
          incidentRule = matchingRules[0];

          // Backfill rule_id for legacy incidents
          if (incidentRule) {
            await admin.from("notification_incidents")
              .update({ rule_id: incidentRule.id as string })
              .eq("id", inc.id);
          }
        }

        if (!incidentRule) continue;

        const ruleConfig = (incidentRule.config ?? {}) as Record<string, unknown>;
        const recipientRoleIds: string[] = (incidentRule.recipient_role_ids as string[]) || [];
        if (recipientRoleIds.length === 0) continue;

        const minutes = (inc.metadata as Record<string, unknown>)?.minutes ?? 0;
        let anyRoleSentThisCycle = false;
        let maxWaveThisCycle = (inc.notify_count as number) ?? 0;

        const recipientErrors: Array<{ roleId: string; recipientId: string; error: string }> = [];

        for (const roleId of recipientRoleIds) {
          const roleConf = (ruleConfig[`role_${roleId}`] as Record<string, unknown>) ?? {};
          const roleRemindersEnabled = (roleConf.remindersEnabled as boolean) ?? false;
          const roleMaxReminders = (roleConf.maxReminders as number) ?? 0;
          const roleIntervalMinutes = (roleConf.reminderIntervalMinutes as number) ?? 0;
          const roleIncludeEmployeeName = (roleConf.includeEmployeeName as boolean) ?? false;
          const roleDelayMinutes = (roleConf.delayMinutes as number) ?? 5;
          const roleInitialMessage = (roleConf.initialMessageBody as string) ?? "";
          const roleReminderMessage = (roleConf.reminderMessageBody as string) ?? "";
          const roleFinalEnabled = (roleConf.finalReminderEnabled as boolean) ?? false;
          const roleFinalMessage = (roleConf.finalReminderBody as string) ?? "";
          const roleTitle = (roleConf.titleTemplate as string) ?? "";

          if (!roleInitialMessage.trim()) {
            if (DEBUG) console.log(`[notif-check][DEBUG] role=${roleId} incident=${inc.id} SKIPPED: no initialMessageBody`);
            continue;
          }

          const anomalyMinutes = (inc.metadata as Record<string, unknown>)?.minutes as number ?? 0;
          if (anomalyMinutes < roleDelayMinutes) {
            if (DEBUG) console.log(`[notif-check][DEBUG] role=${roleId} incident=${inc.id} SKIPPED: ${anomalyMinutes}min < delay ${roleDelayMinutes}min`);
            continue;
          }

          const roleAlertPrefix = `${inc.alert_type.toUpperCase()}:${inc.user_id}:${inc.shift_id}:R${roleId}`;

          // ═══ V3.0: Scope-aware recipient filtering ═══
          // Read the 'alertes' module scope for each user with this role to determine visibility
          const { data: roleUsers } = await admin.from("user_roles")
            .select("user_id").eq("role_id", roleId).eq("establishment_id", inc.establishment_id);
          const allRoleUserIds = [...new Set((roleUsers || []).map((r: { user_id: string }) => r.user_id))];
          if (allRoleUserIds.length === 0) continue;

          // Fetch each user's alertes scope from role_permissions
          const { data: alertePerms } = await admin.from("role_permissions")
            .select("role_id, scope").eq("module_key", "alertes").eq("role_id", roleId).limit(1).single();
          const alerteScope = (alertePerms?.scope as string) ?? "establishment";

          let recipientUserIds: string[];
          if (alerteScope === "self") {
            // Only the employee concerned by the anomaly receives the notification
            recipientUserIds = allRoleUserIds.filter((uid) => uid === inc.user_id);
          } else if (alerteScope === "team") {
            // Only users in the same team(s) as the concerned employee
            const { data: incUserTeams } = await admin.from("user_teams")
              .select("team_id").eq("user_id", inc.user_id).eq("establishment_id", inc.establishment_id);
            const teamIds = (incUserTeams || []).map((t: { team_id: string }) => t.team_id);
            if (teamIds.length === 0) {
              // No team assigned → fallback to self only
              recipientUserIds = allRoleUserIds.filter((uid) => uid === inc.user_id);
            } else {
              const { data: teamMembers } = await admin.from("user_teams")
                .select("user_id").in("team_id", teamIds).eq("establishment_id", inc.establishment_id);
              const teamUserIds = new Set((teamMembers || []).map((m: { user_id: string }) => m.user_id));
              recipientUserIds = allRoleUserIds.filter((uid) => teamUserIds.has(uid));
            }
          } else {
            // "establishment" or "org" → all users with the role in this establishment (current behavior)
            recipientUserIds = allRoleUserIds;
          }
          if (recipientUserIds.length === 0) continue;

          for (const recipientId of recipientUserIds) {
            try {
              const { count: existingRecipientCount } = await admin
                .from("notification_events")
                .select("id", { count: "exact", head: true })
                .eq("incident_id", inc.id)
                .eq("recipient_user_id", recipientId)
                .like("alert_key", `${roleAlertPrefix}%`);

              const recipientNotifyCount = existingRecipientCount ?? 0;
              const roleMaxTotal = roleRemindersEnabled ? 1 + roleMaxReminders : 1;

              if (recipientNotifyCount >= roleMaxTotal) {
                if (DEBUG) console.log(`[notif-check][DEBUG] role=${roleId} recipient=${recipientId} incident=${inc.id} at max (${recipientNotifyCount}/${roleMaxTotal})`);
                continue;
              }

              if (recipientNotifyCount > 0) {
                if (!roleRemindersEnabled) continue;

                const { data: lastRecipientEvent } = await admin
                  .from("notification_events")
                  .select("sent_at")
                  .eq("incident_id", inc.id)
                  .eq("recipient_user_id", recipientId)
                  .like("alert_key", `${roleAlertPrefix}%`)
                  .order("sent_at", { ascending: false })
                  .limit(1)
                  .single();

                if (lastRecipientEvent && roleIntervalMinutes > 0) {
                  const elapsedMin = (Date.now() - new Date(lastRecipientEvent.sent_at).getTime()) / 60000;
                  if (elapsedMin < roleIntervalMinutes) continue;
                }
              }

              const waveIndex = recipientNotifyCount + 1;
              const alertKey = `${roleAlertPrefix}:w${waveIndex}`;

              let employeeName = "";
              if (roleIncludeEmployeeName) {
                employeeName = await resolveEmployeeName(inc.user_id);
              }

              let bodyFromConfig: string;
              if (waveIndex === 1) {
                bodyFromConfig = roleInitialMessage;
              } else if (roleFinalEnabled && waveIndex === roleMaxTotal && roleFinalMessage.trim()) {
                bodyFromConfig = roleFinalMessage;
              } else if (roleReminderMessage.trim()) {
                bodyFromConfig = roleReminderMessage;
              } else {
                if (DEBUG) console.log(`[notif-check][DEBUG] role=${roleId} recipient=${recipientId} incident=${inc.id} wave=${waveIndex} SKIPPED: no reminderMessageBody`);
                continue;
              }

              let body = bodyFromConfig;
              if (roleIncludeEmployeeName && employeeName) {
                body = `${employeeName} — ${body}`;
              }
              if (waveIndex > 1) {
                body += ` (rappel ${waveIndex - 1}/${roleMaxReminders})`;
              }

              const title = roleTitle;

              const eventPayload = {
                title, body, minutes: anomalyMinutes,
                source_user_id: inc.user_id,
                employee_name: roleIncludeEmployeeName ? employeeName : null,
                sent: false,
                no_subscription: false,
                fallback_scope: false,
                engine_version: "v2.9-split-no-badge",
                incident_id: inc.id,
                role_id: roleId,
                wave: waveIndex,
                max_waves: roleMaxTotal,
                wave_reason: "per_recipient",
                body_from_config: bodyFromConfig,
                title_from_config: roleTitle,
              };

              const { data: eventData, error: insertErr } = await admin.from("notification_events").insert({
                rule_id: incidentRule.id as string,
                establishment_id: inc.establishment_id,
                alert_key: alertKey,
                alert_type: inc.alert_type,
                recipient_user_id: recipientId,
                incident_id: inc.id,
                payload: eventPayload,
              }).select("id").single();

              if (insertErr) {
                if (insertErr.message.includes("duplicate") || insertErr.message.includes("idx_notif_events_idempotent")) {
                  if (DEBUG) console.log(`[notif-check][DEBUG] idempotent skip: ${alertKey}`);
                } else {
                  console.error(`[notif-check] insert error:`, insertErr.message);
                }
                continue;
              }

              let sentForUser = false;
              let fallbackUsed = false;
              let deliveryRows: DeliveryRow[] = [];

              if (DETECT_ONLY) {
                deliveryRows = [{ establishment_id: inc.establishment_id, recipient_user_id: recipientId, alert_key: alertKey, push_subscription_id: null, endpoint_domain: null, status: "detect_only", http_status: null, error_message: "Engine in detect_only mode" }];
              } else {
                const pushResult = await sendPushToRecipient(recipientId, inc.establishment_id, alertKey, title, body);
                sentForUser = pushResult.sentForUser;
                fallbackUsed = pushResult.fallbackUsed;
                deliveryRows = pushResult.deliveryRows;
              }

              const noSub = deliveryRows.length === 1 && deliveryRows[0].status === "no_subscription";
              totalRetries += deliveryRows.reduce((acc, r) => acc + (r.retry_count ?? 0), 0);

              if (eventData?.id) {
                const updatedPayload = {
                  ...eventPayload,
                  sent: sentForUser,
                  no_subscription: noSub,
                  fallback_scope: fallbackUsed,
                };
                await admin.from("notification_events")
                  .update({ payload: updatedPayload })
                  .eq("id", eventData.id);
              }

              if (sentForUser) {
                totalSent++; anyRoleSentThisCycle = true;
              } else {
                totalSkipped++;
              }

              if (deliveryRows.length > 0 && eventData?.id) {
                await admin.from("notification_delivery_logs").insert(deliveryRows.map(row => ({ ...row, notification_event_id: eventData.id })));
              }

              if (waveIndex > maxWaveThisCycle) maxWaveThisCycle = waveIndex;

            } catch (recipientErr) {
              const errMsg = (recipientErr as Error).message ?? "unknown";
              recipientErrors.push({ roleId, recipientId, error: errMsg });
              console.error(`[notif-check][ERROR] recipient=${recipientId} role=${roleId} incident=${inc.id}: ${errMsg}`);
            }
          }
        }

        if (recipientErrors.length > 0) {
          console.warn(`[notif-check][WARN] ${recipientErrors.length} recipient error(s) for incident=${inc.id}: ${JSON.stringify(recipientErrors.slice(0, 3))}`);
        }

        if (anyRoleSentThisCycle || recipientErrors.length === 0) {
          await admin.from("notification_incidents").update({
            last_notified_at: new Date().toISOString(),
            notify_count: maxWaveThisCycle,
          }).eq("id", inc.id);
        }
      }
    }

    const serviceDayInfo = Object.fromEntries(
      [...estServiceDays.entries()].map(([estId, sd]) => [estId, {
        serviceDay: sd.serviceDay,
        cutoff: sd.cutoff,
        startUtc: sd.startUtc,
        endUtc: sd.endUtc,
        shifts_loaded: estShiftsCache.get(estId)?.length ?? 0,
        badges_loaded: estBadgesCache.get(estId)?.length ?? 0,
      }])
    );

    const summary = {
      processed: rules.length,
      anomalies: shiftAnomalies.size,
      incidents_opened: incidentsToInsert.length,
      blocked_reopen_count: blockedReopenKeys.length,
      ttl_resolved_count: ttlResolvedCount,
      sent: totalSent,
      skipped: totalSkipped,
      retries: totalRetries,
      auth_method: authMethod,
      engine_mode: engineMode,
      engine_version: "v2.9-split-no-badge",
      service_days: serviceDayInfo,
      execution_ms: Date.now() - executionStart,
    };
    if (DEBUG) console.log(`[notif-check][DEBUG] summary=${JSON.stringify(summary)}`);

    return new Response(JSON.stringify(summary), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[notif-check] Top-level error:", (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

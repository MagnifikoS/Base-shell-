import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("establishment-hours");
const CORS = makeCorsHeaders("POST, OPTIONS");

interface WeeklyHour {
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  closed: boolean;
}

interface DayPart {
  part: "morning" | "midday" | "evening";
  start_time: string;
  end_time: string;
  color: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    log.info("Request received");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      log.warn("Missing or invalid authorization header");
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User client for RBAC checks (uses auth.uid())
    const supabaseUser = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Admin client for mutations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      log.warn("Auth failed");
      return new Response(JSON.stringify({ error: "Token invalide" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Rate limit check (after auth, before business logic)
    const rateLimited = await checkRateLimit(req, supabaseAdmin, { max: 30, keyPrefix: "establishment-hours" });
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const { action, establishment_id } = body;

    log.info("handle_request", { user_id: user.id, action, establishment_id });

    // ═══════════════════════════════════════════════════════════════════════
    // RBAC CHECK - has_module_access('parametres', 'write', establishment_id)
    // Uses supabaseUser (JWT client) so auth.uid() is correctly populated
    // ═══════════════════════════════════════════════════════════════════════
    const isWriteAction = ["update_weekly_hours", "add_exception", "remove_exception", "upsert_day_parts"].includes(action);
    if (isWriteAction) {
      if (!establishment_id) {
        return new Response(JSON.stringify({ error: "establishment_id required for write actions" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      
      const { data: hasAccess, error: rbacErr } = await supabaseUser.rpc("has_module_access", {
        _module_key: "parametres",
        _min_level: "write",
        _establishment_id: establishment_id,
      });
      
      if (rbacErr) {
        log.error("RBAC check error", rbacErr);
        return new Response(JSON.stringify({ error: "Authorization check failed" }), {
          status: 500,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      
      if (!hasAccess) {
        log.warn("access_denied", { user_id: user.id, establishment_id, action });
        return new Response(JSON.stringify({ error: "NOT_AUTHORIZED" }), {
          status: 403,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
    }

    switch (action) {
      case "get_weekly_hours": {
        const { data, error } = await supabaseUser
          .from("establishment_opening_hours")
          .select("id, day_of_week, open_time, close_time, closed")
          .eq("establishment_id", establishment_id)
          .order("day_of_week");

        if (error) throw error;
        return new Response(JSON.stringify({ hours: data }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      case "get_exceptions": {
        const { data, error } = await supabaseUser
          .from("establishment_opening_exceptions")
          .select("id, date, open_time, close_time, closed, reason")
          .eq("establishment_id", establishment_id)
          .order("date");

        if (error) throw error;
        return new Response(JSON.stringify({ exceptions: data }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      case "get_hours": {
        // Returns normalized hours for a week (used by Planning)
        const { week_start } = body;
        if (!week_start) throw new Error("week_start requis");

        // Get weekly hours
        const { data: weeklyHours, error: weeklyError } = await supabaseUser
          .from("establishment_opening_hours")
          .select("day_of_week, open_time, close_time, closed")
          .eq("establishment_id", establishment_id);

        if (weeklyError) throw weeklyError;

        // Get exceptions for the week
        const weekEnd = new Date(week_start);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const weekEndStr = weekEnd.toISOString().split("T")[0];

        const { data: exceptions, error: exceptionsError } = await supabaseUser
          .from("establishment_opening_exceptions")
          .select("date, open_time, close_time, closed")
          .eq("establishment_id", establishment_id)
          .gte("date", week_start)
          .lte("date", weekEndStr);

        if (exceptionsError) throw exceptionsError;

        // Build normalized output
        const openingHoursByDate: Record<string, { open: string | null; close: string | null; closed: boolean }> = {};
        
        for (let i = 0; i < 7; i++) {
          const date = new Date(week_start);
          date.setDate(date.getDate() + i);
          const dateStr = date.toISOString().split("T")[0];
          const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay(); // Convert Sunday (0) to 7

          // Check for exception first
          const exception = exceptions?.find((e) => e.date === dateStr);
          if (exception) {
            openingHoursByDate[dateStr] = {
              open: exception.open_time,
              close: exception.close_time,
              closed: exception.closed,
            };
          } else {
            // Use weekly hours
            const weekly = weeklyHours?.find((h) => h.day_of_week === dayOfWeek);
            openingHoursByDate[dateStr] = {
              open: weekly?.open_time || null,
              close: weekly?.close_time || null,
              closed: weekly?.closed ?? true,
            };
          }
        }

        return new Response(
          JSON.stringify({ timezone: "Europe/Paris", openingHoursByDate }),
          { headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      case "update_weekly_hours": {
        const { hours } = body as { hours: WeeklyHour[] };
        if (!hours || !Array.isArray(hours)) throw new Error("hours requis");

        // Delete existing and insert new (atomic via transaction behavior)
        const { error: deleteError } = await supabaseAdmin
          .from("establishment_opening_hours")
          .delete()
          .eq("establishment_id", establishment_id);

        if (deleteError) throw deleteError;

        const toInsert = hours.map((h) => ({
          establishment_id,
          day_of_week: h.day_of_week,
          open_time: h.open_time,
          close_time: h.close_time,
          closed: h.closed,
        }));

        const { error: insertError } = await supabaseAdmin
          .from("establishment_opening_hours")
          .insert(toInsert);

        if (insertError) throw insertError;

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      case "add_exception": {
        const { date, open_time, close_time, closed, reason } = body;
        if (!date) throw new Error("date requise");

        const { error } = await supabaseAdmin
          .from("establishment_opening_exceptions")
          .upsert(
            { establishment_id, date, open_time, close_time, closed, reason },
            { onConflict: "establishment_id,date" }
          );

        if (error) throw error;

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      case "remove_exception": {
        const { exception_id } = body;
        if (!exception_id) throw new Error("exception_id requis");

        const { error } = await supabaseAdmin
          .from("establishment_opening_exceptions")
          .delete()
          .eq("id", exception_id)
          .eq("establishment_id", establishment_id);

        if (error) throw error;

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      case "get_day_parts": {
        const { data, error } = await supabaseUser
          .from("establishment_day_parts")
          .select("id, part, start_time, end_time, color")
          .eq("establishment_id", establishment_id)
          .order("part");

        if (error) throw error;
        return new Response(JSON.stringify({ day_parts: data || [] }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      case "upsert_day_parts": {
        const { parts } = body as { parts: DayPart[] };
        if (!parts || !Array.isArray(parts)) throw new Error("parts requis");

        // Validate parts
        const validParts = ["morning", "midday", "evening"];
        for (const p of parts) {
          if (!validParts.includes(p.part)) {
            throw new Error(`part invalide: ${p.part}`);
          }
          if (!p.start_time || !p.end_time || !p.color) {
            throw new Error("start_time, end_time et color requis pour chaque part");
          }
          if (!/^#[0-9A-Fa-f]{6}$/.test(p.color)) {
            throw new Error(`color invalide: ${p.color}`);
          }
        }

        // Upsert each part using admin client
        for (const part of parts) {
          const { error } = await supabaseAdmin
            .from("establishment_day_parts")
            .upsert(
              {
                establishment_id,
                part: part.part,
                start_time: part.start_time,
                end_time: part.end_time,
                color: part.color,
              },
              { onConflict: "establishment_id,part" }
            );

          if (error) throw error;
        }

        log.info("completed", { action, establishment_id });
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: "Action non reconnue" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
    }
  } catch (error: unknown) {
    log.error("Unhandled error", error);
    return new Response(JSON.stringify({ error: "Erreur interne du serveur" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

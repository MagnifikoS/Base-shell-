import { createClient } from "npm:@supabase/supabase-js@2";
import { hashPinPbkdf2 } from "../_shared/crypto.ts";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimitSync } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("badge-pin");

Deno.serve(async (req) => {
  const CORS = makeCorsHeaders("GET, POST, OPTIONS", req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  // Rate limiting
  const rateLimited = checkRateLimitSync(req, { windowMs: 60_000, max: 10 });
  if (rateLimited) return rateLimited;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      log.warn("auth_failed", { reason: "missing_authorization" });
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      log.warn("auth_failed", { reason: "invalid_token" });
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    log.info("handle_request", { user_id: user.id, method: req.method });

    // GET - Check if PIN exists
    if (req.method === "GET") {
      const { data: pinRecord } = await supabaseAdmin
        .from("user_badge_pins")
        .select("id, created_at")
        .eq("user_id", user.id)
        .single();

      return new Response(
        JSON.stringify({
          has_pin: !!pinRecord,
          created_at: pinRecord?.created_at || null,
        }),
        {
          status: 200,
          headers: { ...CORS, "Content-Type": "application/json" },
        }
      );
    }

    // POST - Create or update PIN
    if (req.method === "POST") {
      const body = await req.json();
      const { pin } = body;

      if (!pin || typeof pin !== "string" || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        log.warn("validation_failed", { reason: "invalid_pin_format", user_id: user.id });
        return new Response(
          JSON.stringify({ error: "PIN must be exactly 4 digits" }),
          {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" },
          }
        );
      }

      const pinHash = await hashPinPbkdf2(pin);

      // Upsert PIN
      const { error: upsertError } = await supabaseAdmin
        .from("user_badge_pins")
        .upsert(
          {
            user_id: user.id,
            pin_hash: pinHash,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (upsertError) {
        // SEC-20: Log detailed error server-side, return generic message to client
        log.error("PIN upsert failed", upsertError);
        return new Response(JSON.stringify({ error: "Failed to save PIN" }), {
          status: 500,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      log.info("completed", { action: "pin_saved", user_id: user.id });
      return new Response(
        JSON.stringify({ success: true, message: "PIN configured" }),
        {
          status: 200,
          headers: { ...CORS, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    // SEC-20: Log detailed error server-side, return generic message to client
    log.error("Unhandled error", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

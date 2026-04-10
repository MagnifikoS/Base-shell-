import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth, AuthError } from "../_shared/requireAuth.ts";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("export-products-csv");
const CORS = makeCorsHeaders("GET, OPTIONS");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    // Auth check
    let user;
    try {
      const auth = await requireAuth(req);
      user = auth.user;
    } catch (e) {
      if (e instanceof AuthError) {
        log.warn("auth_failed", { reason: e.message });
        return new Response(
          JSON.stringify({ error: e.message }),
          { status: e.status, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
      throw e;
    }

    // Rate limiting
    const rateLimited = await checkRateLimit(req, null, { max: 10, keyPrefix: "export-products-csv" });
    if (rateLimited) return rateLimited;

    log.info("export_request", { user_id: user.id });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase.rpc("export_products_csv");

    if (error) {
      log.error("rpc_failed", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    log.info("export_complete", { user_id: user.id });

    return new Response(data, {
      headers: {
        ...CORS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=Produits_V2_Full_Export.csv",
      },
    });
  } catch (error) {
    log.error("unexpected_error", error);
    return new Response(
      JSON.stringify({ error: "Export failed" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});

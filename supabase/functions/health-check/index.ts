import { makeCorsHeaders } from "../_shared/cors.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("health-check");

Deno.serve(async (req) => {
  const CORS = makeCorsHeaders("GET, OPTIONS", req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  log.info("invoked", { method: req.method });

  const checks = {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  };

  log.info("completed", { status: checks.status });

  return new Response(JSON.stringify(checks), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});

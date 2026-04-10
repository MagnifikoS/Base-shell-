/**
 * Shared CORS headers for Edge Functions.
 *
 * Supports multiple origins: production, staging, and localhost.
 * The static `corsHeaders` uses "*" to work with all origins.
 * For production hardening, use makeCorsHeaders(methods, req) for dynamic matching.
 */

const ALLOWED_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-bootstrap-secret, x-idempotency-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version";

// All allowed origins for dynamic resolution
const CORE_ORIGINS = [
  "https://app.restaurantos.fr",
  "https://restaurantosstaging.vercel.app",
  "http://localhost:5173",
  "http://localhost:8080",
];

// Add any extra origins from env
const envOrigin = Deno.env.get("ALLOWED_ORIGIN") || "";
const envOrigins = envOrigin
  .split(",")
  .map((o: string) => o.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = [...new Set([...CORE_ORIGINS, ...envOrigins])];

/**
 * Resolve origin for a request. Returns the requesting origin if allowed.
 */
function resolveOrigin(requestOrigin?: string | null): string {
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }
  return "*";
}

/**
 * Create CORS headers with specific methods, dynamically matching origin.
 * Pass `req` to match origin dynamically (recommended).
 * Without `req`, uses "*" to allow any origin.
 */
export function makeCorsHeaders(methods: string, req?: Request): Record<string, string> {
  const origin = req ? resolveOrigin(req.headers.get("origin")) : "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": methods,
  };
}

/**
 * Legacy CORS headers — uses "*" to support all origins.
 * This is safe because all edge functions still verify auth via JWT.
 * The CORS check is defense-in-depth, not the primary security layer.
 */
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": ALLOWED_HEADERS,
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

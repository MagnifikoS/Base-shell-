/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Rate Limiter for Edge Functions — Dual Mode (DB + In-Memory Fallback)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PRIMARY: Uses a `rate_limit_entries` DB table for persistence across
 *          cold starts and multiple function instances. This is the only
 *          reliable approach for Supabase Edge Functions (stateless).
 *
 * FALLBACK: If DB is unavailable, falls back to in-memory Map
 *           (same-invocation only, resets on cold start).
 *
 * Usage:
 *   const limited = await checkRateLimit(req, supabaseAdmin, { max: 10 });
 *   if (limited) return limited; // Returns 429 Response
 */

import { makeCorsHeaders } from "./cors.ts";

const CORS = makeCorsHeaders("POST, GET, OPTIONS, PUT, DELETE");

interface RateLimitOptions {
  windowMs?: number; // Default: 60_000 (1 minute)
  max?: number; // Default: 30 requests per window
  keyPrefix?: string; // Optional prefix for rate limit key (e.g., "badge-pin")
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory fallback (used when DB is unavailable)
// ─────────────────────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

function checkMemoryRateLimit(
  key: string,
  windowMs: number,
  max: number,
): boolean {
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || now > entry.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return false; // not limited
  }

  entry.count++;
  return entry.count > max; // true = limited
}

// ─────────────────────────────────────────────────────────────────────────────
// DB-backed rate limiting (persists across cold starts)
// ─────────────────────────────────────────────────────────────────────────────

async function checkDbRateLimit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  key: string,
  windowMs: number,
  max: number,
): Promise<boolean> {
  try {
    const windowStart = new Date(Date.now() - windowMs).toISOString();

    // Count recent requests for this key
    const { count, error } = await supabaseAdmin
      .from("rate_limit_entries")
      .select("id", { count: "exact", head: true })
      .eq("key", key)
      .gte("created_at", windowStart);

    if (error) {
      // DB unavailable — fall back to memory
      return checkMemoryRateLimit(key, windowMs, max);
    }

    if ((count ?? 0) >= max) {
      return true; // rate limited
    }

    // Record this request (fire-and-forget, don't block on insert)
    supabaseAdmin
      .from("rate_limit_entries")
      .insert({ key, created_at: new Date().toISOString() })
      .then(() => {})
      .catch(() => {});

    return false; // not limited
  } catch {
    // Any error — fall back to memory
    return checkMemoryRateLimit(key, windowMs, max);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

function getClientIp(req: Request): string {
  // Use socket address when behind trusted proxy, else forwarded header
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Check rate limit for the request.
 *
 * @param req - The incoming request
 * @param supabaseAdmin - Supabase admin client (service role) for DB access.
 *                        Pass `null` to use in-memory only.
 * @param options - Rate limit configuration
 * @returns 429 Response if rate limited, or null if allowed
 */
export async function checkRateLimit(
  req: Request,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any | null,
  options: RateLimitOptions = {},
): Promise<Response | null> {
  const { windowMs = 60_000, max = 30, keyPrefix = "" } = options;

  const ip = getClientIp(req);
  const key = keyPrefix ? `${keyPrefix}:${ip}` : ip;

  let isLimited: boolean;

  if (supabaseAdmin) {
    isLimited = await checkDbRateLimit(supabaseAdmin, key, windowMs, max);
  } else {
    isLimited = checkMemoryRateLimit(key, windowMs, max);
  }

  if (isLimited) {
    const retryAfter = Math.ceil(windowMs / 1000);
    return new Response(
      JSON.stringify({
        error: "Too many requests. Please try again later.",
      }),
      {
        status: 429,
        headers: {
          ...CORS,
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
        },
      },
    );
  }

  return null;
}

/**
 * Legacy sync version — in-memory only.
 * Kept for backward compatibility with edge functions that don't pass supabaseAdmin.
 * @deprecated Use the async version with supabaseAdmin parameter for DB-backed limiting.
 */
export function checkRateLimitSync(
  req: Request,
  options: RateLimitOptions = {},
): Response | null {
  const { windowMs = 60_000, max = 30, keyPrefix = "" } = options;

  const ip = getClientIp(req);
  const key = keyPrefix ? `${keyPrefix}:${ip}` : ip;

  if (checkMemoryRateLimit(key, windowMs, max)) {
    return new Response(
      JSON.stringify({
        error: "Too many requests. Please try again later.",
      }),
      {
        status: 429,
        headers: {
          ...CORS,
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(windowMs / 1000)),
        },
      },
    );
  }

  return null;
}

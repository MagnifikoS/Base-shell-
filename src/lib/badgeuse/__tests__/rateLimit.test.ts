/**
 * Rate limiter logic tests
 *
 * Tests the in-memory rate limiting logic from supabase/functions/_shared/rateLimit.ts.
 * Since the source uses Deno imports (cors.ts), we re-implement the core logic here
 * and test it in isolation.
 *
 * Covers:
 * - First request passes
 * - Requests within limit pass
 * - Requests exceeding limit return 429
 * - Window expiration resets counter
 * - Different IPs tracked independently
 * - IP extraction from headers (x-forwarded-for, x-real-ip)
 * - Retry-After header in 429 responses
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Inline rate limiter (same logic as rateLimit.ts, without Deno imports)
// ─────────────────────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Each test gets its own store instance
function createRateLimiter() {
  const store = new Map<string, RateLimitEntry>();

  function cleanup() {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) {
        store.delete(key);
      }
    }
  }

  interface RateLimitOptions {
    windowMs?: number;
    max?: number;
  }

  function checkRateLimit(req: Request, options: RateLimitOptions = {}): Response | null {
    const { windowMs = 60_000, max = 30 } = options;

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const now = Date.now();
    const key = ip;

    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return null;
    }

    entry.count++;

    if (entry.count > max) {
      return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)),
        },
      });
    }

    return null;
  }

  return { checkRateLimit, store, cleanup };
}

function makeRequest(ip: string, headers?: Record<string, string>): Request {
  const h = new Headers();
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      h.set(key, value);
    }
  } else {
    h.set("x-forwarded-for", ip);
  }
  return new Request("https://example.com/api", { headers: h });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("checkRateLimit", () => {
  let limiter: ReturnType<typeof createRateLimiter>;

  beforeEach(() => {
    limiter = createRateLimiter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic rate limiting", () => {
    it("allows the first request", () => {
      const req = makeRequest("192.168.1.1");
      const result = limiter.checkRateLimit(req, { max: 5 });
      expect(result).toBeNull();
    });

    it("allows requests within the limit", () => {
      const req = makeRequest("192.168.1.1");
      for (let i = 0; i < 5; i++) {
        const result = limiter.checkRateLimit(req, { max: 5 });
        expect(result).toBeNull();
      }
    });

    it("returns 429 when limit is exceeded", () => {
      const req = makeRequest("192.168.1.1");

      // Make max requests (5), then the 6th should be blocked
      for (let i = 0; i < 5; i++) {
        limiter.checkRateLimit(req, { max: 5 });
      }

      const result = limiter.checkRateLimit(req, { max: 5 });
      expect(result).not.toBeNull();
      expect(result!.status).toBe(429);
    });

    it("returns proper JSON body in 429 response", async () => {
      const req = makeRequest("192.168.1.1");

      // Exceed limit
      for (let i = 0; i < 2; i++) {
        limiter.checkRateLimit(req, { max: 1 });
      }

      const result = limiter.checkRateLimit(req, { max: 1 });
      expect(result).not.toBeNull();

      const body = await result!.json();
      expect(body.error).toBe("Too many requests. Please try again later.");
    });

    it("includes Retry-After header in 429 response", async () => {
      const req = makeRequest("192.168.1.1");

      // Exceed limit
      for (let i = 0; i < 2; i++) {
        limiter.checkRateLimit(req, { max: 1, windowMs: 60_000 });
      }

      const result = limiter.checkRateLimit(req, { max: 1, windowMs: 60_000 });
      expect(result).not.toBeNull();

      const retryAfter = result!.headers.get("Retry-After");
      expect(retryAfter).toBeTruthy();
      const seconds = parseInt(retryAfter!, 10);
      // Should be between 0 and 60 seconds
      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(60);
    });
  });

  describe("default options", () => {
    it("uses default max of 30 when not specified", () => {
      const req = makeRequest("10.0.0.1");

      // 30 requests should pass (default max)
      for (let i = 0; i < 30; i++) {
        const result = limiter.checkRateLimit(req);
        expect(result).toBeNull();
      }

      // 31st should be blocked
      const result = limiter.checkRateLimit(req);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(429);
    });

    it("uses default window of 60s when not specified", () => {
      const req = makeRequest("10.0.0.2");

      // Exhaust limit
      for (let i = 0; i < 31; i++) {
        limiter.checkRateLimit(req);
      }

      const blocked = limiter.checkRateLimit(req);
      expect(blocked).not.toBeNull();

      // Advance time by 61 seconds (past default 60s window)
      vi.advanceTimersByTime(61_000);

      const allowed = limiter.checkRateLimit(req);
      expect(allowed).toBeNull();
    });
  });

  describe("window expiration", () => {
    it("resets counter after window expires", () => {
      const req = makeRequest("192.168.1.1");

      // Use up all attempts
      for (let i = 0; i < 3; i++) {
        limiter.checkRateLimit(req, { max: 3, windowMs: 10_000 });
      }

      // Should be blocked
      const blocked = limiter.checkRateLimit(req, { max: 3, windowMs: 10_000 });
      expect(blocked).not.toBeNull();

      // Advance time past the window
      vi.advanceTimersByTime(11_000);

      // Should be allowed again
      const allowed = limiter.checkRateLimit(req, { max: 3, windowMs: 10_000 });
      expect(allowed).toBeNull();
    });

    it("starts a fresh window after expiration", () => {
      const req = makeRequest("192.168.1.1");

      // First window: exhaust
      for (let i = 0; i < 3; i++) {
        limiter.checkRateLimit(req, { max: 3, windowMs: 5_000 });
      }

      // Advance past first window
      vi.advanceTimersByTime(6_000);

      // Second window: should have full quota
      for (let i = 0; i < 3; i++) {
        const result = limiter.checkRateLimit(req, { max: 3, windowMs: 5_000 });
        expect(result).toBeNull();
      }

      // 4th in second window should be blocked
      const blocked = limiter.checkRateLimit(req, { max: 3, windowMs: 5_000 });
      expect(blocked).not.toBeNull();
    });
  });

  describe("IP-based tracking", () => {
    it("tracks different IPs independently", () => {
      const req1 = makeRequest("192.168.1.1");
      const req2 = makeRequest("192.168.1.2");

      // Exhaust limit for IP 1
      for (let i = 0; i < 3; i++) {
        limiter.checkRateLimit(req1, { max: 3 });
      }

      // IP 1 should be blocked
      const blockedIp1 = limiter.checkRateLimit(req1, { max: 3 });
      expect(blockedIp1).not.toBeNull();

      // IP 2 should still be allowed
      const allowedIp2 = limiter.checkRateLimit(req2, { max: 3 });
      expect(allowedIp2).toBeNull();
    });

    it("extracts IP from x-forwarded-for (first IP in list)", () => {
      const req = new Request("https://example.com/api", {
        headers: {
          "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.10.11.12",
        },
      });

      limiter.checkRateLimit(req, { max: 1 });

      // The store key should be "1.2.3.4" (first IP)
      expect(limiter.store.has("1.2.3.4")).toBe(true);
      expect(limiter.store.has("5.6.7.8")).toBe(false);
    });

    it("falls back to x-real-ip when x-forwarded-for is absent", () => {
      const req = new Request("https://example.com/api", {
        headers: {
          "x-real-ip": "10.20.30.40",
        },
      });

      limiter.checkRateLimit(req, { max: 1 });

      expect(limiter.store.has("10.20.30.40")).toBe(true);
    });

    it("uses 'unknown' when no IP headers present", () => {
      const req = new Request("https://example.com/api");

      limiter.checkRateLimit(req, { max: 1 });

      expect(limiter.store.has("unknown")).toBe(true);
    });

    it("trims whitespace from x-forwarded-for IP", () => {
      const req = new Request("https://example.com/api", {
        headers: {
          "x-forwarded-for": "  1.2.3.4  , 5.6.7.8",
        },
      });

      limiter.checkRateLimit(req, { max: 1 });

      expect(limiter.store.has("1.2.3.4")).toBe(true);
    });
  });

  describe("cleanup", () => {
    it("removes expired entries from the store", () => {
      const req1 = makeRequest("192.168.1.1");
      const req2 = makeRequest("192.168.1.2");

      // Add entries with short window
      limiter.checkRateLimit(req1, { windowMs: 5_000 });
      limiter.checkRateLimit(req2, { windowMs: 10_000 });

      expect(limiter.store.size).toBe(2);

      // Advance past first entry's window but before second
      vi.advanceTimersByTime(6_000);

      limiter.cleanup();

      // First entry should be removed, second should remain
      expect(limiter.store.size).toBe(1);
      expect(limiter.store.has("192.168.1.2")).toBe(true);
    });

    it("handles empty store gracefully", () => {
      expect(limiter.store.size).toBe(0);
      limiter.cleanup();
      expect(limiter.store.size).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("handles max=0 (first request creates entry, second is blocked)", () => {
      const req = makeRequest("192.168.1.1");

      // First request creates entry with count=1 and returns null (entry didn't exist)
      const first = limiter.checkRateLimit(req, { max: 0 });
      expect(first).toBeNull();

      // Second request: count becomes 2, which is > 0, so blocked
      const second = limiter.checkRateLimit(req, { max: 0 });
      expect(second).not.toBeNull();
      expect(second!.status).toBe(429);
    });

    it("handles max=1 (only first request allowed)", () => {
      const req = makeRequest("192.168.1.1");

      const first = limiter.checkRateLimit(req, { max: 1 });
      expect(first).toBeNull();

      const second = limiter.checkRateLimit(req, { max: 1 });
      expect(second).not.toBeNull();
    });

    it("handles very short window", () => {
      const req = makeRequest("192.168.1.1");

      limiter.checkRateLimit(req, { max: 1, windowMs: 1 });

      // Advance 2ms
      vi.advanceTimersByTime(2);

      const result = limiter.checkRateLimit(req, { max: 1, windowMs: 1 });
      expect(result).toBeNull(); // Window expired
    });
  });
});

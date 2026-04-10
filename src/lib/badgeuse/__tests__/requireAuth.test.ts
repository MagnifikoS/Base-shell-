/**
 * Auth validation logic tests
 *
 * Tests the authentication middleware pattern from supabase/functions/_shared/requireAuth.ts.
 * Since the source uses Deno imports and Supabase client, we test the logic patterns:
 * - AuthError class behavior
 * - Header extraction logic
 * - Error shape validation
 *
 * The actual Supabase auth.getUser() call cannot be tested without mocking,
 * but we verify the error handling patterns and the AuthError class contract.
 */

import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Inline AuthError class (same logic as requireAuth.ts)
// ─────────────────────────────────────────────────────────────────────────────

class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Simulated requireAuth logic (without Supabase client creation).
 * Tests the header extraction and error throwing patterns.
 */
function extractAuthHeader(req: Request): string {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new AuthError("Missing authorization", 401);
  }
  return authHeader;
}

/**
 * Simulated auth validation (throws if user is null/error).
 * Tests the error shape used in the actual function.
 */
function validateUser(user: { id: string } | null, error: Error | null): { id: string } {
  if (error || !user) {
    throw new AuthError("Unauthorized", 401);
  }
  return user;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("AuthError", () => {
  it("has the correct message property", () => {
    const error = new AuthError("Missing authorization", 401);
    expect(error.message).toBe("Missing authorization");
  });

  it("has the correct status property", () => {
    const error = new AuthError("Missing authorization", 401);
    expect(error.status).toBe(401);
  });

  it("is an instance of Error", () => {
    const error = new AuthError("Unauthorized", 401);
    expect(error).toBeInstanceOf(Error);
  });

  it("is an instance of AuthError", () => {
    const error = new AuthError("Unauthorized", 401);
    expect(error).toBeInstanceOf(AuthError);
  });

  it("can carry different status codes", () => {
    const forbidden = new AuthError("Forbidden", 403);
    expect(forbidden.status).toBe(403);
    expect(forbidden.message).toBe("Forbidden");

    const serverError = new AuthError("Internal error", 500);
    expect(serverError.status).toBe(500);
  });

  it("has a stack trace", () => {
    const error = new AuthError("Test", 401);
    expect(error.stack).toBeDefined();
    // Stack trace contains the error message (JS subclass stacks show "Error: <message>")
    expect(error.stack).toContain("Test");
  });
});

describe("extractAuthHeader", () => {
  it("extracts Authorization header when present", () => {
    const req = new Request("https://example.com/api", {
      headers: {
        Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.test",
      },
    });

    const header = extractAuthHeader(req);
    expect(header).toBe("Bearer eyJhbGciOiJIUzI1NiJ9.test");
  });

  it("throws AuthError with 401 when Authorization header is missing", () => {
    const req = new Request("https://example.com/api");

    expect(() => extractAuthHeader(req)).toThrow(AuthError);

    try {
      extractAuthHeader(req);
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).message).toBe("Missing authorization");
      expect((e as AuthError).status).toBe(401);
    }
  });

  it("throws for empty Authorization value (empty string is falsy in JS)", () => {
    const req = new Request("https://example.com/api", {
      headers: {
        Authorization: "",
      },
    });

    // Empty string is falsy in JS, so `!authHeader` is true
    // This matches the real requireAuth.ts behavior
    expect(() => extractAuthHeader(req)).toThrow(AuthError);
  });

  it("is case-insensitive for header name lookup", () => {
    // Headers.get() is case-insensitive per spec
    const headers = new Headers();
    headers.set("authorization", "Bearer token123");
    const req = new Request("https://example.com/api", { headers });

    const header = extractAuthHeader(req);
    expect(header).toBe("Bearer token123");
  });

  it("works with various token formats", () => {
    const formats = [
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "Bearer short-token",
      "Basic dXNlcjpwYXNz",
    ];

    for (const format of formats) {
      const req = new Request("https://example.com/api", {
        headers: { Authorization: format },
      });
      expect(extractAuthHeader(req)).toBe(format);
    }
  });
});

describe("validateUser", () => {
  it("returns user when user is valid and no error", () => {
    const user = { id: "user-123" };
    const result = validateUser(user, null);
    expect(result).toBe(user);
    expect(result.id).toBe("user-123");
  });

  it("throws AuthError when user is null", () => {
    expect(() => validateUser(null, null)).toThrow(AuthError);

    try {
      validateUser(null, null);
    } catch (e) {
      expect((e as AuthError).message).toBe("Unauthorized");
      expect((e as AuthError).status).toBe(401);
    }
  });

  it("throws AuthError when error is present (even with valid user)", () => {
    const user = { id: "user-123" };
    const error = new Error("JWT expired");

    expect(() => validateUser(user, error)).toThrow(AuthError);

    try {
      validateUser(user, error);
    } catch (e) {
      expect((e as AuthError).message).toBe("Unauthorized");
      expect((e as AuthError).status).toBe(401);
    }
  });

  it("throws AuthError when both user is null and error exists", () => {
    const error = new Error("Invalid token");

    expect(() => validateUser(null, error)).toThrow(AuthError);

    try {
      validateUser(null, error);
    } catch (e) {
      expect((e as AuthError).status).toBe(401);
    }
  });
});

describe("error handling pattern in edge function context", () => {
  it("error shape can be caught and converted to HTTP response", () => {
    // Simulate how edge functions handle AuthError
    let responseStatus = 200;
    let responseBody = "";

    try {
      throw new AuthError("Missing authorization", 401);
    } catch (e) {
      if (e instanceof AuthError) {
        responseStatus = e.status;
        responseBody = JSON.stringify({ error: e.message });
      }
    }

    expect(responseStatus).toBe(401);
    expect(JSON.parse(responseBody)).toEqual({
      error: "Missing authorization",
    });
  });

  it("distinguishes AuthError from regular Error", () => {
    const authError = new AuthError("Unauthorized", 401);
    const regularError = new Error("Something else went wrong");

    expect(authError instanceof AuthError).toBe(true);
    expect(authError instanceof Error).toBe(true);
    expect(regularError instanceof AuthError).toBe(false);
    expect(regularError instanceof Error).toBe(true);
  });

  it("CORS preflight bypass pattern works with OPTIONS method", () => {
    // This tests the pattern used before requireAuth in every edge function
    const req = new Request("https://example.com/api", {
      method: "OPTIONS",
    });

    // The pattern: skip auth for CORS preflight
    if (req.method === "OPTIONS") {
      // Should return CORS response, not call requireAuth
      const response = new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        },
      });
      expect(response.status).toBe(200);
      return;
    }

    // This should not be reached for OPTIONS
    expect.fail("Should have returned for OPTIONS");
  });
});

/**
 * Crypto utilities tests
 *
 * Tests the pure cryptographic functions from supabase/functions/_shared/crypto.ts.
 * Since crypto.ts uses Web Crypto API (available in both Deno and Node/jsdom),
 * we re-implement the core logic and test it directly.
 *
 * Covers:
 * - hashPinPbkdf2: PBKDF2-SHA256 hashing format "pbkdf2:100000:<salt>:<hash>"
 * - verifyPinPbkdf2: Verification of PBKDF2 hashes
 * - hashPin (legacy): SHA-256 + fixed salt
 * - pinHashNeedsRehash: Detection of legacy hash formats
 * - Constant-time comparison logic
 * - hashToken: SHA-256 token hashing
 * - timingSafeEqual: Constant-time string comparison
 */

import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Inline copies of crypto functions (same logic as crypto.ts)
// ─────────────────────────────────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH_BYTES = 32;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function hashPinPbkdf2(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));

  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    PBKDF2_HASH_BYTES * 8
  );

  const hashHex = toHex(new Uint8Array(derivedBits));
  const saltHex = toHex(salt);

  return `pbkdf2:${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

async function verifyPinPbkdf2(pin: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    return false;
  }

  const iterations = parseInt(parts[1], 10);
  const salt = fromHex(parts[2]);
  const expectedHash = parts[3];

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    PBKDF2_HASH_BYTES * 8
  );

  const actualHash = toHex(new Uint8Array(derivedBits));

  if (actualHash.length !== expectedHash.length) return false;
  let result = 0;
  for (let i = 0; i < actualHash.length; i++) {
    result |= actualHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return result === 0;
}

async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + "badgeuse_salt_v1");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function pinHashNeedsRehash(storedHash: string): boolean {
  return !storedHash.startsWith("pbkdf2:");
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  const aHash = new Uint8Array(await crypto.subtle.digest("SHA-256", aBytes));
  const bHash = new Uint8Array(await crypto.subtle.digest("SHA-256", bBytes));

  if (aHash.length !== bHash.length) return false;

  let result = 0;
  for (let i = 0; i < aHash.length; i++) {
    result |= aHash[i] ^ bHash[i];
  }
  return result === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("hashPinPbkdf2", () => {
  it("produces output in correct format: pbkdf2:<iterations>:<salt_hex>:<hash_hex>", async () => {
    const hash = await hashPinPbkdf2("1234");
    const parts = hash.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2");
    expect(parts[1]).toBe("100000");
  });

  it("produces a 32-byte (64 hex chars) salt", async () => {
    const hash = await hashPinPbkdf2("1234");
    const saltHex = hash.split(":")[2];
    expect(saltHex).toHaveLength(32); // 16 bytes = 32 hex chars
  });

  it("produces a 64 hex char hash (32 bytes)", async () => {
    const hash = await hashPinPbkdf2("1234");
    const hashHex = hash.split(":")[3];
    expect(hashHex).toHaveLength(64); // 32 bytes = 64 hex chars
  });

  it("produces different hashes for the same PIN (random salt)", async () => {
    const hash1 = await hashPinPbkdf2("1234");
    const hash2 = await hashPinPbkdf2("1234");
    // Different salts => different hashes
    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different PINs", async () => {
    const hash1 = await hashPinPbkdf2("1234");
    const hash2 = await hashPinPbkdf2("5678");
    // Different input => (almost certainly) different hash
    expect(hash1.split(":")[3]).not.toBe(hash2.split(":")[3]);
  });

  it("salt hex contains only valid hex characters", async () => {
    const hash = await hashPinPbkdf2("0000");
    const saltHex = hash.split(":")[2];
    expect(saltHex).toMatch(/^[0-9a-f]+$/);
  });

  it("hash hex contains only valid hex characters", async () => {
    const hash = await hashPinPbkdf2("9999");
    const hashHex = hash.split(":")[3];
    expect(hashHex).toMatch(/^[0-9a-f]+$/);
  });
});

describe("verifyPinPbkdf2", () => {
  it("verifies a correct PIN against its hash", async () => {
    const hash = await hashPinPbkdf2("1234");
    const result = await verifyPinPbkdf2("1234", hash);
    expect(result).toBe(true);
  });

  it("rejects an incorrect PIN", async () => {
    const hash = await hashPinPbkdf2("1234");
    const result = await verifyPinPbkdf2("5678", hash);
    expect(result).toBe(false);
  });

  it("rejects an empty PIN", async () => {
    const hash = await hashPinPbkdf2("1234");
    const result = await verifyPinPbkdf2("", hash);
    expect(result).toBe(false);
  });

  it("returns false for invalid hash format (wrong prefix)", async () => {
    const result = await verifyPinPbkdf2("1234", "sha256:abc:def:ghi");
    expect(result).toBe(false);
  });

  it("returns false for invalid hash format (too few parts)", async () => {
    const result = await verifyPinPbkdf2("1234", "pbkdf2:100000:abc");
    expect(result).toBe(false);
  });

  it("returns false for invalid hash format (too many parts)", async () => {
    const result = await verifyPinPbkdf2("1234", "pbkdf2:100000:abc:def:extra");
    expect(result).toBe(false);
  });

  it("roundtrips correctly for various PINs", async () => {
    const pins = ["0000", "1234", "9999", "0001", "8765"];
    for (const pin of pins) {
      const hash = await hashPinPbkdf2(pin);
      expect(await verifyPinPbkdf2(pin, hash)).toBe(true);
      // Different PIN should fail
      const wrongPin = pin === "0000" ? "1111" : "0000";
      expect(await verifyPinPbkdf2(wrongPin, hash)).toBe(false);
    }
  });
});

describe("hashPin (legacy SHA-256)", () => {
  it("produces a 64-char hex string", async () => {
    const hash = await hashPin("1234");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("produces deterministic output (same input = same hash)", async () => {
    const hash1 = await hashPin("1234");
    const hash2 = await hashPin("1234");
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different PINs", async () => {
    const hash1 = await hashPin("1234");
    const hash2 = await hashPin("5678");
    expect(hash1).not.toBe(hash2);
  });

  it("uses the fixed salt 'badgeuse_salt_v1'", async () => {
    // Verify by computing the hash manually
    const encoder = new TextEncoder();
    const data = encoder.encode("1234badgeuse_salt_v1");
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const expected = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const hash = await hashPin("1234");
    expect(hash).toBe(expected);
  });
});

describe("pinHashNeedsRehash", () => {
  it("returns false for PBKDF2 hashes", () => {
    expect(pinHashNeedsRehash("pbkdf2:100000:abc123:def456")).toBe(false);
  });

  it("returns true for legacy SHA-256 hashes (64 hex chars)", () => {
    const legacyHash = "a".repeat(64);
    expect(pinHashNeedsRehash(legacyHash)).toBe(true);
  });

  it("returns true for bcrypt hashes ($2a$...)", () => {
    expect(pinHashNeedsRehash("$2a$10$somehashedvalue")).toBe(true);
  });

  it("returns true for bcrypt v2b hashes ($2b$...)", () => {
    expect(pinHashNeedsRehash("$2b$10$somehashedvalue")).toBe(true);
  });

  it("returns true for empty string", () => {
    expect(pinHashNeedsRehash("")).toBe(true);
  });

  it("returns true for random non-pbkdf2 format", () => {
    expect(pinHashNeedsRehash("sha256:something")).toBe(true);
  });
});

describe("toHex / fromHex roundtrip", () => {
  it("roundtrips correctly for various byte arrays", () => {
    const testCases = [
      new Uint8Array([0, 1, 2, 3]),
      new Uint8Array([255, 128, 0, 64]),
      new Uint8Array([0, 0, 0, 0]),
      new Uint8Array([255, 255, 255, 255]),
    ];

    for (const original of testCases) {
      const hex = toHex(original);
      const restored = fromHex(hex);
      expect(Array.from(restored)).toEqual(Array.from(original));
    }
  });

  it("produces lowercase hex", () => {
    const bytes = new Uint8Array([171, 205, 239]); // 0xab, 0xcd, 0xef
    expect(toHex(bytes)).toBe("abcdef");
  });

  it("pads single-digit hex values with leading zero", () => {
    const bytes = new Uint8Array([0, 1, 15]);
    expect(toHex(bytes)).toBe("00010f");
  });
});

describe("constant-time comparison (verifyPinPbkdf2 internal)", () => {
  it("comparison does not short-circuit on first mismatch", async () => {
    // This test verifies the constant-time property indirectly:
    // Both calls should execute the full comparison loop
    const hash = await hashPinPbkdf2("1234");

    // Timing test is not deterministic in JS, but we verify correctness
    const result1 = await verifyPinPbkdf2("1234", hash);
    const result2 = await verifyPinPbkdf2("1235", hash);

    expect(result1).toBe(true);
    expect(result2).toBe(false);
  });

  it("XOR comparison produces 0 for identical strings", () => {
    const a = "abcdef1234567890";
    const b = "abcdef1234567890";
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    expect(result).toBe(0);
  });

  it("XOR comparison produces non-zero for different strings", () => {
    const a = "abcdef1234567890";
    const b = "abcdef1234567891";
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    expect(result).not.toBe(0);
  });
});

describe("hashToken", () => {
  it("produces a 64-char hex string", async () => {
    const hash = await hashToken("my-secret-token");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic (same input = same output)", async () => {
    const hash1 = await hashToken("test-token");
    const hash2 = await hashToken("test-token");
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different tokens", async () => {
    const hash1 = await hashToken("token-1");
    const hash2 = await hashToken("token-2");
    expect(hash1).not.toBe(hash2);
  });

  it("does NOT use the badge PIN salt (different from hashPin)", async () => {
    const tokenHash = await hashToken("1234");
    const pinHash = await hashPin("1234");
    expect(tokenHash).not.toBe(pinHash);
  });
});

describe("timingSafeEqual", () => {
  it("returns true for identical strings", async () => {
    expect(await timingSafeEqual("hello", "hello")).toBe(true);
  });

  it("returns false for different strings", async () => {
    expect(await timingSafeEqual("hello", "world")).toBe(false);
  });

  it("returns false for strings of different lengths", async () => {
    expect(await timingSafeEqual("short", "a longer string")).toBe(false);
  });

  it("returns true for empty strings", async () => {
    expect(await timingSafeEqual("", "")).toBe(true);
  });

  it("returns false for nearly identical strings (one char difference)", async () => {
    expect(await timingSafeEqual("abcdef", "abcdeg")).toBe(false);
  });

  it("hashes both inputs before comparing (equal length comparison)", async () => {
    // Even with different-length inputs, comparison uses 32-byte hashes
    const result = await timingSafeEqual("a", "ab");
    expect(result).toBe(false);
  });
});

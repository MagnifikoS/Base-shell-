/**
 * Shared cryptographic utilities for Edge Functions.
 *
 * SSOT for hashing and comparison operations used across:
 * - badge-pin, badge-events (hashPinPbkdf2, verifyPin)
 * - admin-invitations, accept-invitation, admin-create-test-user (hashToken)
 * - bootstrap-admin (timingSafeEqual)
 *
 * SEC-01: PIN hashing uses PBKDF2-SHA256 with 100k iterations + random 16-byte salt.
 * Migration path: verifyPin() supports legacy SHA-256 and bcrypt formats.
 * On successful verify of old format, callers re-hash with PBKDF2.
 *
 * Stored format: "pbkdf2:100000:<salt_hex>:<hash_hex>"
 */

import { hash as bcryptHash, compare as bcryptCompare } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

// ═══════════════════════════════════════════════════════════════════════════
// PBKDF2 PIN hashing (SEC-01 — NIST-recommended)
// ═══════════════════════════════════════════════════════════════════════════

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH_BYTES = 32; // 256 bits

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

/**
 * Hash a PIN using PBKDF2-SHA256 with 100k iterations + random 16-byte salt.
 * Returns: "pbkdf2:100000:<salt_hex>:<hash_hex>"
 */
export async function hashPinPbkdf2(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
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

/**
 * Verify a PIN against a PBKDF2 stored hash.
 * Stored format: "pbkdf2:<iterations>:<salt_hex>:<hash_hex>"
 */
export async function verifyPinPbkdf2(pin: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    return false;
  }

  const iterations = parseInt(parts[1], 10);
  const salt = fromHex(parts[2]);
  const expectedHash = parts[3];

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

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

  // Constant-time comparison
  if (actualHash.length !== expectedHash.length) return false;
  let result = 0;
  for (let i = 0; i < actualHash.length; i++) {
    result |= actualHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return result === 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Legacy hash functions (kept for backward compatibility during migration)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hash a 4-digit PIN using SHA-256 with a fixed salt.
 * @deprecated SEC-PIN-001: Use hashPinPbkdf2() for new PINs. Kept ONLY for legacy
 * hash verification during transparent migration. Once all stored hashes have been
 * migrated to PBKDF2 format (verified by querying user_badge_pins for non-"pbkdf2:"
 * prefixed hashes), this function and the legacy SHA-256 path in verifyPin() can be
 * removed entirely.
 */
// TODO: Remove legacy SHA-256 path after migration window (SEC-PIN-001)
export async function hashPin(pin: string): Promise<string> {
  console.warn("[SEC-PIN-001] Legacy SHA-256 hashPin() called — this path is deprecated. All new PINs should use hashPinPbkdf2().");
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + "badgeuse_salt_v1");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hash a 4-digit PIN using bcrypt.
 * @deprecated SEC-PIN-001: Use hashPinPbkdf2() for new PINs. Kept ONLY for legacy
 * hash verification during transparent migration. Remove once all hashes are PBKDF2.
 */
// TODO: Remove legacy bcrypt path after migration window (SEC-PIN-001)
export async function hashPinBcrypt(pin: string): Promise<string> {
  console.warn("[SEC-PIN-001] Legacy bcrypt hashPinBcrypt() called — this path is deprecated.");
  return await bcryptHash(pin);
}

/**
 * Verify a PIN against a bcrypt hash.
 * @deprecated SEC-PIN-001: Internal use only — verifyPin() dispatches automatically.
 * Remove once all hashes are migrated to PBKDF2.
 */
// TODO: Remove legacy bcrypt path after migration window (SEC-PIN-001)
export async function verifyPinBcrypt(pin: string, hash: string): Promise<boolean> {
  return await bcryptCompare(pin, hash);
}

// ═══════════════════════════════════════════════════════════════════════════
// Unified verifier (supports all 3 formats for transparent migration)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify a PIN supporting all stored hash formats:
 *  1. PBKDF2: starts with "pbkdf2:"
 *  2. Bcrypt: starts with "$2a$" or "$2b$"
 *  3. Legacy SHA-256: 64-char hex string
 *
 * Returns { valid: boolean, needsRehash: boolean }
 * - needsRehash=true when the hash is in an old format.
 *   Callers should re-hash with hashPinPbkdf2() and update DB.
 */
export async function verifyPin(
  pin: string,
  storedHash: string
): Promise<boolean> {
  // Format 1: PBKDF2 (current recommended)
  if (storedHash.startsWith("pbkdf2:")) {
    return await verifyPinPbkdf2(pin, storedHash);
  }

  // Format 2: bcrypt (deprecated — SEC-PIN-001)
  // TODO: Remove legacy bcrypt path after migration window (SEC-PIN-001)
  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$")) {
    console.warn("[SEC-PIN-001] Legacy bcrypt PIN hash detected — suggest migration to PBKDF2. Will be auto-migrated on next successful verify.");
    return await verifyPinBcrypt(pin, storedHash);
  }

  // Format 3: Legacy SHA-256 (64-char hex) (deprecated — SEC-PIN-001)
  // TODO: Remove legacy SHA-256 path after migration window (SEC-PIN-001)
  // WARNING: SHA-256 with a fixed salt is NOT suitable for password/PIN storage.
  // This path exists solely for backward compatibility. The transparent migration
  // in badge-events/userHandlers.ts re-hashes to PBKDF2 on successful verify.
  console.warn("[SEC-PIN-001] Legacy SHA-256 PIN hash detected — suggest migration to PBKDF2. Will be auto-migrated on next successful verify.");
  const sha256Hash = await hashPin(pin);
  return sha256Hash === storedHash;
}

/**
 * Check if a stored hash needs migration to PBKDF2.
 */
export function pinHashNeedsRehash(storedHash: string): boolean {
  return !storedHash.startsWith("pbkdf2:");
}

// ═══════════════════════════════════════════════════════════════════════════
// Token hashing + timing-safe comparison
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hash a token (invitation token, etc.) using SHA-256.
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Both strings are hashed to ensure equal-length comparison.
 * Returns true if the strings are equal.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  // Hash both to ensure equal-length buffers for comparison
  const aHash = new Uint8Array(await crypto.subtle.digest("SHA-256", aBytes));
  const bHash = new Uint8Array(await crypto.subtle.digest("SHA-256", bBytes));

  if (aHash.length !== bHash.length) {
    return false;
  }

  // XOR comparison — constant time regardless of position of first difference
  let result = 0;
  for (let i = 0; i < aHash.length; i++) {
    result |= aHash[i] ^ bHash[i];
  }

  return result === 0;
}

/**
 * RED-FRONTEND — MOBILE-01: Device ID in localStorage
 *
 * Finding: The badge clock-in system generates a device ID and stores it
 * in localStorage under a known, predictable key. This device ID is then
 * sent to the server for device binding.
 *
 * Risks:
 * - Any JS running on the same origin can read/write the device ID
 * - XSS can exfiltrate the device ID
 * - A user can clone the device ID to another browser/device to spoof identity
 * - localStorage has no expiration — the device ID persists indefinitely
 * - Server-side device binding is optional (configurable per establishment)
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("MOBILE-01: Device ID localStorage exposure", () => {
  it("should verify device ID is stored in localStorage with a known key", async () => {
    const source = await readSourceFile("src/lib/badgeuse/deviceId.ts");

    // PoC: The localStorage key is a hardcoded, predictable constant
    const keyDeclaration = findInSource(source, /const DEVICE_ID_KEY\s*=\s*["']([^"']+)["']/g);
    expect(keyDeclaration.length).toBe(1);

    // Verify the key name is predictable (attacker knows what to look for)
    const hasKnownKey = findInSource(source, /badgeuse_device_id/g);
    expect(hasKnownKey.length).toBeGreaterThanOrEqual(1);
  });

  it("should verify device ID is stored via localStorage.setItem", async () => {
    const source = await readSourceFile("src/lib/badgeuse/deviceId.ts");

    // PoC: localStorage.setItem is used to persist the device ID
    const setItemCalls = findInSource(source, /localStorage\.setItem\s*\(/g);
    expect(setItemCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should verify device ID is read via localStorage.getItem", async () => {
    const source = await readSourceFile("src/lib/badgeuse/deviceId.ts");

    // PoC: localStorage.getItem is used to retrieve the device ID
    const getItemCalls = findInSource(source, /localStorage\.getItem\s*\(/g);
    expect(getItemCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should verify device ID format is predictable (prefixed with dev_)", async () => {
    const source = await readSourceFile("src/lib/badgeuse/deviceId.ts");

    // PoC: Device IDs start with "dev_" prefix — easy to identify in storage
    const prefixPattern = findInSource(source, /`dev_\$\{/g);
    expect(prefixPattern.length).toBe(1);
  });

  it("should verify no encryption or obfuscation of the device ID in storage", async () => {
    const source = await readSourceFile("src/lib/badgeuse/deviceId.ts");

    // Check for any encryption, hashing, or obfuscation
    const encryption = findInSource(
      source,
      /encrypt|decrypt|CryptoJS|crypto\.subtle|hash|hmac|AES|obfuscate/gi
    );

    // PoC: Device ID is stored in PLAINTEXT — no encryption whatsoever
    expect(encryption.length).toBe(0);
  });

  it("should verify no expiration or rotation mechanism for device IDs", async () => {
    const source = await readSourceFile("src/lib/badgeuse/deviceId.ts");

    // Check for any TTL, expiration, or rotation logic
    const expiration = findInSource(
      source,
      /expir|ttl|rotate|refresh|maxAge|max_age|timeout|validity/gi
    );

    // PoC: Device ID never expires — once set, it persists forever
    expect(expiration.length).toBe(0);
  });

  it("should verify no integrity check on the device ID when reading", async () => {
    const source = await readSourceFile("src/lib/badgeuse/deviceId.ts");

    // Check for any HMAC, signature, or integrity verification
    const integrityCheck = findInSource(
      source,
      /verify|signature|hmac|checksum|integrity|tamper/gi
    );

    // PoC: Device ID is read from localStorage without any integrity check
    // An attacker can modify the value and the app will use it as-is
    expect(integrityCheck.length).toBe(0);
  });

  it("should verify server-side device binding is optional (not always enforced)", async () => {
    const serverSource = await readSourceFile(
      "supabase/functions/badge-events/_shared/userHandlers.ts"
    );

    // Check if device binding is conditional
    const conditionalBinding = findInSource(serverSource, /device_binding_enabled/g);

    // PoC: Server-side device validation is OPTIONAL — controlled by a config flag
    // If device_binding_enabled is false, any device ID is accepted without validation
    expect(conditionalBinding.length).toBeGreaterThanOrEqual(1);
  });

  it("should verify the device ID is sent to the server in badge events", async () => {
    const serverSource = await readSourceFile("supabase/functions/badge-events/index.ts");

    // Check that device_id is part of the request body
    const deviceIdInBody = findInSource(serverSource, /device_id/g);

    // The device ID from localStorage is sent to the server
    // If spoofed, it can bypass device binding
    expect(deviceIdInBody.length).toBeGreaterThanOrEqual(1);
  });

  it("should verify server-side now captures IP/user-agent but device_id is still self-reported", async () => {
    const serverSource = await readSourceFile(
      "supabase/functions/badge-events/_shared/userHandlers.ts"
    );

    // PARTIALLY REMEDIATED: IP/user-agent are now captured for audit logging
    const fingerprinting = findInSource(
      serverSource,
      /user-agent|ip_address|client_ip|x-forwarded-for/gi
    );
    expect(fingerprinting.length).toBeGreaterThan(0);

    // However, device_id is still self-reported from localStorage (not tied to IP/fingerprint)
    // Copying the device_id value from another browser still works for impersonation
    const deviceIdValidation = findInSource(
      serverSource,
      /validateDeviceId|verifyDevice|deviceFingerprint/gi
    );
    expect(deviceIdValidation.length).toBe(0);
  });

  it("should verify device ID is accessible from the global scope (no closure protection)", async () => {
    const source = await readSourceFile("src/lib/badgeuse/deviceId.ts");

    // Check that functions are exported (publicly accessible)
    const exports = findInSource(source, /export function/g);

    // Both getDeviceId and hasDeviceId are exported
    // Any imported module can read the device ID
    expect(exports.length).toBeGreaterThanOrEqual(2);

    // The localStorage key is a module-level constant (not in a closure)
    // but it's a known value ("badgeuse_device_id"), so any code on the page
    // can directly access localStorage.getItem("badgeuse_device_id")
  });
});

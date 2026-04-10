/**
 * RED-DATA :: DATA-02 — PIN Sent as Plaintext in Request Body
 *
 * Target: src/hooks/badgeuse/useCreateBadgeEvent.ts
 *         supabase/functions/badge-events/index.ts
 *         supabase/functions/badge-events/_shared/userHandlers.ts
 *
 * Vulnerability: The badge PIN is sent as a raw plaintext string in the
 * JSON body { pin: "1234" }. It is NOT hashed on the client side before
 * transmission. While TLS protects the transport layer, the PIN travels
 * in plaintext within the request body — it can be logged by proxies,
 * appear in server logs, and be captured by middleware.
 *
 * Server-side hashing only happens AFTER the PIN arrives — meaning the
 * raw PIN value is available in the edge function's memory during processing.
 *
 * This test PASSES when the vulnerability EXISTS (PIN sent as raw string).
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("DATA-02: PIN Sent as Plaintext in Request Body", () => {
  const HOOK_FILE = "src/hooks/badgeuse/useCreateBadgeEvent.ts";
  const EDGE_FN_INDEX = "supabase/functions/badge-events/index.ts";
  const USER_HANDLERS = "supabase/functions/badge-events/_shared/userHandlers.ts";

  it("should confirm client sends PIN as raw string in JSON body", async () => {
    const source = await readSourceFile(HOOK_FILE);

    // Find the JSON.stringify call that builds the request body
    const bodyStringify = findInSource(source, /JSON\.stringify\(\{[\s\S]*?\}\)/g);
    expect(bodyStringify.length).toBeGreaterThan(0);

    // Check that `pin: params.pin` is sent directly (not hashed)
    const pinInBody = findInSource(source, /pin:\s*params\.pin/g);
    expect(pinInBody.length).toBeGreaterThan(0);
  });

  it("should confirm NO client-side hashing of PIN before transmission", async () => {
    const source = await readSourceFile(HOOK_FILE);

    // Check for any hashing of the PIN on the client side
    const hashPatterns = findInSource(
      source,
      /hash.*pin|hashPin|crypto\.subtle.*pin|sha.*pin|pbkdf2.*pin|bcrypt.*pin/gi
    );

    // Vulnerability EXISTS: no client-side hashing found
    expect(hashPatterns.length).toBe(0);
  });

  it("should confirm NO import of any hashing utility in the hook", async () => {
    const source = await readSourceFile(HOOK_FILE);

    // Check imports for any crypto/hashing library
    const cryptoImports = findInSource(
      source,
      /import.*(?:crypto|hash|bcrypt|pbkdf2|sha256|sha-256)/gi
    );

    // Vulnerability EXISTS: no crypto imports
    expect(cryptoImports.length).toBe(0);
  });

  it("should confirm server receives raw PIN from request body", async () => {
    const source = await readSourceFile(EDGE_FN_INDEX);

    // The edge function parses the body and extracts pin as-is
    const pinField = findInSource(source, /pin\??:\s*string/g);
    expect(pinField.length).toBeGreaterThan(0);

    // Pin is passed directly to the handler without any transformation
    const pinPassthrough = findInSource(source, /pin:\s*body\.pin/g);
    expect(pinPassthrough.length).toBeGreaterThan(0);
  });

  it("should confirm server-side handler receives raw PIN and hashes it internally", async () => {
    const source = await readSourceFile(USER_HANDLERS);

    // The handler receives the raw pin parameter
    const pinParam = findInSource(source, /pin\??:\s*string/g);
    expect(pinParam.length).toBeGreaterThan(0);

    // The server does hash the PIN — but only after receiving it as plaintext
    const serverSideHash = findInSource(source, /verifyPin|hashPin|hashPinPbkdf2/g);
    expect(serverSideHash.length).toBeGreaterThan(0);
  });

  it("should confirm the PIN type is a plain string, not a hash format", async () => {
    const source = await readSourceFile(HOOK_FILE);

    // The CreateBadgeEventParams interface defines pin as optional string
    const pinType = findInSource(source, /pin\?:\s*string/g);
    expect(pinType.length).toBeGreaterThan(0);

    // No pin_hash field exists in the params — only raw pin
    const pinHashField = findInSource(source, /pin_hash/g);
    expect(pinHashField.length).toBe(0);
  });
});

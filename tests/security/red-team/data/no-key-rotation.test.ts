/**
 * RED-DATA :: CRYPTO-03 — No Encryption Key Rotation Procedure
 *
 * Target: supabase/functions/employees/index.ts
 *
 * Vulnerability: The encryption system uses a single ENCRYPTION_KEY
 * (now EMPLOYEE_DATA_KEY) with no rotation mechanism. If the key is
 * compromised, there is no procedure to re-encrypt all data with a
 * new key. The system has ENCRYPTION_VERSION = 1 but no logic to
 * handle multiple versions or migrate between them.
 *
 * This test PASSES when the vulnerability EXISTS (no key rotation logic).
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("CRYPTO-03: No Encryption Key Rotation Procedure", () => {
  const EMPLOYEES_FN = "supabase/functions/employees/index.ts";

  it("should confirm single ENCRYPTION_VERSION constant with no rotation logic", async () => {
    const source = await readSourceFile(EMPLOYEES_FN);

    // Find the ENCRYPTION_VERSION constant
    const versionConst = findInSource(source, /ENCRYPTION_VERSION\s*=\s*\d+/g);
    expect(versionConst.length).toBeGreaterThan(0);

    // Verify only version 1 exists (no multiple versions)
    const version1 = findInSource(source, /ENCRYPTION_VERSION\s*=\s*1/g);
    expect(version1.length).toBe(1);

    // No version 2 or higher
    const higherVersions = findInSource(source, /ENCRYPTION_VERSION\s*=\s*[2-9]/g);
    expect(higherVersions.length).toBe(0);
  });

  it("should confirm no key rotation function or procedure exists in executable code", async () => {
    const source = await readSourceFile(EMPLOYEES_FN);

    // Strip comments (single-line // and multi-line /* */) to only examine executable code
    const codeOnly = source
      .replace(/\/\/.*$/gm, "") // remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, ""); // remove multi-line comments

    // Look for any rotation-related function names or patterns in actual code
    const rotationPatterns = findInSource(
      codeOnly,
      /rotateKey|keyRotation|reEncrypt|re_encrypt|key_v\d|keyVersion|key_version|migrateKey|key_migrat/gi
    );

    // Vulnerability EXISTS: no rotation logic found in executable code
    expect(rotationPatterns.length).toBe(0);
  });

  it("should confirm single encryption key environment variable", async () => {
    const source = await readSourceFile(EMPLOYEES_FN);

    // Find the encryption key env var reference
    const keyEnvVars = findInSource(
      source,
      /Deno\.env\.get\(["'](?:ENCRYPTION_KEY|EMPLOYEE_DATA_KEY)["']\)/g
    );

    // Only one key source should exist
    expect(keyEnvVars.length).toBe(1);

    // No secondary/backup/rotation key
    const secondaryKeys = findInSource(
      source,
      /ENCRYPTION_KEY_(?:V2|NEW|OLD|BACKUP|PREV|NEXT)|EMPLOYEE_DATA_KEY_(?:V2|NEW|OLD|BACKUP|PREV|NEXT)/g
    );
    expect(secondaryKeys.length).toBe(0);
  });

  it("should confirm decrypt function does not handle multiple key versions", async () => {
    const source = await readSourceFile(EMPLOYEES_FN);

    // Extract the decrypt function body
    const decryptFnMatch = source.match(/async function decrypt\([\s\S]*?^}/m);
    expect(decryptFnMatch).not.toBeNull();

    const decryptFn = decryptFnMatch![0];

    // The decrypt function handles format detection (old vs new colon-separated)
    // but does NOT handle different encryption keys or key versions
    const keyVersionCheck = findInSource(
      decryptFn,
      /key.*version|version.*key|getEncryptionKey.*v\d|keyForVersion/gi
    );

    // Vulnerability EXISTS: no key version handling in decrypt
    expect(keyVersionCheck.length).toBe(0);
  });

  it("should confirm no key rotation edge function or migration exists", async () => {
    // Check for dedicated rotation edge function
    const edgeFunctions = await globSourceFiles("supabase/functions/*/index.ts");
    let rotationFnFound = false;
    for (const file of edgeFunctions) {
      if (/rotate|re-?encrypt|key-?migrat/i.test(file)) {
        rotationFnFound = true;
        break;
      }
    }
    expect(rotationFnFound).toBe(false);

    // Check for rotation migration
    const migrations = await globSourceFiles("supabase/migrations/*.sql");
    let rotationMigrationFound = false;
    for (const file of migrations) {
      const content = await readSourceFile(file);
      if (/rotate.*encryption|re-?encrypt.*key|key.*rotation/i.test(content)) {
        rotationMigrationFound = true;
        break;
      }
    }
    expect(rotationMigrationFound).toBe(false);
  });

  it("should confirm encryption_version column is stored but never checked during decrypt", async () => {
    const source = await readSourceFile(EMPLOYEES_FN);

    // encryption_version is SET during encrypt/update (stored on the row)
    const versionSet = findInSource(source, /encryption_version:\s*ENCRYPTION_VERSION/g);
    expect(versionSet.length).toBeGreaterThan(0);

    // But during decrypt, encryption_version is NEVER read from the row
    // The decrypt function has no parameter or check for version
    const decryptFnMatch = source.match(/async function decrypt\(encrypted: string\)/);
    expect(decryptFnMatch).not.toBeNull();

    // decrypt only takes a string — no version parameter
    const decryptSignature = findInSource(
      source,
      /async function decrypt\(encrypted: string,\s*version/g
    );
    expect(decryptSignature.length).toBe(0);
  });
});

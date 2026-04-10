/**
 * RED-DATA :: ENV-01 — .env Security
 *
 * Target: .env + .gitignore
 *
 * The `.env` file IS tracked in git — it contains only the Supabase anon key
 * (public by design, embedded in the frontend bundle). This is required for
 * Lovable integration.
 *
 * What we guard against:
 *   - .env containing SERVICE_ROLE_KEY or other secrets
 *   - .gitignore missing protection for .env.local, .env.staging, .env.production
 */
import { describe, it, expect } from "vitest";
import { readSourceFile } from "../../helpers";

describe("ENV-01: .env Security", () => {
  const GITIGNORE = ".gitignore";
  const ENV_FILE = ".env";

  it("should confirm .env exists and contains only public keys", async () => {
    const source = await readSourceFile(ENV_FILE);
    expect(source.length).toBeGreaterThan(0);

    // Must NOT contain any secret keys
    expect(source.toUpperCase()).not.toContain("SERVICE_ROLE");
    expect(source.toUpperCase()).not.toContain("EMPLOYEE_DATA_KEY");
    expect(source.toUpperCase()).not.toContain("BOOTSTRAP_SECRET");
  });

  it("should verify .env contains only VITE_ prefixed keys (public frontend vars)", async () => {
    const source = await readSourceFile(ENV_FILE);
    const lines = source
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    for (const line of lines) {
      const key = line.split("=")[0];
      expect(key).toMatch(/^VITE_/);
    }
  });

  it("should verify .gitignore protects sensitive env variants", async () => {
    const source = await readSourceFile(GITIGNORE);
    const lines = source.split("\n").map((l) => l.trim());

    // These sensitive variants must be in .gitignore
    expect(lines).toContain(".env.local");
    expect(lines).toContain(".env.*.local");
    expect(lines).toContain(".env.production");
    expect(lines).toContain(".env.staging");
  });

  it("should verify supabase/.env is in .gitignore", async () => {
    const source = await readSourceFile(GITIGNORE);
    expect(source).toContain("supabase/.env");
  });
});

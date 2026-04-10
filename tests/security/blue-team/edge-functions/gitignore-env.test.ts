/**
 * ENV-01: Environment Security Assessment
 *
 * Verifies that sensitive env files are protected by .gitignore,
 * and that the tracked .env contains only public keys (anon key).
 *
 * The .env IS tracked intentionally — it holds the Supabase publishable
 * anon key needed for Lovable integration. This test ensures no secrets
 * leak into it.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readSourceFile } from "../../helpers";

describe("ENV-01: Environment Security Assessment", () => {
  let gitignoreContent: string;
  let envContent: string;

  beforeAll(async () => {
    gitignoreContent = await readSourceFile(".gitignore");
    envContent = await readSourceFile(".env");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. .env contains only public keys
  // ═══════════════════════════════════════════════════════════════════════

  it(".env should exist and not be empty", () => {
    expect(envContent).toBeTruthy();
    expect(envContent.length).toBeGreaterThan(0);
  });

  it(".env should contain only VITE_ prefixed variables (public frontend vars)", () => {
    const lines = envContent
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    for (const line of lines) {
      const key = line.split("=")[0];
      expect(key).toMatch(/^VITE_/);
    }
  });

  it(".env must NOT contain SERVICE_ROLE_KEY", () => {
    expect(envContent.toUpperCase()).not.toContain("SERVICE_ROLE");
  });

  it(".env must NOT contain EMPLOYEE_DATA_KEY or BOOTSTRAP_SECRET", () => {
    expect(envContent.toUpperCase()).not.toContain("EMPLOYEE_DATA_KEY");
    expect(envContent.toUpperCase()).not.toContain("BOOTSTRAP_SECRET");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Sensitive env variants are in .gitignore
  // ═══════════════════════════════════════════════════════════════════════

  it(".gitignore should exist and not be empty", () => {
    expect(gitignoreContent).toBeTruthy();
    expect(gitignoreContent.length).toBeGreaterThan(0);
  });

  it(".gitignore should list .env.local", () => {
    const lines = gitignoreContent.split("\n").map((l) => l.trim());
    expect(lines.some((line) => line === ".env.local")).toBe(true);
  });

  it(".gitignore should list .env.*.local pattern", () => {
    const lines = gitignoreContent.split("\n").map((l) => l.trim());
    expect(lines.some((line) => line === ".env.*.local")).toBe(true);
  });

  it(".gitignore should cover .env.production", () => {
    expect(gitignoreContent.includes(".env.production")).toBe(true);
  });

  it(".gitignore should cover .env.staging", () => {
    expect(gitignoreContent.includes(".env.staging")).toBe(true);
  });

  it(".gitignore should cover supabase/.env", () => {
    expect(gitignoreContent).toContain("supabase/.env");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Other sensitive patterns
  // ═══════════════════════════════════════════════════════════════════════

  it(".gitignore should ignore node_modules/", () => {
    expect(gitignoreContent).toContain("node_modules");
  });

  it(".gitignore should ignore build output (dist/)", () => {
    expect(gitignoreContent).toContain("dist");
  });

  it(".gitignore should ignore *.local files", () => {
    const lines = gitignoreContent.split("\n").map((l) => l.trim());
    expect(lines.some((line) => line === "*.local")).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Summary
  // ═══════════════════════════════════════════════════════════════════════

  it("should provide a comprehensive security assessment", () => {
    const envLines = envContent
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    // All env vars should be VITE_ prefixed (public)
    const allPublic = envLines.every((l) => l.split("=")[0].startsWith("VITE_"));
    expect(allPublic).toBe(true);

    // No secrets present
    const noSecrets =
      !envContent.toUpperCase().includes("SERVICE_ROLE") &&
      !envContent.toUpperCase().includes("EMPLOYEE_DATA_KEY") &&
      !envContent.toUpperCase().includes("BOOTSTRAP_SECRET");
    expect(noSecrets).toBe(true);

    // Sensitive variants protected
    const protectedVariants = [".env.local", ".env.staging", ".env.production"];
    for (const v of protectedVariants) {
      expect(gitignoreContent).toContain(v);
    }
  });
});

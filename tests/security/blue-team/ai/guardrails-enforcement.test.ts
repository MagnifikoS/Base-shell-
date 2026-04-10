/**
 * VAI-03: Guardrails Enforcement Defense
 *
 * Verifies that core safety checks run regardless of the guardrails toggle.
 * The system has two layers:
 * 1. Server-side sanitization (visionSanitize.ts) -- ALWAYS runs, not toggleable
 * 2. Client-side guardrails (visionAiGuardrails.ts) -- toggleable via feature flag
 *
 * This test ensures the non-bypassable layer is properly separated from
 * the optional guardrails layer.
 *
 * SSOT:
 * - supabase/functions/_shared/visionSanitize.ts (mandatory sanitization)
 * - src/modules/visionAI/plugins/visionAiGuardrails.ts (optional guardrails)
 * - src/modules/visionAI/plugins/visionBlGuardrails.ts (optional BL guardrails)
 * - src/modules/visionAI/plugins/visionReleveGuardrails.ts (optional releve guardrails)
 * - src/config/featureFlags.ts (toggle definition)
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("VAI-03: Guardrails Enforcement", () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. SERVER-SIDE SANITIZATION IS NOT TOGGLEABLE
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Server-side sanitization is mandatory (not toggleable)", () => {
    it("should NOT import VISION_AI_GUARDRAILS_ENABLED in visionSanitize.ts", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const featureFlagImport = findInSource(source, /VISION_AI_GUARDRAILS_ENABLED/);
      // The server-side sanitization module should NEVER reference the toggle
      expect(featureFlagImport.length).toBe(0);
    });

    it("should NOT have any conditional bypass in sanitizeInvoice", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      // Extract the sanitizeInvoice function body
      const fnStart = source.indexOf("export function sanitizeInvoice");
      const fnEnd = source.indexOf("\n}", fnStart) + 2;
      const fnBody = source.substring(fnStart, fnEnd);

      // No feature flag check inside
      const bypass = findInSource(fnBody, /GUARDRAILS_ENABLED|featureFlag/i);
      expect(bypass.length).toBe(0);
    });

    it("should NOT have any conditional bypass in sanitizeExtractedItems", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const fnStart = source.indexOf("export function sanitizeExtractedItems");
      // Find the closing of the function (next export or end)
      const nextExport = source.indexOf("\nexport ", fnStart + 1);
      const fnBody = source.substring(fnStart, nextExport > 0 ? nextExport : source.length);

      const bypass = findInSource(fnBody, /GUARDRAILS_ENABLED|featureFlag/i);
      expect(bypass.length).toBe(0);
    });

    it("should NOT reference any feature flag in the sanitization module", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const flagRefs = findInSource(source, /featureFlags|ENABLED/i);
      expect(flagRefs.length).toBe(0);
    });

    it("should NOT have any import from featureFlags in server-side code", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const flagImport = findInSource(source, /import.*featureFlags/);
      expect(flagImport.length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. EDGE FUNCTION ALWAYS INVOKES SANITIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Edge function unconditionally invokes sanitization", () => {
    it("should call sanitizeInvoice for every facture extraction (no condition)", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      // The call should NOT be inside an if(GUARDRAILS_ENABLED) block
      const sanitizeCall = findInSource(source, /sanitizeInvoice\(parsed\.invoice\)/);
      expect(sanitizeCall.length).toBeGreaterThan(0);

      // No guardrail check surrounds the sanitization
      const guardrailCheck = findInSource(source, /GUARDRAILS_ENABLED[\s\S]{0,200}sanitizeInvoice/);
      expect(guardrailCheck.length).toBe(0);
    });

    it("should call sanitizeExtractedItems for every facture extraction (no condition)", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const sanitizeCall = findInSource(source, /sanitizeExtractedItems\(parsed\.items\)/);
      expect(sanitizeCall.length).toBeGreaterThan(0);

      const guardrailCheck = findInSource(
        source,
        /GUARDRAILS_ENABLED[\s\S]{0,200}sanitizeExtractedItems/
      );
      expect(guardrailCheck.length).toBe(0);
    });

    it("should call sanitizeBLHeader for every BL extraction (no condition)", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const sanitizeCall = findInSource(source, /sanitizeBLHeader\(parsed\.bl\)/);
      expect(sanitizeCall.length).toBeGreaterThan(0);
    });

    it("should call sanitizeReleveHeader for every releve extraction (no condition)", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const sanitizeCall = findInSource(source, /sanitizeReleveHeader\(parsed\.releve\)/);
      expect(sanitizeCall.length).toBeGreaterThan(0);
    });

    it("should NOT import VISION_AI_GUARDRAILS_ENABLED in the edge function", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const flagImport = findInSource(source, /VISION_AI_GUARDRAILS_ENABLED/);
      expect(flagImport.length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. CLIENT-SIDE GUARDRAILS ARE CORRECTLY TOGGLEABLE
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Client-side guardrails are properly toggleable", () => {
    it("should define VISION_AI_GUARDRAILS_ENABLED in featureFlags.ts", async () => {
      const source = await readSourceFile("src/config/featureFlags.ts");
      const flag = findInSource(
        source,
        /export\s+const\s+VISION_AI_GUARDRAILS_ENABLED\s*=\s*(true|false)/
      );
      expect(flag.length).toBe(1);
    });

    it("should default guardrails to ENABLED (true)", async () => {
      const source = await readSourceFile("src/config/featureFlags.ts");
      const flagTrue = findInSource(source, /VISION_AI_GUARDRAILS_ENABLED\s*=\s*true/);
      expect(flagTrue.length).toBe(1);
    });

    it("should have passthrough behavior when guardrails are disabled (facture)", async () => {
      const source = await readSourceFile("src/modules/visionAI/plugins/visionAiGuardrails.ts");
      // The applyGuardrails function should have an early return when disabled
      const passthrough = findInSource(
        source,
        /if\s*\(!VISION_AI_GUARDRAILS_ENABLED\)\s*\{[\s\S]*?return\s+items/
      );
      expect(passthrough.length).toBe(1);
    });

    it("should have passthrough behavior when guardrails are disabled (BL)", async () => {
      const source = await readSourceFile("src/modules/visionAI/plugins/visionBlGuardrails.ts");
      const passthrough = findInSource(source, /if\s*\(!VISION_AI_GUARDRAILS_ENABLED\)/);
      expect(passthrough.length).toBe(1);
    });

    it("should have passthrough behavior when guardrails are disabled (releve)", async () => {
      const source = await readSourceFile("src/modules/visionAI/plugins/visionReleveGuardrails.ts");
      const passthrough = findInSource(source, /if\s*\(!VISION_AI_GUARDRAILS_ENABLED\)/);
      expect(passthrough.length).toBe(1);
    });

    it("should import toggle from centralized featureFlags.ts (not hardcoded)", async () => {
      const source = await readSourceFile("src/modules/visionAI/plugins/visionAiGuardrails.ts");
      const centralImport = findInSource(
        source,
        /import\s*\{.*VISION_AI_GUARDRAILS_ENABLED.*\}\s*from\s*["']@\/config\/featureFlags["']/
      );
      expect(centralImport.length).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. GUARDRAILS DO NOT MODIFY/DROP DATA
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Client guardrails add flags without modifying data", () => {
    it("should use spread operator to preserve original line data", async () => {
      const source = await readSourceFile("src/modules/visionAI/plugins/visionAiGuardrails.ts");
      const spread = findInSource(source, /\.\.\.\s*item/);
      expect(spread.length).toBeGreaterThan(0);
    });

    it("should only add _riskFlags and _quantitySuspect (prefixed with underscore)", async () => {
      const source = await readSourceFile("src/modules/visionAI/plugins/visionAiGuardrails.ts");
      // Check that the added properties use underscore prefix (session-only convention)
      const riskFlags = findInSource(source, /_riskFlags/);
      const quantitySuspect = findInSource(source, /_quantitySuspect/);
      expect(riskFlags.length).toBeGreaterThan(0);
      expect(quantitySuspect.length).toBeGreaterThan(0);
    });

    it("should document that risk flags are session-only (never persisted)", async () => {
      const source = await readSourceFile("src/modules/visionAI/plugins/visionAiGuardrails.ts");
      const sessionOnly = findInSource(source, /session-only.*never\s+persisted/i);
      expect(sessionOnly.length).toBeGreaterThan(0);
    });

    it("should not filter/remove any items in applyGuardrails (only add flags)", async () => {
      const source = await readSourceFile("src/modules/visionAI/plugins/visionAiGuardrails.ts");
      // The function pushes ALL items to result[] (no filtering)
      // The only .filter() in the function is for counting flagged lines in DEV log
      // Verify: result.push(guardrailedLine) is called for every item
      const pushAll = findInSource(source, /result\.push\(guardrailedLine\)/);
      expect(pushAll.length).toBe(1);

      // Verify: the function returns result (not a filtered subset)
      const returnResult = findInSource(source, /return\s+result;/);
      expect(returnResult.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. SECURITY CHECKS ARE ALWAYS ON (AUTH, RBAC, RATE LIMIT)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Security checks are always on regardless of guardrails", () => {
    it("should enforce auth check (requireAuth) before any extraction", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const authCheck = findInSource(source, /requireAuth\(req\)/);
      expect(authCheck.length).toBeGreaterThan(0);
    });

    it("should enforce RBAC check (has_module_access) before extraction", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      // has_module_access and vision_ai are on separate lines in the RPC call
      const rbacCall = findInSource(source, /rpc\("has_module_access"/);
      expect(rbacCall.length).toBeGreaterThan(0);

      const visionAiModule = findInSource(source, /_module_key:\s*["']vision_ai["']/);
      expect(visionAiModule.length).toBeGreaterThan(0);
    });

    it("should enforce rate limiting before extraction", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const rateLimit = findInSource(source, /checkRateLimitSync\(req/);
      expect(rateLimit.length).toBeGreaterThan(0);
    });

    it("should require establishment_id parameter", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const estRequired = findInSource(source, /establishment_id\s+est\s+requis/);
      expect(estRequired.length).toBeGreaterThan(0);
    });

    it("should return 403 when RBAC check fails", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const forbidden = findInSource(source, /hasAccess\s*===\s*false[\s\S]*?status:\s*403/);
      expect(forbidden.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. GUARDRAILS LAYER SEPARATION SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Layer separation is clean", () => {
    it("should have clear separation: server sanitization (Deno) vs client guardrails (Vite)", async () => {
      // Server-side sanitization lives in supabase/functions (Deno runtime)
      const serverSource = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      // Client-side guardrails live in src/modules (Vite/React)
      const clientSource = await readSourceFile(
        "src/modules/visionAI/plugins/visionAiGuardrails.ts"
      );

      // Server does NOT reference import.meta.env (Vite-only)
      const viteRef = findInSource(serverSource, /import\.meta\.env/);
      expect(viteRef.length).toBe(0);

      // Client imports from @/config (Vite alias), server does not
      const viteAlias = findInSource(clientSource, /@\/config/);
      expect(viteAlias.length).toBeGreaterThan(0);
    });

    it("should have separate guardrails for each document type", async () => {
      // Facture guardrails
      const facture = await readSourceFile("src/modules/visionAI/plugins/visionAiGuardrails.ts");
      const factureExport = findInSource(facture, /export\s+function\s+applyGuardrails/);
      expect(factureExport.length).toBe(1);

      // BL guardrails
      const bl = await readSourceFile("src/modules/visionAI/plugins/visionBlGuardrails.ts");
      const blExport = findInSource(bl, /export\s+function\s+applyBLGuardrails/);
      expect(blExport.length).toBe(1);

      // Releve guardrails
      const releve = await readSourceFile("src/modules/visionAI/plugins/visionReleveGuardrails.ts");
      const releveExport = findInSource(releve, /export\s+function\s+applyReleveGuardrails/);
      expect(releveExport.length).toBe(1);
    });

    it("should have existing unit tests for client-side guardrails", async () => {
      const testFile = await readSourceFile(
        "src/modules/visionAI/__tests__/visionAiGuardrails.test.ts"
      );
      // The test file should exist and have meaningful content
      expect(testFile.length).toBeGreaterThan(500);
      // Should test the toggle behavior
      const toggleTest = findInSource(testFile, /VISION_AI_GUARDRAILS_ENABLED.*false/);
      expect(toggleTest.length).toBeGreaterThan(0);
    });
  });
});

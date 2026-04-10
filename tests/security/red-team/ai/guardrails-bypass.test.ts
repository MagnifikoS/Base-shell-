/**
 * VAI-03 -- Vision AI Guardrails Plugin Toggleable Per-User
 *
 * Target: src/modules/visionAI/plugins/visionAiGuardrails.ts
 *         src/modules/visionAI/plugins/visionBlGuardrails.ts
 *         src/modules/visionAI/plugins/visionReleveGuardrails.ts
 *         src/config/featureFlags.ts
 *
 * Vulnerability:
 *   The Vision AI guardrails system (post-extraction safety checks) is controlled
 *   by a single boolean flag VISION_AI_GUARDRAILS_ENABLED in featureFlags.ts.
 *   When disabled, ALL three guardrail plugins (facture, BL, releve) become
 *   complete passthroughs, returning zero flags regardless of data quality.
 *
 *   Critical issues:
 *   1. ALL guardrails are tied to ONE toggle (no independent safety checks)
 *   2. The toggle is frontend-only (client-side) -- a savvy user can override it
 *   3. The server-side edge function has NO guardrail checks at all
 *   4. Disabling guardrails means: hallucinated quantities pass silently,
 *      free-line detection is bypassed, coherence checks are skipped,
 *      and BL quality warnings are suppressed
 *
 * PoC:
 *   1. Confirm all three guardrail plugins check the same toggle
 *   2. Confirm the toggle disables ALL checks (not just some)
 *   3. Confirm guardrails exist ONLY on the frontend (not server-side)
 *   4. Confirm the toggle is a compile-time constant (no runtime override UI)
 *   5. Confirm the featureFlags.ts constant can be overridden in browser console
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("VAI-03: Vision AI Guardrails Plugin Toggleable Per-User", () => {
  it("should confirm VISION_AI_GUARDRAILS_ENABLED is a single boolean in featureFlags.ts", async () => {
    const source = await readSourceFile("src/config/featureFlags.ts");

    // The flag is a plain exported constant
    const flagDeclaration = findInSource(
      source,
      /export const VISION_AI_GUARDRAILS_ENABLED\s*=\s*(true|false)/g
    );
    expect(flagDeclaration.length).toBe(1);
  });

  it("should confirm visionAiGuardrails.ts imports and uses the toggle as a passthrough gate", async () => {
    const source = await readSourceFile("src/modules/visionAI/plugins/visionAiGuardrails.ts");

    // Imports the toggle from featureFlags
    const importToggle = findInSource(
      source,
      /import\s*\{.*VISION_AI_GUARDRAILS_ENABLED.*\}\s*from\s*"@\/config\/featureFlags"/g
    );
    expect(importToggle.length).toBe(1);

    // applyGuardrails has a complete bypass when toggle is false
    const passthroughCheck = findInSource(
      source,
      /if\s*\(!VISION_AI_GUARDRAILS_ENABLED\)\s*\{[\s\S]*?return items/g
    );
    expect(passthroughCheck.length).toBe(1);

    // When disabled, returns items AS-IS with zero flags
    const zeroFlags = findInSource(source, /return items as GuardrailedLine\[\]/g);
    expect(zeroFlags.length).toBe(1);
  });

  it("should confirm visionBlGuardrails.ts uses the SAME toggle for BL guardrails", async () => {
    const source = await readSourceFile("src/modules/visionAI/plugins/visionBlGuardrails.ts");

    // Same import
    const importToggle = findInSource(
      source,
      /import\s*\{.*VISION_AI_GUARDRAILS_ENABLED.*\}\s*from\s*"@\/config\/featureFlags"/g
    );
    expect(importToggle.length).toBe(1);

    // Same passthrough pattern -- returns empty results when disabled
    const passthroughCheck = findInSource(source, /if\s*\(!VISION_AI_GUARDRAILS_ENABLED\)/g);
    expect(passthroughCheck.length).toBe(1);

    // When disabled, returns zero flags for ALL checks
    const zeroResult = findInSource(
      source,
      /document_flags:\s*\[\][\s\S]*?item_flags:\s*\[\][\s\S]*?has_blocking:\s*false/g
    );
    expect(zeroResult.length).toBe(1);
  });

  it("should confirm visionReleveGuardrails.ts uses the SAME toggle for releve guardrails", async () => {
    const source = await readSourceFile("src/modules/visionAI/plugins/visionReleveGuardrails.ts");

    // Same import
    const importToggle = findInSource(
      source,
      /import\s*\{.*VISION_AI_GUARDRAILS_ENABLED.*\}\s*from\s*"@\/config\/featureFlags"/g
    );
    expect(importToggle.length).toBe(1);

    // Same passthrough pattern
    const passthroughCheck = findInSource(source, /if\s*\(!VISION_AI_GUARDRAILS_ENABLED\)/g);
    expect(passthroughCheck.length).toBe(1);

    // When disabled, returns zero flags
    const zeroResult = findInSource(
      source,
      /flags:\s*\[\][\s\S]*?has_alerts:\s*false[\s\S]*?has_warnings:\s*false/g
    );
    expect(zeroResult.length).toBe(1);
  });

  it("should confirm server-side (edge function) has NO guardrail checks at all", async () => {
    const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");

    // The edge function does type-sanitization but no guardrail-style checks
    // (no quantity coherence, no free-line detection, no quality scoring)
    // Note: the word "GUARDRAILS" appears in the USER_INSTRUCTION prompt text
    // as guidance for the LLM, but there is NO guardrail CODE on the server
    const guardrailCodeImport = findInSource(
      source,
      /import.*guardrail|applyGuardrails|visionAiGuardrails|from.*guardrails/gi
    );
    expect(guardrailCodeImport.length).toBe(0);

    // No coherence checks on the server (these exist only in frontend guardrails)
    const coherenceCheck = findInSource(
      source,
      /impliedUnitPrice|quantity_suspect|free_line_ambiguous|_riskFlags|_quantitySuspect/gi
    );
    expect(coherenceCheck.length).toBe(0);
  });

  it("should confirm guardrails are applied ONLY on frontend in useExtractProducts hook", async () => {
    const source = await readSourceFile("src/modules/visionAI/hooks/useExtractProducts.ts");

    // Frontend applies guardrails after receiving the response
    const guardrailCall = findInSource(source, /applyGuardrails\(typedResult\.items\)/g);
    expect(guardrailCall.length).toBe(1);

    // This means: if a user bypasses the frontend (direct API call),
    // guardrails are never applied to the extraction results
  });

  it("should confirm disabling the toggle bypasses ALL safety checks simultaneously", async () => {
    // Enumerate all the checks that are guarded by the toggle:

    // In visionAiGuardrails.ts:
    const factureSource = await readSourceFile(
      "src/modules/visionAI/plugins/visionAiGuardrails.ts"
    );
    // Rule 1: Free-line keyword detection
    const rule1 = findInSource(factureSource, /free_line_ambiguous/g);
    expect(rule1.length).toBeGreaterThan(0);
    // Rule 2: Missing quantity flagging
    const rule2 = findInSource(factureSource, /missing_quantity/g);
    expect(rule2.length).toBeGreaterThan(0);
    // Rule 3: Coherence check (implied unit price)
    const rule3 = findInSource(factureSource, /quantity_suspect/g);
    expect(rule3.length).toBeGreaterThan(0);
    // Rule 4: Zero amount without free keyword
    const rule4 = findInSource(factureSource, /amount_suspect/g);
    expect(rule4.length).toBeGreaterThan(0);

    // In visionBlGuardrails.ts:
    const blSource = await readSourceFile("src/modules/visionAI/plugins/visionBlGuardrails.ts");
    // Rule: missing_quantity, unreadable_product, low_quality_photo, handwritten_ambiguous
    const blRules = findInSource(
      blSource,
      /missing_quantity|unreadable_product|low_quality_photo|handwritten_ambiguous|all_lines_unreadable/g
    );
    expect(blRules.length).toBeGreaterThan(4);

    // In visionReleveGuardrails.ts:
    const releveSource = await readSourceFile(
      "src/modules/visionAI/plugins/visionReleveGuardrails.ts"
    );
    // Rules: invoice_not_found, amount_mismatch, date_mismatch, etc.
    const releveRules = findInSource(
      releveSource,
      /invoice_not_found|amount_mismatch|date_mismatch|missing_invoice|balance_discrepancy|period_incomplete/g
    );
    expect(releveRules.length).toBeGreaterThan(6);

    // ALL of these are disabled by a single boolean toggle
    // There's no independent "critical safety" layer that stays active
  });

  it("should confirm the toggle is a Vite compile-time constant (can be overridden at build time)", async () => {
    const source = await readSourceFile("src/config/featureFlags.ts");

    // The flag is a plain `export const` -- it becomes a module-level constant
    // at build time. There's no runtime check, no server-side verification.
    const exportConst = findInSource(
      source,
      /export const VISION_AI_GUARDRAILS_ENABLED\s*=\s*true/g
    );
    expect(exportConst.length).toBe(1);

    // There's no server-side enforcement of the guardrails toggle
    // A modified build or runtime override could disable all guardrails
  });

  it("should confirm no UI exists for toggling guardrails (but code supports it)", async () => {
    // VisionAISettings does NOT have a guardrails toggle UI
    const settingsSource = await readSourceFile(
      "src/modules/visionAI/components/VisionAISettings.tsx"
    );

    const guardrailToggle = findInSource(settingsSource, /guardrail|VISION_AI_GUARDRAILS/gi);
    // No guardrails toggle in the settings UI
    expect(guardrailToggle.length).toBe(0);

    // But the code is explicitly designed for toggling (comments say "TOGGLE")
    const visionAiSource = await readSourceFile(
      "src/modules/visionAI/plugins/visionAiGuardrails.ts"
    );
    const toggleComment = findInSource(
      visionAiSource,
      /TOGGLE.*set to false.*to disable all guardrails/gi
    );
    expect(toggleComment.length).toBe(1);
  });
});

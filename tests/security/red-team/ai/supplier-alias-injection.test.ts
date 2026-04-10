/**
 * ALIAS-01 -- Supplier Alias Injection via Auto-Confirmed Matches
 *
 * Target: supabase/migrations/20260216200000_sync_prod_to_staging.sql
 *         src/integrations/supabase/types.ts (auto-generated schema)
 *         src/modules/fournisseurs/utils/normalizeSupplierName.ts
 *         memory/features/factures/supplier-alias-learning-fix.md
 *
 * Vulnerability:
 *   The supplier_name_aliases table stores AI-detected supplier names
 *   and automatically links them to known suppliers. Key issues:
 *
 *   1. The alias_raw field is TEXT NOT NULL with NO length constraint,
 *      NO format validation, and NO sanitization at the database level.
 *      An AI hallucination or prompt-injected PDF can create aliases
 *      with any content (HTML, script tags, SQL-like text, etc.)
 *
 *   2. Auto-confirmed aliases (source: 'auto_confirmed') are created
 *      with a default confidence of 0.8 -- high enough to influence
 *      future matching WITHOUT any human review.
 *
 *   3. The alias_norm normalization only does case/accent folding --
 *      it does NOT remove special characters beyond punctuation.
 *      An alias like "<script>alert(1)</script>" normalizes to
 *      "SCRIPT ALERT 1 SCRIPT" which is still stored and matched.
 *
 *   4. RLS policies are establishment-scoped but do NOT restrict
 *      WRITE operations to admin roles -- any authenticated user
 *      with establishment access can insert aliases.
 *
 *   5. There is no rate limit or threshold on alias creation --
 *      a malicious actor could flood the alias table with noise.
 *
 * PoC:
 *   1. Confirm alias_raw has no length/format constraint in DDL
 *   2. Confirm auto_confirmed is the default source with 0.8 confidence
 *   3. Confirm normalization does not sanitize adversarial content
 *   4. Confirm RLS allows any establishment member to insert
 *   5. Confirm no confidence threshold prevents auto-matching
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("ALIAS-01: Supplier Alias Injection via Auto-Confirmed Matches", () => {
  let migrationSource: string;

  it("should read the supplier_name_aliases migration", async () => {
    migrationSource = await readSourceFile(
      "supabase/migrations/20260216200000_sync_prod_to_staging.sql"
    );
    expect(migrationSource).toContain("supplier_name_aliases");
  });

  it("should confirm alias_raw is TEXT with NO length constraint", async () => {
    const source = await readSourceFile(
      "supabase/migrations/20260216200000_sync_prod_to_staging.sql"
    );

    // alias_raw is defined as `text NOT NULL` -- no varchar(N) limit
    const aliasRawDef = findInSource(source, /alias_raw\s+text\s+NOT NULL/gi);
    expect(aliasRawDef.length).toBe(1);

    // No CHECK constraint on alias_raw length or format
    const checkConstraint = findInSource(source, /CHECK\s*\(.*alias_raw/gi);
    expect(checkConstraint.length).toBe(0);

    // No varchar(N) limit
    const varcharLimit = findInSource(source, /alias_raw\s+varchar/gi);
    expect(varcharLimit.length).toBe(0);
  });

  it("should confirm alias_norm is TEXT with NO sanitization constraint", async () => {
    const source = await readSourceFile(
      "supabase/migrations/20260216200000_sync_prod_to_staging.sql"
    );

    // alias_norm is also plain text NOT NULL
    const aliasNormDef = findInSource(source, /alias_norm\s+text\s+NOT NULL/gi);
    expect(aliasNormDef.length).toBe(1);

    // No CHECK constraint on alias_norm
    const checkConstraint = findInSource(source, /CHECK\s*\(.*alias_norm/gi);
    expect(checkConstraint.length).toBe(0);
  });

  it("should confirm auto_confirmed is the DEFAULT source with 0.8 confidence", async () => {
    const source = await readSourceFile(
      "supabase/migrations/20260216200000_sync_prod_to_staging.sql"
    );

    // source column defaults to 'auto_confirmed'
    const sourceDefault = findInSource(
      source,
      /source\s+text\s+NOT NULL\s+DEFAULT\s+'auto_confirmed'/gi
    );
    expect(sourceDefault.length).toBe(1);

    // confidence defaults to 0.8 (high enough to auto-match)
    const confidenceDefault = findInSource(
      source,
      /confidence\s+numeric\s+NOT NULL\s+DEFAULT\s+0\.8/gi
    );
    expect(confidenceDefault.length).toBe(1);

    // This means: any auto-created alias starts at 80% confidence
    // without any human validation required
  });

  it("should confirm no confidence threshold prevents auto-confirmed aliases from influencing matches", async () => {
    const source = await readSourceFile(
      "supabase/migrations/20260216200000_sync_prod_to_staging.sql"
    );

    // No CHECK constraint requiring confidence > some threshold
    const confidenceCheck = findInSource(source, /CHECK\s*\(.*confidence/gi);
    expect(confidenceCheck.length).toBe(0);

    // No trigger or policy that rejects low-confidence auto-confirmed aliases
    const triggerCheck = findInSource(source, /CREATE\s+TRIGGER.*alias/gi);
    expect(triggerCheck.length).toBe(0);
  });

  it("should confirm RLS allows ANY establishment member to INSERT aliases (no admin check)", async () => {
    const source = await readSourceFile(
      "supabase/migrations/20260216200000_sync_prod_to_staging.sql"
    );

    // The insert policy only checks establishment membership, not role
    const insertPolicy = source.match(/CREATE POLICY "supplier_name_aliases_insert"[\s\S]*?;/);
    expect(insertPolicy).toBeTruthy();

    if (insertPolicy) {
      const policyText = insertPolicy[0];

      // Policy checks user_establishments membership
      const membershipCheck = findInSource(policyText, /user_establishments/g);
      expect(membershipCheck.length).toBeGreaterThan(0);

      // No admin role check in the insert policy
      const adminCheck = findInSource(
        policyText,
        /is_admin|has_module_access|admin|role.*write|permission/gi
      );
      expect(adminCheck.length).toBe(0);
    }
  });

  it("should confirm UPDATE policy also has no admin restriction", async () => {
    const source = await readSourceFile(
      "supabase/migrations/20260216200000_sync_prod_to_staging.sql"
    );

    const updatePolicy = source.match(/CREATE POLICY "supplier_name_aliases_update"[\s\S]*?;/);
    expect(updatePolicy).toBeTruthy();

    if (updatePolicy) {
      const policyText = updatePolicy[0];

      // No admin/role check
      const adminCheck = findInSource(policyText, /is_admin|has_module_access|role.*write/gi);
      expect(adminCheck.length).toBe(0);
    }
  });

  it("should confirm normalizeSupplierName does NOT sanitize HTML/XSS content", async () => {
    const source = await readSourceFile("src/modules/fournisseurs/utils/normalizeSupplierName.ts");

    // baseNormalize does: trim, uppercase, accent removal, punctuation->space, collapse spaces
    // It does NOT: strip HTML tags, encode entities, or reject special characters
    const baseNormalize = source.match(/function baseNormalize[\s\S]*?^}/m);
    expect(baseNormalize).toBeTruthy();

    if (baseNormalize) {
      // The regex [^A-Z0-9]+ replaces non-alphanumeric with spaces
      // This means '<script>' becomes 'SCRIPT' and 'alert(1)' becomes 'ALERT 1'
      // The content is normalized but NOT rejected or flagged
      const replacePattern = findInSource(
        baseNormalize[0],
        /replace\(\/\[\^A-Z0-9\]\+\/g,\s*" "\)/g
      );
      expect(replacePattern.length).toBe(1);

      // No explicit HTML/XSS rejection
      const xssCheck = findInSource(baseNormalize[0], /script|html|xss|inject|malicious/gi);
      expect(xssCheck.length).toBe(0);
    }
  });

  it("should confirm the alias learning system always creates aliases (even for exact matches)", async () => {
    const source = await readSourceFile("memory/features/factures/supplier-alias-learning-fix.md");

    // The fix removed the condition that prevented alias creation on exact matches
    const alwaysCreate = findInSource(
      source,
      /Always create alias|Removed the condition.*detectedNorm !== officialNorm/gi
    );
    expect(alwaysCreate.length).toBeGreaterThan(0);

    // This means every AI detection creates an alias, even if the name matches exactly
    // This amplifies the attack surface: any prompt-injected name becomes an alias
  });

  it("should confirm no rate limit on alias creation in the database", async () => {
    const source = await readSourceFile(
      "supabase/migrations/20260216200000_sync_prod_to_staging.sql"
    );

    // No rate limit trigger, no daily/hourly count limit
    const rateLimitTrigger = findInSource(source, /rate_limit|max_aliases|daily_limit|throttle/gi);
    expect(rateLimitTrigger.length).toBe(0);

    // No function or trigger that limits alias creation frequency
    const triggerOnInsert = findInSource(
      source,
      /CREATE\s+(OR\s+REPLACE\s+)?TRIGGER.*supplier_name_aliases.*BEFORE\s+INSERT/gi
    );
    expect(triggerOnInsert.length).toBe(0);
  });

  it("should confirm auto-generated types show alias_raw accepts any string", async () => {
    const source = await readSourceFile("src/integrations/supabase/types.ts");

    // Find the supplier_name_aliases Insert type
    const insertSection = source.match(/supplier_name_aliases:[\s\S]*?Insert:\s*\{([\s\S]*?)\}/);
    expect(insertSection).toBeTruthy();

    if (insertSection) {
      // alias_raw is typed as string (or optional string for Insert)
      // No additional validation type (branded types, etc.)
      const aliasRawType = findInSource(insertSection[1], /alias_raw[?]?:\s*string/g);
      expect(aliasRawType.length).toBe(1);
    }
  });
});

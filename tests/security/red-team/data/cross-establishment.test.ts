/**
 * RED-DATA :: Cross-Establishment Data Leak Potential
 *
 * Target: RLS policies in supabase/migrations/*.sql
 *
 * Vulnerability: Some RLS policies on critical tables use only
 * `user_id = auth.uid()` or `organization_id` checks without filtering
 * by `establishment_id`. In a multi-establishment organization, this
 * means a user assigned to Establishment A can potentially see data
 * from Establishment B if they share the same organization or user_id.
 *
 * Key concern: badge_events SELECT policy "Users can view own badge events"
 * uses only `user_id = auth.uid()` — no establishment_id filtering.
 * This means a user working at two establishments sees ALL their events
 * across all establishments, which is expected for self-access. However,
 * the admin policy uses org-level filtering, not establishment-level.
 *
 * The employee_details admin policy also uses organization_id scoping
 * rather than establishment_id, allowing admin access across all
 * establishments in the org.
 *
 * This test PASSES when cross-establishment access patterns are found.
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, globSourceFiles } from "../../helpers";

describe("Cross-Establishment Data Leak via RLS Policies", () => {
  /**
   * Helper: Collect all CREATE POLICY statements and their bodies from migrations.
   * Returns an array of { policyName, tableName, fullText } objects.
   */
  async function collectPolicies(): Promise<
    Array<{ policyName: string; tableName: string; fullText: string; fileName: string }>
  > {
    const migrationFiles = await globSourceFiles("supabase/migrations/*.sql");
    const policies: Array<{
      policyName: string;
      tableName: string;
      fullText: string;
      fileName: string;
    }> = [];

    for (const file of migrationFiles) {
      const content = await readSourceFile(file);

      // Match CREATE POLICY blocks (may span multiple lines until semicolon)
      const policyRegex = /CREATE POLICY\s+"([^"]+)"\s*\n?\s*ON\s+(?:public\.)?(\w+)([\s\S]*?);/g;
      let match;
      while ((match = policyRegex.exec(content)) !== null) {
        policies.push({
          policyName: match[1],
          tableName: match[2],
          fullText: match[0],
          fileName: file,
        });
      }
    }

    return policies;
  }

  it("should find badge_events user SELECT policy uses only user_id (no establishment_id filter)", async () => {
    const policies = await collectPolicies();

    const badgeEventsPolicies = policies.filter(
      (p) => p.tableName === "badge_events" && /SELECT/i.test(p.fullText)
    );
    expect(badgeEventsPolicies.length).toBeGreaterThan(0);

    // Find the user-facing (non-admin) policy
    const userPolicy = badgeEventsPolicies.find(
      (p) => /user_id\s*=\s*auth\.uid\(\)/i.test(p.fullText) && !/is_admin/i.test(p.fullText)
    );
    expect(userPolicy).toBeDefined();

    // Vulnerability: the user policy does NOT check establishment_id
    const checksEstablishment = /establishment_id/i.test(userPolicy!.fullText);
    expect(checksEstablishment).toBe(false);
  });

  it("should find badge_events admin policy scoped to organization, not establishment", async () => {
    const policies = await collectPolicies();

    const adminBadgePolicy = policies.find(
      (p) => p.tableName === "badge_events" && /is_admin/i.test(p.fullText)
    );
    expect(adminBadgePolicy).toBeDefined();

    // Admin policy uses organization_id (org-wide), NOT establishment_id
    const usesOrgId = /organization_id/i.test(adminBadgePolicy!.fullText);
    expect(usesOrgId).toBe(true);

    const usesEstablishmentId = /establishment_id\s*(?:=|IN)/i.test(adminBadgePolicy!.fullText);
    // Vulnerability: no establishment_id filter on admin policy
    expect(usesEstablishmentId).toBe(false);
  });

  it("should find employee_details admin policies scoped to organization, not establishment", async () => {
    const policies = await collectPolicies();

    const adminDetailsPolicies = policies.filter(
      (p) => p.tableName === "employee_details" && /is_admin/i.test(p.fullText)
    );
    expect(adminDetailsPolicies.length).toBeGreaterThan(0);

    // All admin policies should use organization_id, not establishment_id
    for (const policy of adminDetailsPolicies) {
      const usesOrgId = /organization_id/i.test(policy.fullText);
      expect(usesOrgId).toBe(true);

      // Vulnerability: no establishment_id filtering
      const usesEstablishmentFilter =
        /establishment_id\s*(?:=|IN)\s*(?:\(|get_user_establishment)/i.test(policy.fullText);
      expect(usesEstablishmentFilter).toBe(false);
    }
  });

  it("should find employee_details table has no establishment_id column at all", async () => {
    const migrationFiles = await globSourceFiles("supabase/migrations/*.sql");

    let createTableSql = "";
    for (const file of migrationFiles) {
      const content = await readSourceFile(file);
      const match = content.match(/CREATE TABLE public\.employee_details\s*\(([\s\S]*?)\);/);
      if (match) {
        createTableSql = match[0];
        break;
      }
    }

    expect(createTableSql).not.toBe("");

    // employee_details uses organization_id but NOT establishment_id as a column
    const hasOrgId = /organization_id/i.test(createTableSql);
    expect(hasOrgId).toBe(true);

    // Vulnerability: no establishment_id column means cross-establishment
    // data isolation is impossible at the DB level for this table
    const hasEstablishmentId = /establishment_id/i.test(createTableSql);
    expect(hasEstablishmentId).toBe(false);
  });

  it("should document critical tables and their RLS scope (org vs establishment)", async () => {
    const policies = await collectPolicies();

    // Critical tables that contain sensitive or establishment-specific data
    const criticalTables = [
      "badge_events",
      "employee_details",
      "planning_shifts",
      "personnel_leaves",
      "payroll_employee_month_validation",
      "payroll_employee_month_carry",
      "payroll_employee_extra_counter",
    ];

    const tableScoping: Record<string, { hasEstablishmentFilter: boolean; hasOrgFilter: boolean }> =
      {};

    for (const table of criticalTables) {
      const tablePolicies = policies.filter((p) => p.tableName === table);
      const allText = tablePolicies.map((p) => p.fullText).join("\n");

      tableScoping[table] = {
        hasEstablishmentFilter: /establishment_id\s*(?:=|IN)\s*(?:\(|get_user_establishment)/i.test(
          allText
        ),
        hasOrgFilter: /organization_id/i.test(allText),
      };
    }

    // At least some tables should rely on org_id instead of establishment_id in their admin policies
    const tablesWithOnlyOrgScope = Object.entries(tableScoping).filter(
      ([, scope]) => scope.hasOrgFilter && !scope.hasEstablishmentFilter
    );

    // Vulnerability: multiple critical tables use only org-level scoping
    expect(tablesWithOnlyOrgScope.length).toBeGreaterThan(0);
  });
});

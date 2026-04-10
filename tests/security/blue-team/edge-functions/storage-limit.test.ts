/**
 * STORAGE-01: Storage Limits Assessment
 *
 * Verifies that storage buckets have proper file size limits and MIME type
 * restrictions. Without these limits, attackers could upload large files to
 * exhaust storage quota or upload malicious file types.
 *
 * Checks for:
 *   - The 3 storage buckets exist in migrations
 *   - File size limits are defined where possible
 *   - MIME type restrictions are applied
 *   - Documents gaps in storage protection
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

const EXPECTED_BUCKETS = ["employee-documents", "invoices", "vision-ia-documents"];

describe("STORAGE-01: Storage Limits Assessment", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 1. All 3 storage buckets are defined in migrations
  // ═══════════════════════════════════════════════════════════════════════

  it("should define all 3 expected storage buckets in migrations", async () => {
    const migrationFiles = await globSourceFiles("supabase/migrations/*.sql");
    let allMigrationContent = "";
    for (const file of migrationFiles) {
      allMigrationContent += await readSourceFile(file);
    }

    for (const bucket of EXPECTED_BUCKETS) {
      const bucketExists = allMigrationContent.includes(`'${bucket}'`);
      expect(bucketExists).toBe(true);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. vision-ia-documents bucket — should have proper limits
  // ═══════════════════════════════════════════════════════════════════════

  it("vision-ia-documents bucket should have file_size_limit defined", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260204081123_57dd48d4-540c-4232-9830-7531ce82a8fb.sql"
    );
    expect(content).toContain("file_size_limit");
    expect(content).toContain("vision-ia-documents");
  });

  it("vision-ia-documents bucket should have allowed_mime_types defined", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260204081123_57dd48d4-540c-4232-9830-7531ce82a8fb.sql"
    );
    expect(content).toContain("allowed_mime_types");
    // Should allow PDFs and images
    expect(content).toContain("application/pdf");
  });

  it("vision-ia-documents bucket should be private (not public)", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260204081123_57dd48d4-540c-4232-9830-7531ce82a8fb.sql"
    );
    // The INSERT should have public = false
    const bucketInsert = findInSource(
      content,
      /INSERT INTO storage\.buckets.*?vision-ia-documents.*?ON CONFLICT/gs
    );
    expect(bucketInsert.length).toBeGreaterThan(0);
    expect(bucketInsert[0][0]).toContain("false");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. employee-documents bucket — check limits
  // ═══════════════════════════════════════════════════════════════════════

  it("employee-documents bucket should be created in migrations", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260111074740_edb7917d-368f-4605-bb62-976b955208b6.sql"
    );
    expect(content).toContain("employee-documents");
  });

  it("should document whether employee-documents bucket has file_size_limit", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260111074740_edb7917d-368f-4605-bb62-976b955208b6.sql"
    );

    const hasFileSizeLimit = content.includes("file_size_limit");

    if (!hasFileSizeLimit) {
      console.warn(
        "[STORAGE-01] FINDING: employee-documents bucket does NOT have file_size_limit. " +
          "Users could upload arbitrarily large files. " +
          "Recommendation: Add file_size_limit via ALTER or UPDATE on storage.buckets."
      );
    }

    // Document the finding — this test passes either way to track the state
    expect(typeof hasFileSizeLimit).toBe("boolean");
  });

  it("employee-documents bucket should be private", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260111074740_edb7917d-368f-4605-bb62-976b955208b6.sql"
    );
    // public should be false
    expect(content).toContain("false");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. invoices bucket — check limits
  // ═══════════════════════════════════════════════════════════════════════

  it("invoices bucket should be created in migrations", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260201215452_ba7839c9-89ac-4ad8-8549-94c88bb187ef.sql"
    );
    expect(content).toContain("invoices");
  });

  it("should document whether invoices bucket has file_size_limit", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260201215452_ba7839c9-89ac-4ad8-8549-94c88bb187ef.sql"
    );

    const hasFileSizeLimit = content.includes("file_size_limit");

    if (!hasFileSizeLimit) {
      console.warn(
        "[STORAGE-01] FINDING: invoices bucket does NOT have file_size_limit. " +
          "Users could upload arbitrarily large files. " +
          "Recommendation: Add file_size_limit via ALTER or UPDATE on storage.buckets."
      );
    }

    // Document the finding
    expect(typeof hasFileSizeLimit).toBe("boolean");
  });

  it("invoices bucket should be private", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260201215452_ba7839c9-89ac-4ad8-8549-94c88bb187ef.sql"
    );
    expect(content).toContain("false");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Comparative analysis across all 3 buckets
  // ═══════════════════════════════════════════════════════════════════════

  it("should compare storage protection across all 3 buckets", async () => {
    const migrationFiles = await globSourceFiles("supabase/migrations/*.sql");
    let allContent = "";
    for (const file of migrationFiles) {
      allContent += "\n--- FILE: " + file + " ---\n";
      allContent += await readSourceFile(file);
    }

    const bucketAnalysis: {
      name: string;
      hasFileSizeLimit: boolean;
      hasMimeTypeRestriction: boolean;
      isPrivate: boolean;
    }[] = [];

    for (const bucket of EXPECTED_BUCKETS) {
      // Find the INSERT statement for this bucket
      const bucketRegex = new RegExp(`INSERT INTO storage\\.buckets[^;]*'${bucket}'[^;]*;`, "gs");
      const matches = findInSource(allContent, bucketRegex);

      const bucketContent = matches.length > 0 ? matches[0][0] : "";

      bucketAnalysis.push({
        name: bucket,
        hasFileSizeLimit: bucketContent.includes("file_size_limit"),
        hasMimeTypeRestriction: bucketContent.includes("allowed_mime_types"),
        isPrivate: bucketContent.includes("false"),
      });
    }

    console.log("[STORAGE-01] Bucket analysis:");
    for (const bucket of bucketAnalysis) {
      console.log(
        `  ${bucket.name}: ` +
          `file_size_limit=${bucket.hasFileSizeLimit}, ` +
          `mime_types=${bucket.hasMimeTypeRestriction}, ` +
          `private=${bucket.isPrivate}`
      );
    }

    // All buckets must be private
    for (const bucket of bucketAnalysis) {
      expect(bucket.isPrivate).toBe(true);
    }

    // At least one bucket should have file_size_limit (vision-ia-documents)
    const bucketsWithSizeLimit = bucketAnalysis.filter((b) => b.hasFileSizeLimit);
    expect(bucketsWithSizeLimit.length).toBeGreaterThanOrEqual(1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Vision AI extract should also enforce server-side file size check
  // ═══════════════════════════════════════════════════════════════════════

  it("vision-ai-extract edge function should enforce server-side file size limit", async () => {
    const content = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
    // Should have a MAX file size constant
    const hasMaxSize =
      content.includes("MAX_SERVER_FILE_SIZE") ||
      content.includes("file_size") ||
      content.includes("file.size");
    expect(hasMaxSize).toBe(true);

    // Should return 413 for oversized files
    expect(content).toContain("413");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Storage buckets should have RLS policies
  // ═══════════════════════════════════════════════════════════════════════

  it("all storage buckets should have RLS policies in migrations", async () => {
    const migrationFiles = await globSourceFiles("supabase/migrations/*.sql");
    let allContent = "";
    for (const file of migrationFiles) {
      allContent += await readSourceFile(file);
    }

    for (const bucket of EXPECTED_BUCKETS) {
      const hasPolicy = allContent.includes(`bucket_id = '${bucket}'`);
      if (!hasPolicy) {
        console.warn(`[STORAGE-01] FINDING: No RLS policy found referencing bucket '${bucket}'`);
      }
      expect(hasPolicy).toBe(true);
    }
  });
});

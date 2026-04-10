/**
 * RED-DATA :: STORAGE-01 — Storage Bucket File Size Limits
 *
 * Target: Supabase migrations for storage buckets
 *
 * Original vulnerability: The `invoices` and `employee-documents` buckets
 * were created without a `file_size_limit`, allowing arbitrarily large uploads.
 *
 * REMEDIATION STATUS: FIXED. A migration now sets file_size_limit on all 3 buckets:
 * - employee-documents: 10 MB
 * - invoices: 10 MB
 * - vision-ia-documents: 6 MB
 *
 * These tests serve as REGRESSION GUARDS — they PASS to confirm the fix holds.
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, globSourceFiles } from "../../helpers";

/**
 * Helper to extract the full INSERT INTO storage.buckets statement block
 * that creates a specific bucket.
 */
async function findBucketInsertBlock(
  bucketName: string
): Promise<{ sql: string; fileName: string } | null> {
  const migrationFiles = await globSourceFiles("supabase/migrations/*.sql");

  for (const file of migrationFiles) {
    const content = await readSourceFile(file);
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (/INSERT INTO storage\.buckets/i.test(lines[i])) {
        let block = "";
        for (let j = i; j < lines.length; j++) {
          block += lines[j] + "\n";
          if (lines[j].includes(";")) break;
        }

        if (block.includes(`'${bucketName}'`)) {
          return { sql: block, fileName: file };
        }
      }
    }
  }

  return null;
}

describe("STORAGE-01: Storage Bucket File Size Limits (REMEDIATED)", () => {
  it("should find the invoices bucket creation in migrations", async () => {
    const result = await findBucketInsertBlock("invoices");
    expect(result).not.toBeNull();
    expect(result!.sql).toContain("'invoices'");
  });

  it("should confirm original invoices bucket INSERT has no file_size_limit (known gap)", async () => {
    const result = await findBucketInsertBlock("invoices");
    expect(result).not.toBeNull();

    // The original INSERT still lacks file_size_limit (this is expected)
    const hasFileSizeLimit = /file_size_limit/i.test(result!.sql);
    expect(hasFileSizeLimit).toBe(false);
  });

  it("should confirm invoices bucket has NO allowed_mime_types in original INSERT", async () => {
    const result = await findBucketInsertBlock("invoices");
    expect(result).not.toBeNull();

    const hasMimeTypes = /allowed_mime_types/i.test(result!.sql);
    expect(hasMimeTypes).toBe(false);
  });

  it("should confirm vision-ia-documents bucket DOES have file_size_limit (for comparison)", async () => {
    const result = await findBucketInsertBlock("vision-ia-documents");
    expect(result).not.toBeNull();

    const hasFileSizeLimit = /file_size_limit/i.test(result!.sql);
    expect(hasFileSizeLimit).toBe(true);

    const hasMimeTypes = /allowed_mime_types/i.test(result!.sql);
    expect(hasMimeTypes).toBe(true);
  });

  it("should confirm a later migration ADDS file_size_limit to all buckets (REMEDIATED)", async () => {
    const migrationFiles = await globSourceFiles("supabase/migrations/*.sql");

    let limitsAdded = false;
    for (const file of migrationFiles) {
      const content = await readSourceFile(file);
      if (/UPDATE\s+storage\.buckets/i.test(content) && /file_size_limit/i.test(content)) {
        // Verify all 3 buckets are covered
        const hasInvoices = /invoices/i.test(content);
        const hasEmployeeDocs = /employee-documents/i.test(content);
        const hasVisionDocs = /vision-ia-documents/i.test(content);

        if (hasInvoices && hasEmployeeDocs && hasVisionDocs) {
          limitsAdded = true;
          break;
        }
      }
    }

    // Fix is in place: migration adds file_size_limit to all buckets
    expect(limitsAdded).toBe(true);
  });

  it("should show the invoices bucket only has (id, name, public) columns in original INSERT", async () => {
    const result = await findBucketInsertBlock("invoices");
    expect(result).not.toBeNull();

    const columnList = result!.sql.match(/\(([^)]+)\)/);
    expect(columnList).not.toBeNull();

    const columns = columnList![1].toLowerCase();
    expect(columns).toContain("id");
    expect(columns).toContain("name");
    expect(columns).toContain("public");
    expect(columns).not.toContain("file_size_limit");
    expect(columns).not.toContain("allowed_mime_types");
  });
});

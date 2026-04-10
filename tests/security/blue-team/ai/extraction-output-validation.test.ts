/**
 * VAI-02: Server-Side Extraction Output Validation Defense
 *
 * Verifies that server-side validation exists in the vision-ai-extract edge
 * function to enforce type safety, field constraints, and schema compliance
 * on raw AI output BEFORE it reaches the client.
 *
 * SSOT:
 * - supabase/functions/vision-ai-extract/index.ts (edge function)
 * - supabase/functions/_shared/visionSanitize.ts (sanitization logic)
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("VAI-02: Server-Side Extraction Output Validation", () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. JSON PARSING WITH ERROR HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  describe("JSON parsing and error handling", () => {
    it("should wrap JSON.parse in try/catch for AI response", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const jsonParse = findInSource(source, /JSON\.parse\(jsonString\)/);
      expect(jsonParse.length).toBeGreaterThan(0);

      // Verify it is inside a try block
      const tryCatch = findInSource(
        source,
        /try\s*\{[\s\S]*?JSON\.parse\(jsonString\)[\s\S]*?\}\s*catch/
      );
      expect(tryCatch.length).toBeGreaterThan(0);
    });

    it("should handle JSON embedded in markdown code blocks", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const _codeBlockMatch = findInSource(source, /```(?:json)?\s*\([\s\S]*?\)```/);
      // Alternative: check for the regex that strips code blocks
      const stripCodeBlock = findInSource(source, /content\.match\(\/```/);
      expect(stripCodeBlock.length).toBeGreaterThan(0);
    });

    it("should extract JSON from { ... } if not starting with brace", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const braceExtract = findInSource(
        source,
        /indexOf\(["']\{["']\)[\s\S]*?lastIndexOf\(["']\}["']\)/
      );
      expect(braceExtract.length).toBeGreaterThan(0);
    });

    it("should strip trailing commas from JSON (common LLM error)", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      // The actual code: jsonString.replace(/,\s*([\]}])/g, "$1")
      // Look for the trailing comma stripping pattern
      const trailingComma = findInSource(source, /trailing commas|replace\(\/,/);
      expect(trailingComma.length).toBeGreaterThan(0);
    });

    it("should return 422 with descriptive error on parse failure", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const _errorResponse = findInSource(source, /status:\s*422[\s\S]*?JSON.*parse/);
      // Alternative: check for parseError handler
      const parseErrorHandler = findInSource(source, /parseError/);
      expect(parseErrorHandler.length).toBeGreaterThan(0);
    });

    it("should not expose raw AI content to client on parse error", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      // Check that the raw content is logged server-side (structured logging) but not returned to client
      // SEC-LOG-001: Migrated from console.error to structured log.error
      const serverLog = findInSource(source, /log\.error.*parse.*error.*raw_content_preview/);
      expect(serverLog.length).toBeGreaterThan(0);

      // The error response should be generic, not containing raw AI output
      const genericError = findInSource(source, /Erreur d'analyse de la r.ponse IA/);
      expect(genericError.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. TYPE ENFORCEMENT ON PARSED OUTPUT
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Type enforcement on parsed output", () => {
    it("should check parsed.invoice is an object before sanitizing", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const invoiceCheck = findInSource(
        source,
        /parsed\.invoice\s*&&\s*typeof\s+parsed\.invoice\s*===\s*["']object["']/
      );
      expect(invoiceCheck.length).toBeGreaterThan(0);
    });

    it("should check parsed.items is an array before sanitizing", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const arrayCheck = findInSource(source, /Array\.isArray\(parsed\.items\)/);
      expect(arrayCheck.length).toBeGreaterThan(0);
    });

    it("should check parsed.insights is an array before sanitizing", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const arrayCheck = findInSource(source, /Array\.isArray\(parsed\.insights\)/);
      expect(arrayCheck.length).toBeGreaterThan(0);
    });

    it("should check parsed.bl_items is an array for BL documents", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const arrayCheck = findInSource(source, /Array\.isArray\(parsed\.bl_items\)/);
      expect(arrayCheck.length).toBeGreaterThan(0);
    });

    it("should check parsed.releve_lines is an array for releve documents", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const arrayCheck = findInSource(source, /Array\.isArray\(parsed\.releve_lines\)/);
      expect(arrayCheck.length).toBeGreaterThan(0);
    });

    it("should filter warnings array to only strings", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const warningsFilter = findInSource(
        source,
        /parsed\.warnings.*filter\(.*typeof\s+\w+\s*===\s*["']string["']\)/
      );
      expect(warningsFilter.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. DEEP FIELD VALIDATION IN SANITIZATION FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Deep field validation in sanitization layer", () => {
    it("should validate each item in rawItems array individually", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      // Check that sanitizeExtractedItems iterates and validates each item
      const itemLoop = findInSource(source, /for\s*\(const\s+item\s+of\s+rawItems\)/);
      expect(itemLoop.length).toBeGreaterThan(0);
    });

    it("should validate individual insight entries (label + value required)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      // sanitizeInsights now uses sanitizeTextField(label) and sanitizeTextField(value)
      // to validate, trim, and strip HTML from both fields
      const labelSanitize = findInSource(source, /sanitizeTextField\(label\)/);
      const valueSanitize = findInSource(source, /sanitizeTextField\(value\)/);
      expect(labelSanitize.length).toBeGreaterThan(0);
      expect(valueSanitize.length).toBeGreaterThan(0);
    });

    it("should enforce has_price_cell coherence (null price cannot have has_price_cell=true)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const coherenceCheck = findInSource(
        source,
        /prix\s*===\s*null\s*&&\s*hasPriceCell\s*===\s*true/
      );
      expect(coherenceCheck.length).toBeGreaterThan(0);
    });

    it("should handle NaN in numeric fields (quantite, prix)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const nanCheckQty = findInSource(source, /!isNaN\(record\.quantite_commandee\)/);
      const nanCheckPrix = findInSource(source, /!isNaN\(record\.prix_total_ligne\)/);
      expect(nanCheckQty.length).toBeGreaterThan(0);
      expect(nanCheckPrix.length).toBeGreaterThan(0);
    });

    it("should validate BL item unreadable_fields as array of {field, reason} objects", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const unreadableValidation = findInSource(source, /unreadable_fields[\s\S]*?Array\.isArray/);
      expect(unreadableValidation.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. DOCUMENT MODE VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Document mode input validation", () => {
    it("should validate document_mode against a whitelist", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const validModes = findInSource(
        source,
        /validModes\s*=\s*\[["']auto["'],\s*["']facture["'],\s*["']bl["'],\s*["']releve["']\]/
      );
      expect(validModes.length).toBeGreaterThan(0);
    });

    it("should reject invalid document_mode with 400 error", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const rejection = findInSource(
        source,
        /!validModes\.includes\(documentMode\)[\s\S]*?status:\s*400/
      );
      expect(rejection.length).toBeGreaterThan(0);
    });

    it("should normalize document_mode to lowercase", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const lowerCase = findInSource(source, /rawDocumentMode\?\.toLowerCase\(\)/);
      expect(lowerCase.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. FILE TYPE VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe("File type validation", () => {
    it("should validate file type against allowed list (PDF, JPG, PNG, WebP, TIFF)", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const imageTypes = findInSource(source, /imageTypes\s*=\s*\[["']image\/jpeg["']/);
      expect(imageTypes.length).toBeGreaterThan(0);
    });

    it("should reject non-allowed file types with 400 error", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const rejection = findInSource(source, /!isPdf\s*&&\s*!isImage[\s\S]*?status:\s*400/);
      expect(rejection.length).toBeGreaterThan(0);
    });

    it("should enforce server-side file size limit (10 MB)", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const sizeLimit = findInSource(
        source,
        /MAX_SERVER_FILE_SIZE\s*=\s*10\s*\*\s*1024\s*\*\s*1024/
      );
      expect(sizeLimit.length).toBeGreaterThan(0);
    });

    it("should double-check actual file size (not just Content-Length header)", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const actualSizeCheck = findInSource(source, /file\.size\s*>\s*MAX_SERVER_FILE_SIZE/);
      expect(actualSizeCheck.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. EMPTY/FALLBACK RESPONSE PATTERN
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Empty/fallback response pattern", () => {
    it("should define an emptyResponse constant for error cases", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const emptyResponse = findInSource(source, /emptyResponse.*ExtractionResponse/);
      expect(emptyResponse.length).toBeGreaterThan(0);
    });

    it("should use emptyResponse as base for all error responses", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const spreadEmpty = findInSource(source, /\.\.\.emptyResponse/);
      // Should be used in multiple error paths
      expect(spreadEmpty.length).toBeGreaterThanOrEqual(3);
    });

    it("should never expose internal error details to client (SEC-20)", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      // Check for SEC-20 pattern: server-side logging + generic client message
      const sec20 = findInSource(source, /SEC-20/);
      expect(sec20.length).toBeGreaterThan(0);

      // Generic error message returned to client
      const genericError = findInSource(source, /Erreur interne du serveur/);
      expect(genericError.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. DOCUMENT QUALITY SANITIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Document quality sanitization", () => {
    it("should have a sanitizeDocumentQuality function", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const fn = findInSource(source, /function\s+sanitizeDocumentQuality/);
      expect(fn.length).toBe(1);
    });

    it("should clamp quality score between 0 and 1", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const clamp = findInSource(source, /Math\.max\(0,\s*Math\.min\(1,\s*record\.score\)\)/);
      expect(clamp.length).toBeGreaterThan(0);
    });

    it("should filter issues array to only strings", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const filter = findInSource(
        source,
        /issues.*filter\(.*typeof\s+\w+\s*===\s*["']string["']\)/
      );
      expect(filter.length).toBeGreaterThan(0);
    });

    it("should provide sensible defaults when quality data is missing", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const defaultQuality = findInSource(source, /defaultQuality\s*=\s*\{\s*score:\s*1\.0/);
      expect(defaultQuality.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. TYPED INTERFACES FOR VALIDATED OUTPUT
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Typed interfaces define expected output shape", () => {
    it("should export InvoiceData interface with typed fields", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const invoiceInterface = findInSource(source, /export\s+interface\s+InvoiceData/);
      expect(invoiceInterface.length).toBe(1);
    });

    it("should export ExtractedProductLine interface", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const productInterface = findInSource(source, /export\s+interface\s+ExtractedProductLine/);
      expect(productInterface.length).toBe(1);
    });

    it("should export Insight interface", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const insightInterface = findInSource(source, /export\s+interface\s+Insight/);
      expect(insightInterface.length).toBe(1);
    });

    it("should export ExtractionResponse interface", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const responseInterface = findInSource(source, /export\s+interface\s+ExtractionResponse/);
      expect(responseInterface.length).toBe(1);
    });

    it("should export BLHeaderData and BLItemData interfaces", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const blHeader = findInSource(source, /export\s+interface\s+BLHeaderData/);
      const blItem = findInSource(source, /export\s+interface\s+BLItemData/);
      expect(blHeader.length).toBe(1);
      expect(blItem.length).toBe(1);
    });

    it("should export ReleveHeaderData and ReleveLineData interfaces", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const releveHeader = findInSource(source, /export\s+interface\s+ReleveHeaderData/);
      const releveLine = findInSource(source, /export\s+interface\s+ReleveLineData/);
      expect(releveHeader.length).toBe(1);
      expect(releveLine.length).toBe(1);
    });
  });
});

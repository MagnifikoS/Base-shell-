/**
 * VAI-01: Vision AI Sanitization Pipeline Defense
 *
 * Verifies that a comprehensive sanitization pipeline exists for Vision AI
 * extraction output. Tests that server-side sanitization functions properly
 * strip/validate all AI-generated fields before they reach the client.
 *
 * SSOT: supabase/functions/_shared/visionSanitize.ts
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

// ═══════════════════════════════════════════════════════════════════════════
// 1. SANITIZATION MODULE EXISTS AND IS THE SSOT
// ═══════════════════════════════════════════════════════════════════════════

describe("VAI-01: Vision AI Sanitization Pipeline", () => {
  describe("Centralized sanitization module existence", () => {
    it("should have visionSanitize.ts as the SSOT for extraction sanitization", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      expect(source).toBeTruthy();
      expect(source.length).toBeGreaterThan(100);
    });

    it("should export sanitizeInvoice function", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const exports = findInSource(source, /export\s+function\s+sanitizeInvoice/);
      expect(exports.length).toBe(1);
    });

    it("should export sanitizeExtractedItems function", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const exports = findInSource(source, /export\s+function\s+sanitizeExtractedItems/);
      expect(exports.length).toBe(1);
    });

    it("should export sanitizeInsights function", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const exports = findInSource(source, /export\s+function\s+sanitizeInsights/);
      expect(exports.length).toBe(1);
    });

    it("should export sanitizeBLHeader and sanitizeBLItems for BL documents", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const blHeader = findInSource(source, /export\s+function\s+sanitizeBLHeader/);
      const blItems = findInSource(source, /export\s+function\s+sanitizeBLItems/);
      expect(blHeader.length).toBe(1);
      expect(blItems.length).toBe(1);
    });

    it("should export sanitizeReleveHeader and sanitizeReleveLines for releve documents", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const releveHeader = findInSource(source, /export\s+function\s+sanitizeReleveHeader/);
      const releveLines = findInSource(source, /export\s+function\s+sanitizeReleveLines/);
      expect(releveHeader.length).toBe(1);
      expect(releveLines.length).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. INVOICE FIELD SANITIZATION (supplier_name, invoice_number, etc.)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Invoice header field sanitization", () => {
    it("should sanitize supplier_name via sanitizeTextField", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const sanitizeCall = findInSource(
        source,
        /supplier_name:\s*sanitizeTextField\(record\.supplier_name\)/
      );
      expect(sanitizeCall.length).toBeGreaterThan(0);
    });

    it("should sanitize invoice_number via sanitizeTextField", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const sanitizeCall = findInSource(
        source,
        /invoice_number:\s*sanitizeTextField\(record\.invoice_number\)/
      );
      expect(sanitizeCall.length).toBeGreaterThan(0);
    });

    it("should sanitize invoice_date via sanitizeTextField", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const sanitizeCall = findInSource(
        source,
        /invoice_date:\s*sanitizeTextField\(record\.invoice_date\)/
      );
      expect(sanitizeCall.length).toBeGreaterThan(0);
    });

    it("should enforce invoice_total as a number (not string)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const typeCheck = findInSource(
        source,
        /typeof\s+record\.invoice_total\s*===\s*["']number["']/
      );
      expect(typeCheck.length).toBeGreaterThan(0);
    });

    it("should reject NaN values for invoice_total", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const nanCheck = findInSource(source, /!isNaN\(record\.invoice_total\)/);
      expect(nanCheck.length).toBeGreaterThan(0);
    });

    it("should return null defaults for all invoice fields when input is invalid", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      // Check that a defaultInvoice with all nulls exists
      const defaultInvoice = findInSource(
        source,
        /supplier_name:\s*null,\s*\n\s*invoice_number:\s*null,\s*\n\s*invoice_date:\s*null,\s*\n\s*invoice_total:\s*null/
      );
      expect(defaultInvoice.length).toBeGreaterThan(0);
    });

    it("should handle non-object input gracefully (return defaults)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      // sanitizeInvoice should check typeof raw !== "object"
      const objCheck = findInSource(
        source,
        /typeof\s+raw\s*!==\s*["']object["']\s*\|\|\s*raw\s*===\s*null/
      );
      expect(objCheck.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. PRODUCT LINE SANITIZATION (nom_produit_complet, quantite, prix, etc.)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Product line field sanitization", () => {
    it("should require nom_produit_complet as a non-empty string", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      // rawNom = record.nom_produit_complet; checked with typeof rawNom !== "string"
      const nameCheck = findInSource(
        source,
        /typeof\s+rawNom\s*!==\s*["']string["']\s*\|\|\s*rawNom\.trim\(\)\s*===\s*["']["']/
      );
      expect(nameCheck.length).toBeGreaterThan(0);
    });

    it("should skip items with missing product names", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      // The code checks: if (typeof rawNom !== "string" || rawNom.trim() === "")
      // Then logs and continues (skipping the item)
      const nameCheck = findInSource(source, /typeof\s+rawNom\s*!==\s*["']string["']/);
      expect(nameCheck.length).toBeGreaterThan(0);

      // After the check, there should be a continue statement to skip the item
      const continueStmt = findInSource(source, /nom_produit_complet\s+manquant/);
      expect(continueStmt.length).toBeGreaterThan(0);
    });

    it("should enforce quantite_commandee as number (reject strings)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const qtyCheck = findInSource(
        source,
        /typeof\s+record\.quantite_commandee\s*===\s*["']number["']/
      );
      expect(qtyCheck.length).toBeGreaterThan(0);
    });

    it("should enforce prix_total_ligne as number (reject strings)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const priceCheck = findInSource(
        source,
        /typeof\s+record\.prix_total_ligne\s*===\s*["']number["']/
      );
      expect(priceCheck.length).toBeGreaterThan(0);
    });

    it("should strip HTML tags from product names via stripHtmlTags", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      // nomProduit = stripHtmlTags(rawNom) — strips tags and trims
      const stripCall = findInSource(source, /stripHtmlTags\(rawNom\)/);
      expect(stripCall.length).toBeGreaterThan(0);
    });

    it("should sanitize code_produit via sanitizeTextField", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const sanitizeCall = findInSource(source, /sanitizeTextField\(record\.code_produit\)/);
      expect(sanitizeCall.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. UNIT VALIDATION (contenu_facture anti-hallucination)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Unit field anti-hallucination filter", () => {
    it("should have an INVALID_UNITS blocklist for generic unit abbreviations", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const invalidUnits = findInSource(source, /INVALID_UNITS/);
      expect(invalidUnits.length).toBeGreaterThan(0);
    });

    it("should block 'u', 'un', 'unite', 'ea', 'st', 'pce' as invalid units", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      // Check that each invalid unit is present in the blocklist
      for (const unit of ["u", "un", "uni", "unite", "ea", "st", "pce"]) {
        const found = findInSource(source, new RegExp(`["']${unit}["']`));
        expect(found.length).toBeGreaterThan(
          0,
          `Expected invalid unit "${unit}" to be in INVALID_UNITS blocklist`
        );
      }
    });

    it("should normalize contenu_facture to lowercase", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const lowerCase = findInSource(source, /contenu_facture.*\.toLowerCase\(\)/);
      expect(lowerCase.length).toBeGreaterThan(0);
    });

    it("should set contenu_facture to null when unit is in INVALID_UNITS", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const nullify = findInSource(source, /INVALID_UNITS\.has\(rawUnit\)\s*\?\s*null/);
      expect(nullify.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. ANTI-POLLUTION FILTER (fee/service line removal)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Anti-pollution filter (fee/service detection)", () => {
    it("should have an isFeeNotProduct function as safety net", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const feeFilter = findInSource(source, /function\s+isFeeNotProduct/);
      expect(feeFilter.length).toBe(1);
    });

    it("should detect common fee patterns (frais de livraison, port, transport, etc.)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const patterns = [
        "frais.*livraison",
        "frais.*port",
        "frais.*transport",
        "frais.*structure",
        "frais.*service",
        "eco.*contribution",
        "participation.*publicitaire",
      ];
      for (const pattern of patterns) {
        const found = findInSource(source, new RegExp(pattern, "i"));
        expect(found.length).toBeGreaterThan(0, `Expected fee pattern "${pattern}" to be detected`);
      }
    });

    it("should filter out items with null prix_total_ligne (anti-pollution)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const nullPriceFilter = findInSource(source, /item\.prix_total_ligne\s*===\s*null/);
      expect(nullPriceFilter.length).toBeGreaterThan(0);
    });

    it("should filter out fee lines detected by isFeeNotProduct", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const feeFilterUsage = findInSource(source, /isFeeNotProduct\(item\.nom_produit_complet/);
      expect(feeFilterUsage.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. CATEGORY SUGGESTION SANITIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Category suggestion sanitization", () => {
    it("should export sanitizeCategorySuggestion function", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const fn = findInSource(source, /export\s+function\s+sanitizeCategorySuggestion/);
      expect(fn.length).toBe(1);
    });

    it("should validate category labels against a whitelist (VALID_CATEGORIES)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const whitelist = findInSource(source, /VALID_CATEGORIES/);
      expect(whitelist.length).toBeGreaterThan(0);
    });

    it("should include standard restaurant categories in the whitelist", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const requiredCategories = ["Viande", "Poisson", "Boissons", "Autre"];
      for (const cat of requiredCategories) {
        const found = findInSource(source, new RegExp(`["']${cat}["']`));
        expect(found.length).toBeGreaterThan(0, `Expected category "${cat}" in VALID_CATEGORIES`);
      }
    });

    it("should default unknown categories to 'Autre'", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const defaultAutre = findInSource(source, /\|\|\s*["']Autre["']/);
      expect(defaultAutre.length).toBeGreaterThan(0);
    });

    it("should clamp confidence between 0 and 1", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const clamp = findInSource(source, /Math\.max\(0,\s*Math\.min\(1,\s*confidence\)\)/);
      expect(clamp.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. HTML/SCRIPT TAG SANITIZATION GAP ASSESSMENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe("HTML/script injection defense assessment", () => {
    it("should have explicit HTML tag stripping via stripHtmlTags", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      // Verify the stripHtmlTags function is defined and exported
      const stripFn = findInSource(source, /export\s+function\s+stripHtmlTags/);
      expect(stripFn.length).toBe(1);

      // Verify it removes HTML/XML tags via regex
      const htmlRegex = findInSource(source, /replace\(.*<\[.*\].*>/);
      expect(htmlRegex.length).toBeGreaterThan(0);

      // Verify sanitizeTextField uses stripHtmlTags for all string fields
      const sanitizeTextFieldUsesStrip = findInSource(source, /stripHtmlTags\(val\)/);
      expect(sanitizeTextFieldUsesStrip.length).toBeGreaterThan(0);

      // Type enforcement still exists as defense-in-depth
      const hasTypeEnforcement =
        findInSource(source, /typeof\s+record\.\w+\s*===\s*["']number["']/).length > 0;
      expect(hasTypeEnforcement).toBe(true);
    });

    it("should verify React auto-escaping protects against XSS in rendered AI output", async () => {
      // React's JSX auto-escapes string content, preventing XSS from AI output.
      // Verify no dangerouslySetInnerHTML is used with AI extraction data.
      const extractedProductsModal = await readSourceFile(
        "src/modules/visionAI/components/ExtractedProductsModal.tsx"
      );
      const dangerousHtml = findInSource(extractedProductsModal, /dangerouslySetInnerHTML/);
      // No dangerouslySetInnerHTML should be used in the extraction display component
      expect(dangerousHtml.length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. BL + RELEVE SANITIZATION COMPLETENESS
  // ═══════════════════════════════════════════════════════════════════════════

  describe("BL and Releve sanitization completeness", () => {
    it("should sanitize BL header fields with sanitizeString helper", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const sanitizeStringFn = findInSource(source, /function\s+sanitizeString\(val:\s*unknown\)/);
      expect(sanitizeStringFn.length).toBe(1);
    });

    it("should sanitize BL numeric fields with sanitizeNumber helper", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const sanitizeNumberFn = findInSource(source, /function\s+sanitizeNumber\(val:\s*unknown\)/);
      expect(sanitizeNumberFn.length).toBe(1);
    });

    it("should clamp confidence values between 0 and 1 for BL items", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const clampFn = findInSource(source, /function\s+clampConfidence\(val:\s*unknown\)/);
      expect(clampFn.length).toBe(1);
    });

    it("should normalize dates to ISO format in releve header", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const normalizeDate = findInSource(source, /function\s+normalizeDateToISO/);
      expect(normalizeDate.length).toBe(1);
    });

    it("should handle date format DD/MM/YYYY conversion to YYYY-MM-DD", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      // Check that the normalizeDateToISO function handles DD/MM/YYYY format
      const dateRegex = findInSource(source, /normalizeDateToISO/);
      expect(dateRegex.length).toBeGreaterThan(0);

      // Check for DD/MM/YYYY regex pattern (the actual pattern in the code)
      const ddmmPattern = findInSource(source, /trimmed\.match/);
      expect(ddmmPattern.length).toBeGreaterThan(0);
    });

    it("should fix AI month/day swap errors in dates", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      // Check for month > 12 swap logic
      const swapLogic = findInSource(source, /month.*>\s*12.*day.*<=\s*12/);
      expect(swapLogic.length).toBeGreaterThan(0);
    });

    it("should validate releve line_type against a whitelist", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const validTypes = findInSource(
        source,
        /validLineTypes.*=.*\["invoice".*"credit_note".*"payment".*"other"\]/
      );
      expect(validTypes.length).toBeGreaterThan(0);
    });

    it("should filter out summary/total rows from releve lines", async () => {
      const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
      const summaryFilter = findInSource(source, /isSummaryRow/);
      expect(summaryFilter.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. INTEGRATION: Edge function imports sanitization
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Edge function imports sanitization module", () => {
    it("should import all sanitization functions in vision-ai-extract", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const importMatch = findInSource(
        source,
        /import\s*\{[^}]*sanitizeInvoice[^}]*\}\s*from\s*["']\.\.\/_shared\/visionSanitize/
      );
      expect(importMatch.length).toBeGreaterThan(0);
    });

    it("should call sanitizeInvoice on AI response in edge function", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const call = findInSource(source, /sanitizeInvoice\(parsed\.invoice\)/);
      expect(call.length).toBeGreaterThan(0);
    });

    it("should call sanitizeExtractedItems on AI response in edge function", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const call = findInSource(source, /sanitizeExtractedItems\(parsed\.items\)/);
      expect(call.length).toBeGreaterThan(0);
    });

    it("should call sanitizeInsights on AI response in edge function", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const call = findInSource(source, /sanitizeInsights\(.*parsed\.insights/);
      expect(call.length).toBeGreaterThan(0);
    });

    it("should call sanitizeBLHeader for BL documents in edge function", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const call = findInSource(source, /sanitizeBLHeader\(parsed\.bl\)/);
      expect(call.length).toBeGreaterThan(0);
    });

    it("should call sanitizeBLItems for BL documents in edge function", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const call = findInSource(source, /sanitizeBLItems\(/);
      expect(call.length).toBeGreaterThan(0);
    });

    it("should call sanitizeReleveHeader for releve documents in edge function", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const call = findInSource(source, /sanitizeReleveHeader\(parsed\.releve\)/);
      expect(call.length).toBeGreaterThan(0);
    });

    it("should call sanitizeReleveLines for releve documents in edge function", async () => {
      const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
      const call = findInSource(source, /sanitizeReleveLines\(/);
      expect(call.length).toBeGreaterThan(0);
    });
  });
});

/**
 * VAI-02 -- Server-Side Sanitization of AI Extraction Output [REMEDIATED]
 *
 * Target: supabase/functions/_shared/visionSanitize.ts
 *         supabase/functions/vision-ai-extract/index.ts
 *         src/modules/visionAI/components/extracted/ProductRow.tsx
 *
 * Original Vulnerability:
 *   The server-side sanitization (visionSanitize.ts) previously performed only
 *   TYPE validation (ensuring fields are strings/numbers/nulls) but did NOT
 *   sanitize the actual STRING CONTENT for XSS payloads or HTML injection.
 *
 * Remediation (2026-02-17):
 *   - Added `stripHtmlTags()` function that removes all HTML/XML tags and
 *     decodes common HTML entities (&lt;, &gt;, &amp;, etc.)
 *   - Added `sanitizeTextField()` helper that applies stripHtmlTags + trim
 *   - All string fields in sanitizeInvoice now use sanitizeTextField()
 *   - sanitizeExtractedItems uses stripHtmlTags() on nom_produit_complet,
 *     and sanitizeTextField() on code_produit and info_produit
 *   - sanitizeInsights uses sanitizeTextField() on label and value
 *   - sanitizeString (BL path) now calls stripHtmlTags()
 *
 * Status: FIXED. Tests below confirm the remediation is in place.
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("VAI-02: Server-Side Sanitization of AI Extraction Output [REMEDIATED]", () => {
  let sanitizeSource: string;
  let extractSource: string;

  it("should read the sanitization and extraction source files", async () => {
    sanitizeSource = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");
    extractSource = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");
    expect(sanitizeSource.length).toBeGreaterThan(0);
    expect(extractSource.length).toBeGreaterThan(0);
  });

  it("should confirm sanitizeInvoice DOES strip HTML tags via sanitizeTextField [FIXED]", async () => {
    const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");

    // sanitizeInvoice now uses sanitizeTextField() which calls stripHtmlTags()
    const sanitizeInvoiceFn = source.match(/export function sanitizeInvoice[\s\S]*?^}/m);
    expect(sanitizeInvoiceFn).toBeTruthy();

    // Confirm supplier_name now goes through sanitizeTextField (not just .trim())
    if (sanitizeInvoiceFn) {
      const usesSanitizeTextField = findInSource(
        sanitizeInvoiceFn[0],
        /sanitizeTextField\(record\.supplier_name\)/g
      );
      expect(usesSanitizeTextField.length).toBe(1);
    }

    // Confirm stripHtmlTags exists in the file (the core XSS defense)
    const stripHtmlTagsFn = findInSource(
      source,
      /export function stripHtmlTags\(input: string\): string/g
    );
    expect(stripHtmlTagsFn.length).toBe(1);

    // Confirm stripHtmlTags removes HTML/XML tags via regex
    const htmlTagRemoval = findInSource(source, /replace\(\/<\[/g);
    expect(htmlTagRemoval.length).toBeGreaterThan(0);
  });

  it("should confirm sanitizeExtractedItems DOES sanitize nom_produit_complet via stripHtmlTags [FIXED]", async () => {
    const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");

    // The function still checks typeof rawNom (renamed from nomProduit) for string type
    const rawNomCheck = findInSource(
      source,
      /typeof rawNom !== "string" \|\| rawNom\.trim\(\) === ""/g
    );
    expect(rawNomCheck.length).toBe(1);

    // nom_produit_complet now goes through stripHtmlTags() instead of just .trim()
    const nomProduitSanitized = findInSource(source, /const nomProduit = stripHtmlTags\(rawNom\)/g);
    expect(nomProduitSanitized.length).toBe(1);

    // The sanitized value is assigned to the output
    const nomProduitAssign = findInSource(source, /nom_produit_complet:\s*nomProduit/g);
    expect(nomProduitAssign.length).toBe(1);
  });

  it("should confirm code_produit and info_produit now use sanitizeTextField [FIXED]", async () => {
    const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");

    // code_produit: now goes through sanitizeTextField (which calls stripHtmlTags)
    const codeProduit = findInSource(
      source,
      /const code.*=\s*sanitizeTextField\(record\.code_produit\)/g
    );
    expect(codeProduit.length).toBe(1);

    // info_produit: now goes through sanitizeTextField (which calls stripHtmlTags)
    const infoProduit = findInSource(
      source,
      /const infoProduit.*=\s*sanitizeTextField\(record\.info_produit\)/g
    );
    expect(infoProduit.length).toBe(1);

    // Confirm sanitizeTextField calls stripHtmlTags internally
    const sanitizeTextFieldFn = source.match(/function sanitizeTextField[\s\S]*?^}/m);
    expect(sanitizeTextFieldFn).toBeTruthy();
    if (sanitizeTextFieldFn) {
      const callsStripHtml = findInSource(sanitizeTextFieldFn[0], /stripHtmlTags\(val\)/g);
      expect(callsStripHtml.length).toBe(1);
    }
  });

  it("should confirm numeric fields have only NaN checks (no range/bounds validation)", async () => {
    const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");

    // quantite_commandee: only NaN check, no upper bound
    // An AI could return quantity = 999999999 and it would pass
    const quantiteCheck = findInSource(
      source,
      /typeof record\.quantite_commandee === "number" && !isNaN\(record\.quantite_commandee\)/g
    );
    expect(quantiteCheck.length).toBe(1);

    // prix_total_ligne: only NaN check, no upper bound
    // An AI could return price = -999999 and it would pass
    const prixCheck = findInSource(
      source,
      /typeof record\.prix_total_ligne === "number" && !isNaN\(record\.prix_total_ligne\)/g
    );
    expect(prixCheck.length).toBe(1);

    // No maximum/minimum bounds on numeric values
    const boundsCheck = findInSource(
      source,
      /Math\.max\(.*quantite|Math\.min\(.*quantite|Math\.max\(.*prix|Math\.min\(.*prix/g
    );
    expect(boundsCheck.length).toBe(0);
  });

  it("should confirm sanitizeInsights DOES sanitize label/value via sanitizeTextField [FIXED]", async () => {
    const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");

    // sanitizeInsights now uses sanitizeTextField (which calls stripHtmlTags)
    const insightsSanitize = source.match(/export function sanitizeInsights[\s\S]*?^}/m);
    expect(insightsSanitize).toBeTruthy();

    if (insightsSanitize) {
      // label is now sanitized via sanitizeTextField
      const labelSanitize = findInSource(
        insightsSanitize[0],
        /const cleanLabel = sanitizeTextField\(label\)/g
      );
      expect(labelSanitize.length).toBe(1);

      // value is now sanitized via sanitizeTextField
      const valueSanitize = findInSource(
        insightsSanitize[0],
        /const cleanValue = sanitizeTextField\(value\)/g
      );
      expect(valueSanitize.length).toBe(1);
    }
  });

  it("should confirm stripHtmlTags exists as the HTML sanitization mechanism [FIXED]", async () => {
    const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");

    // stripHtmlTags is now the XSS defense — a custom regex-based HTML stripper
    // It does NOT use DOMPurify (not available in Deno edge functions), but
    // provides defense-in-depth by stripping all HTML/XML tags from AI output
    const stripHtmlTagsFn = findInSource(source, /export function stripHtmlTags/g);
    expect(stripHtmlTagsFn.length).toBe(1);

    // Confirm it removes HTML tags via regex
    const tagRemoval = findInSource(source, /replace\(\/<\[\^>\]\*>\//g);
    expect(tagRemoval.length).toBeGreaterThan(0);

    // Confirm it decodes common HTML entities (defense against encoded payloads)
    const entityDecoding = findInSource(source, /&lt;|&gt;|&amp;|&quot;|&#x27;/g);
    expect(entityDecoding.length).toBeGreaterThan(0);
  });

  it("should confirm no frontend sanitization pipeline exists for AI-extracted data", async () => {
    // Check if there's a visionSanitize.ts or similar in the frontend module
    const frontendSanitizeFiles = await globSourceFiles("src/modules/visionAI/**/sanitize*.ts");
    const frontendSanitizeFilesAlt = await globSourceFiles("src/modules/visionAI/**/sanitize*.tsx");

    // No dedicated sanitization file exists in the frontend visionAI module
    // (the sanitize file is only server-side in supabase/functions/_shared/)
    expect(frontendSanitizeFiles.length).toBe(0);
    expect(frontendSanitizeFilesAlt.length).toBe(0);
  });

  it("should confirm BL sanitization now includes HTML/XSS stripping via sanitizeString [FIXED]", async () => {
    const source = await readSourceFile("supabase/functions/_shared/visionSanitize.ts");

    // sanitizeString helper now calls stripHtmlTags instead of just .trim()
    const sanitizeStringFn = source.match(
      /function sanitizeString\(val: unknown\): string \| null[\s\S]*?^}/m
    );
    expect(sanitizeStringFn).toBeTruthy();
    if (sanitizeStringFn) {
      // sanitizeString now calls stripHtmlTags (which does trim + HTML removal)
      const callsStripHtml = findInSource(sanitizeStringFn[0], /stripHtmlTags\(val\)/g);
      expect(callsStripHtml.length).toBe(1);
    }

    // BL items go through sanitizeString which now strips HTML
    // product_name, raw_label, notes all pass through sanitizeString
    const blProductName = findInSource(
      source,
      /const productName = sanitizeString\(record\.product_name\)/g
    );
    expect(blProductName.length).toBe(1);
  });

  it("should confirm extracted data flows directly from AI -> sanitize -> JSON response (no additional filtering)", async () => {
    const source = await readSourceFile("supabase/functions/vision-ai-extract/index.ts");

    // Data flow: JSON.parse -> sanitizeInvoice/sanitizeExtractedItems/sanitizeInsights -> Response
    // No additional filtering step between sanitization and response

    // 1. Parse: JSON.parse(jsonString)
    const parseStep = findInSource(source, /const parsed = JSON\.parse\(jsonString\)/g);
    expect(parseStep.length).toBe(1);

    // 2. Sanitize: sanitizeInvoice(parsed.invoice)
    const sanitizeInvoiceCall = findInSource(
      source,
      /invoice\s*=\s*sanitizeInvoice\(parsed\.invoice\)/g
    );
    expect(sanitizeInvoiceCall.length).toBe(1);

    // 3. Sanitize items: sanitizeExtractedItems(parsed.items)
    const sanitizeItemsCall = findInSource(
      source,
      /parsedItems\s*=\s*sanitizeExtractedItems\(.*parsed\.items/g
    );
    expect(sanitizeItemsCall.length).toBe(1);

    // 4. Direct to Response: JSON.stringify({ success: true, invoice, items, insights })
    // No additional content filtering between sanitize and response
    const responseCall = findInSource(
      source,
      /JSON\.stringify\(\{[\s\S]*?success:\s*true[\s\S]*?items:\s*parsedItems/g
    );
    expect(responseCall.length).toBe(1);
  });
});

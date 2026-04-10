# Agent: BLPromptAndExtraction

## Mission
Add BL extraction capability to the existing AI extraction edge function. Reuse existing provider routing (Gemini/Pixtral/Claude). Do NOT create a separate edge function.

## Where
- `supabase/functions/vision-ai-extract/index.ts` — add BL extraction path alongside existing Facture path

## BL Output JSON Schema (strict)
```typescript
interface BLExtractionResponse {
  success: true;
  doc_type: "bl";
  bl: BLHeader;
  bl_items: BLItem[];
  document_quality: DocumentQuality;
  insights: Insight[]; // Reuse existing Insight type
  needs_human_review: true; // ALWAYS true
  warnings: string[];
}

interface BLHeader {
  supplier_name: string | null;
  bl_number: string | null;
  bl_date: string | null;        // YYYY-MM-DD if readable
  order_reference: string | null;
}

interface BLItem {
  raw_label: string;                    // Exact text from document
  product_name: string;                 // Cleaned name, or "UNREADABLE"
  qty_delivered: number | null;         // null if not readable
  unit: string | null;                  // kg, pce, bte, etc.
  notes: string | null;                 // Handwritten corrections, remarks
  field_confidence: {
    product_name: number;    // 0.0 - 1.0
    qty_delivered: number;   // 0.0 - 1.0
    unit: number;            // 0.0 - 1.0
  };
  unreadable_fields: Array<{
    field: string;
    reason: string;  // "handwriting_unclear", "photo_blurry", "text_cut_off", etc.
  }>;
}

interface DocumentQuality {
  score: number;        // 0.0 - 1.0
  issues: string[];     // "low_resolution", "skewed", "partial_page", etc.
}
```

## Critical Anti-Hallucination Rules (MUST be in the AI prompt)
1. If text/number is not clearly visible → use `null` or `"UNREADABLE"` and add to `unreadable_fields` with reason
2. NEVER infer missing quantities from context or other lines
3. NEVER copy quantities from adjacent lines
4. If handwritten correction exists → attempt to read, but if ambiguous, provide candidates in `notes` and keep `qty_delivered: null`
5. If document quality is poor → set `document_quality.score < 0.5` and list issues
6. ALWAYS set `needs_human_review: true`

## AI Prompt Structure
- System: "You extract delivery note (Bon de Livraison) data. You MUST NOT hallucinate. If unsure, output null."
- User: Image/PDF + structured extraction instructions
- Response: Strict JSON matching the schema above

## Files to create/modify
- `supabase/functions/vision-ai-extract/index.ts` — add BL extraction branch after classification
- NEW: `supabase/functions/vision-ai-extract/_shared/blPrompt.ts` — BL-specific prompt builder
- Reuse existing provider routing (`callGemini`, `callPixtral`, `callClaude` patterns)

## Tests
- [ ] BL extraction returns valid `BLExtractionResponse` shape
- [ ] `needs_human_review` is always `true`
- [ ] Unreadable fields produce `null` + `unreadable_fields` entry
- [ ] Facture extraction still returns `ExtractionResponse` (unchanged)
- [ ] JSON schema validation on BL output

## Definition of Done
- [ ] BL prompt produces structured output
- [ ] Anti-hallucination rules embedded in prompt
- [ ] Provider-agnostic (works with any configured AI provider)
- [ ] Response matches `BLExtractionResponse` type exactly
- [ ] Existing Facture prompt untouched

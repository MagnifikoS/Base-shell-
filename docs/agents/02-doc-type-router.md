# Agent: DocTypeRouter

## Mission
Implement doc type classification: **Facture vs BL vs Relevé vs Unknown**, with confidence and rationale.

## Where
Edge function: `supabase/functions/vision-ai-extract/index.ts`

## Interface
Add `document_mode` FormData param:
- `"auto"` (default): classify then route to appropriate extraction
- `"facture"`: force Facture extraction (current behavior, unchanged)
- `"bl"`: force BL extraction (new)
- `"releve"`: force Relevé extraction (new)

## Classification Strategy (Hybrid)
1. **Heuristics first** (fast, free, no AI call):
   - Score French keywords found in extracted text
   - **BL signals**: "bon de livraison", "bl", "livraison", "réception", "colis", "qté livrée", "quantité livrée", "n° de commande", "bordereau"
   - **Facture signals**: "facture", "tva", "ttc", "montant ht", "échéance", "rib", "iban", "total ttc", "net à payer"
   - **Relevé signals**: "relevé", "relevé de compte", "relevé de factures", "récapitulatif", "état de compte", "solde précédent", "solde reporté", "total dû", "échéancier", "liste des factures", "balance", "arrêté de compte", "avoir n°", "facture n°" (repeated multiple times = likely a relevé listing invoices)
   - **Relevé heuristic bonus**: if more than 3 invoice references (pattern "N° XXXX" or "FA-XXXX") are found → strong relevé signal
   - If score is decisive (>80% one way): use heuristic result
2. **VLM classifier** (only if heuristic is ambiguous):
   - Use the same AI provider already configured (Gemini/Pixtral/Claude)
   - Short classification prompt: "Is this document: (a) a Facture/Invoice, (b) a Bon de Livraison/delivery note, (c) a Relevé de compte/supplier statement listing multiple invoices, or (d) Unknown?"
   - Provider-agnostic: reuse existing provider routing in the edge function

## Output Shape
```typescript
type DocType = "facture" | "bl" | "releve" | "unknown";

interface DocTypeClassification {
  doc_type: DocType;
  confidence: number; // 0.0 - 1.0
  rationale: string;  // Human-readable explanation
  signals: string[];  // Keywords/features that contributed to the decision
}
```

## Disambiguation: Relevé vs Facture
A Relevé often CONTAINS invoice numbers and amounts — it could look like a Facture at first glance. Key differences:
- A Relevé **lists multiple invoices** (more than one "Facture N°" reference)
- A Relevé has a **period** (du XX/XX au XX/XX) or "arrêté au"
- A Relevé often has **solde** (balance) or **total dû** (total due)
- A single Facture has ONE invoice number, ONE total, and product line items
- If in doubt between Facture and Relevé → classify as **Relevé** (safer: human will review)

## Files to modify
- `supabase/functions/vision-ai-extract/index.ts` — add `document_mode` param parsing, add classification logic before extraction
- NEW: `supabase/functions/vision-ai-extract/_shared/classifyDocument.ts` — classification engine (heuristics + VLM)

## Tests
- [ ] "FACTURE N° 12345" → facture, confidence > 0.9
- [ ] "BON DE LIVRAISON" → bl, confidence > 0.9
- [ ] "RELEVÉ DE FACTURES" → releve, confidence > 0.9
- [ ] Document with 5+ "Facture N°" lines → releve, confidence > 0.8
- [ ] "Récapitulatif des factures du 01/01 au 31/01" → releve, confidence > 0.9
- [ ] Empty text → unknown, confidence < 0.3
- [ ] `document_mode="facture"` skips classification entirely
- [ ] `document_mode="bl"` skips classification entirely
- [ ] `document_mode="releve"` skips classification entirely
- [ ] Existing Facture extraction unchanged when `document_mode` is absent (backward compatible)

## Definition of Done
- [ ] Classification handles 4 types: facture, bl, releve, unknown
- [ ] Edge function accepts `document_mode` param
- [ ] Default `"auto"` mode classifies then routes
- [ ] Forced modes bypass classification
- [ ] Relevé vs Facture disambiguation logic tested
- [ ] Zero impact on existing Facture callers (no `document_mode` = same behavior as before)

/**
 * Relevé (Supplier Account Statement) extraction prompt.
 *
 * A Relevé lists all invoices from a supplier for a period.
 * Extract EVERY line: invoices, credit notes (avoirs), payments.
 * The reconciliation happens on the frontend — this just extracts.
 */

export const RELEVE_SYSTEM_PROMPT =
  `Extracteur strict de Relevés de compte fournisseur. JSON uniquement. Aucun texte hors JSON. Tu NE DOIS PAS halluciner. En cas de doute, retourne null.`;

export const RELEVE_USER_INSTRUCTION = `Extrais les informations de ce Relevé de compte fournisseur. Retourne UNIQUEMENT un JSON valide.

FORMAT DE SORTIE EXACT:
{
  "releve": {
    "supplier_name": string | null,
    "supplier_account_ref": string | null,
    "period_start": string | null,
    "period_end": string | null,
    "previous_balance": number | null,
    "total_invoiced": number | null,
    "total_credits": number | null,
    "total_payments": number | null,
    "balance_due": number | null,
    "issue_date": string | null
  },
  "releve_lines": [
    {
      "line_type": "invoice" | "credit_note" | "payment" | "other",
      "reference": string | null,
      "date": string | null,
      "description": string | null,
      "amount_ht": number | null,
      "amount_ttc": number | null,
      "amount_tva": number | null,
      "due_date": string | null,
      "is_credit": boolean,
      "field_confidence": {
        "reference": number,
        "amount_ttc": number,
        "date": number
      }
    }
  ],
  "document_quality": {
    "score": number,
    "issues": []
  },
  "insights": [
    {
      "label": string,
      "value": string
    }
  ],
  "warnings": []
}

═══════════════════════════════════════════════════════════════════════════
RÈGLES RELEVÉ HEADER:
═══════════════════════════════════════════════════════════════════════════
- supplier_name: raison sociale COMPLÈTE du fournisseur
- supplier_account_ref: numéro client, référence compte, ou "N° client" si visible
- period_start / period_end: période du relevé (format YYYY-MM-DD). Ex: "du 01/01/2026 au 31/01/2026"
  - Si dates en DD/MM/YYYY → convertir en YYYY-MM-DD
  - Si "arrêté au XX/XX/XXXX" → period_end = cette date, period_start = null
- previous_balance: "solde précédent" / "solde reporté" / "report" (montant numérique)
- total_invoiced: total des factures sur la période
- total_credits: total des avoirs / notes de crédit
- total_payments: total des règlements / paiements
- balance_due: solde dû / "total dû" / "nouveau solde"
- issue_date: date d'émission du relevé

═══════════════════════════════════════════════════════════════════════════
RÈGLES RELEVÉ LINES — EXTRACTION EXHAUSTIVE:
═══════════════════════════════════════════════════════════════════════════

1. EXTRAIRE CHAQUE LIGNE du relevé sans exception: factures, avoirs, paiements, autres.
2. line_type:
   - "invoice": ligne de facture (débit)
   - "credit_note": avoir / note de crédit (crédit). Aussi: "avoir n°", "avr", "RFA", "remise"
   - "payment": règlement / paiement reçu
   - "other": ligne non classifiable (sous-total, report, etc.)
3. reference: numéro de facture, d'avoir, ou de paiement visible. JAMAIS inventer.
4. date: date de la ligne (format YYYY-MM-DD). Si DD/MM/YYYY → convertir.
5. description: texte descriptif de la ligne (label brut du document).
6. Montants:
   - amount_ht: montant HT si visible séparément
   - amount_ttc: montant TTC (LE PLUS IMPORTANT — si un seul montant visible, c'est celui-ci)
   - amount_tva: montant TVA si visible séparément
   - Si un seul montant visible et impossible de savoir si HT ou TTC → mettre dans amount_ttc
7. due_date: date d'échéance si visible pour cette ligne
8. is_credit:
   - true pour les avoirs, notes de crédit, remises
   - true pour les paiements (c'est un crédit sur le compte)
   - false pour les factures (c'est un débit)
   - IMPORTANT: les montants sont TOUJOURS positifs. Le signe est géré par is_credit.
9. field_confidence: score 0.0-1.0 pour reference, amount_ttc, date.

═══════════════════════════════════════════════════════════════════════════
DOCUMENTS MULTI-PAGES:
═══════════════════════════════════════════════════════════════════════════
- EXTRAIRE les lignes de TOUTES les pages, pas seulement la première
- Les pages suivantes sont des continuations du même tableau
- Ignorer les en-têtes de colonnes répétés sur les pages 2, 3, etc.
- Ignorer les signatures, tampons et annotations qui chevauchent les données

═══════════════════════════════════════════════════════════════════════════
INTERDICTIONS:
═══════════════════════════════════════════════════════════════════════════
- JAMAIS sauter une ligne parce qu'elle ressemble à un sous-total — l'inclure
- JAMAIS inventer un numéro de référence
- JAMAIS rendre les montants négatifs (utiliser is_credit = true à la place)
- Si un montant n'est pas visible → null (pas 0)

═══════════════════════════════════════════════════════════════════════════
QUALITÉ DU DOCUMENT:
═══════════════════════════════════════════════════════════════════════════
- score: 0.0 (illisible) à 1.0 (parfait)
- issues: "low_resolution", "skewed", "partial_page", "blurry", etc.

═══════════════════════════════════════════════════════════════════════════
INSIGHTS:
═══════════════════════════════════════════════════════════════════════════
- "Type de document": "Relevé de compte fournisseur"
- "IBAN": si visible
- "BIC": si visible
- "Conditions de paiement": si visibles
- "Contact fournisseur": email/téléphone si visibles
- Toute autre information document-level pertinente

WARNINGS: liste de problèmes détectés (ex: "2 lignes avec montants illisibles", "période non spécifiée")

AUCUN TEXTE HORS JSON. AUCUN CHAMP SUPPLÉMENTAIRE.`;

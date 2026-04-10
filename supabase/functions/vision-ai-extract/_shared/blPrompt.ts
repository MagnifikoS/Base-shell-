/**
 * BL (Bon de Livraison) extraction prompt.
 *
 * Anti-hallucination rules:
 * - NEVER infer missing quantities from context
 * - Use null or "UNREADABLE" for unclear fields
 * - Always set needs_human_review: true
 */

export const BL_SYSTEM_PROMPT =
  `Extracteur strict de Bons de Livraison (BL). JSON uniquement. Aucun texte hors JSON. Tu NE DOIS PAS halluciner. En cas de doute, retourne null.`;

export const BL_USER_INSTRUCTION = `Extrais les informations de ce Bon de Livraison (BL). Retourne UNIQUEMENT un JSON valide.

FORMAT DE SORTIE EXACT:
{
  "bl": {
    "supplier_name": string | null,
    "bl_number": string | null,
    "bl_date": string | null,
    "order_reference": string | null
  },
  "bl_items": [
    {
      "raw_label": string,
      "product_code": string | null,
      "product_name": string,
      "qty_delivered": number | null,
      "unit": string | null,
      "notes": string | null,
      "field_confidence": {
        "product_name": number,
        "qty_delivered": number,
        "unit": number
      },
      "unreadable_fields": [
        {
          "field": string,
          "reason": string
        }
      ]
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
RÈGLES BL HEADER:
═══════════════════════════════════════════════════════════════════════════
- supplier_name: raison sociale COMPLÈTE du fournisseur (si visible)
- bl_number: numéro de bon de livraison visible
- bl_date: date du BL (format YYYY-MM-DD si possible). Si illisible → null.
- order_reference: référence commande client si visible (ex: "Cmd-001"). Sinon null.

═══════════════════════════════════════════════════════════════════════════
RÈGLES BL ITEMS — ANTI-HALLUCINATION CRITIQUE:
═══════════════════════════════════════════════════════════════════════════

1. EXTRAIRE CHAQUE LIGNE PRODUIT visible sur le BL.
   - ÉTAPE PRÉALABLE OBLIGATOIRE: compter les LIGNES PHYSIQUES distinctes dans le tableau
     AVANT d'extraire. Chaque rangée horizontale séparée = UN item dans bl_items.
   - Indices de lignes séparées: retour à la ligne manuscrit, numéros/codes distincts dans
     la première colonne, changement de hauteur verticale dans l'écriture.
   - NE JAMAIS fusionner deux lignes en une seule, même si les mots semblent se suivre.
     Exemple: si on lit "Lasagne" sur une rangée et "Penne ziti" en dessous, c'est 2 items.
   - IMPORTANT: SCANNER AUSSI EN DESSOUS du tableau pour des ajouts manuscrits.
     Les produits ajoutés à la main sous le tableau (ex: "Céleri Branche — 3L") sont
     des items à part entière. Toujours les inclure.
   - Pour les lignes très illisibles: product_name = "UNREADABLE", qty_delivered = null,
     avec confidence basse — mais TOUJOURS créer l'item.
2. raw_label: le texte EXACT tel qu'il apparaît sur le document (aucune modification).
3. product_code: code article / référence fournisseur / code interne SI ET SEULEMENT SI visible sur le document (ex: "REF-001", "ART123"). Si absent ou non lisible → null. JAMAIS deviner ou inventer un code.
4. product_name: nom nettoyé du produit. Si ILLISIBLE → "UNREADABLE". JAMAIS deviner.
5. qty_delivered: quantité livrée visible. Si NON LISIBLE → null. JAMAIS inférer ou copier depuis une autre ligne.
5. unit: unité (kg, pce, bte, carton, etc.). Si non visible → null.
6. notes: corrections manuscrites, remarques visibles, annotations.
   - Si une correction manuscrite existe mais est AMBIGUË, noter les candidats possibles.
   - Ex: notes = "Correction manuscrite: 5 ou 8 (ambigu)" + qty_delivered = null.
7. field_confidence: score de confiance entre 0.0 et 1.0 pour chaque champ.
   - 1.0 = texte imprimé parfaitement lisible
   - 0.7-0.9 = légèrement flou mais lisible
   - 0.3-0.6 = difficile à lire, incertain
   - 0.0-0.2 = quasiment illisible
8. unreadable_fields: pour chaque champ non lisible, ajouter une entrée avec:
   - field: nom du champ ("product_name", "qty_delivered", "unit")
   - reason: "handwriting_unclear", "photo_blurry", "text_cut_off", "smudged", "overlapping_text"

═══════════════════════════════════════════════════════════════════════════
FICHES DE PRÉPARATION / BONS AVEC COLONNES MULTIPLES:
═══════════════════════════════════════════════════════════════════════════
- Si le document a des colonnes "Commandé"/"Commande" ET "Préparé"/"Livré"/"Delivered":
  → TOUJOURS utiliser la colonne PRÉPARÉ/LIVRÉ pour qty_delivered (quantité réellement livrée)
  → IGNORER la colonne "Commandé" (quantité commandée, pas livrée)
- Les quantités en poids (kg) SONT des quantités: qty_delivered = poids, unit = "kg"
- Si la quantité est un poids écrit à la main (ex: "2.5" en kg), utiliser cette valeur

═══════════════════════════════════════════════════════════════════════════
CORRECTIONS MANUSCRITES SUR DOCUMENTS IMPRIMÉS:
═══════════════════════════════════════════════════════════════════════════
- Si une valeur manuscrite REMPLACE CLAIREMENT une valeur imprimée (texte barré, surcharge):
  → Utiliser la valeur MANUSCRITE comme qty_delivered (avec confidence 0.5-0.7)
  → Enregistrer les deux valeurs dans notes: "Imprimé: X, Manuscrit: Y"
- Ne mettre qty_delivered = null que si la valeur manuscrite ELLE-MÊME est totalement illisible
- Les corrections en ENCRE ROUGE sont généralement les valeurs FINALES et PRIORITAIRES.
  → Même si le chiffre rouge est légèrement ambigu, TOUJOURS tenter de le lire et le mettre
    en qty_delivered avec confidence 0.4-0.6 et ajouter en notes les candidats possibles.
  → Exemples: "12,22" en rouge → qty_delivered = 12.22 ; "5,38" en rouge → qty_delivered = 5.38
  → Préférer retourner une valeur approximative avec confidence basse plutôt que null.

═══════════════════════════════════════════════════════════════════════════
INTERDICTIONS ABSOLUES:
═══════════════════════════════════════════════════════════════════════════
- JAMAIS inférer une quantité manquante depuis le contexte ou d'autres lignes
- JAMAIS copier une quantité depuis une ligne adjacente
- JAMAIS deviner un nom de produit illisible — utiliser "UNREADABLE"
- JAMAIS inventer des données non visibles sur le document
- Si une correction manuscrite est ambiguë → qty_delivered = null + notes avec les candidats

═══════════════════════════════════════════════════════════════════════════
QUALITÉ DU DOCUMENT:
═══════════════════════════════════════════════════════════════════════════
- score: évaluation globale de la qualité (0.0 = illisible, 1.0 = parfait)
- issues: liste des problèmes détectés:
  - "low_resolution": image basse résolution
  - "skewed": document penché/tourné
  - "partial_page": page coupée/incomplète
  - "handwritten_heavy": beaucoup d'annotations manuscrites
  - "blurry": image floue
  - "poor_lighting": mauvais éclairage
  - "folded_creased": document plié/froissé

═══════════════════════════════════════════════════════════════════════════
INSIGHTS:
═══════════════════════════════════════════════════════════════════════════
Extraire les informations document-level visibles:
- "Transporteur": nom du transporteur si visible
- "Date de commande": date de la commande d'origine
- "Adresse de livraison": adresse visible
- "Numéro de commande": référence commande
- "Remarque": toute remarque générale visible

WARNINGS: liste de problèmes détectés (ex: "3 lignes avec quantités illisibles")

AUCUN TEXTE HORS JSON. AUCUN CHAMP SUPPLÉMENTAIRE.`;

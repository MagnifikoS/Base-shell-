# Module: Résumé THE BRAIN (Achats)

## Description

Ce module affiche une synthèse visuelle des données d'achats persistées.
**Lecture seule** — aucune modification de données.

## SSOT

- Source unique : `purchase_line_items` (module Achats)
- Jointure avec `products_v2` pour noms/catégories
- Aucune lecture de Vision AI ou données brutes d'extraction

## Rollback (suppression complète)

1. Supprimer ce dossier : `rm -rf src/modules/achatsBrainSummary/`
2. Retirer la route dans `App.tsx` : `/achat/the-brain-summary`
3. Retirer le lien dans le module Achats (AchatPage.tsx ou navigation)

**Aucun autre fichier ne dépend de ce module.**

## Structure

```
src/modules/achatsBrainSummary/
├── README.md
├── index.ts
├── types.ts
├── services/
│   └── achatsBrainSummaryService.ts
├── hooks/
│   └── useAchatsBrainSummary.ts
├── pages/
│   └── AchatsBrainSummaryPage.tsx
└── components/
    ├── BrainSummaryHeader.tsx
    ├── BrainSummaryCards.tsx
    └── BrainSummaryTopLists.tsx
```

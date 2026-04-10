# PAYLEDGER — Architecture & Règles Métier
> **Document de référence interne — NE PAS MODIFIER sans audit préalable.**
> Version : Hard Clean v1.0 — Post-Audit 3.0 (13 PASS · 1 WARN · 0 FAIL)

---

## 1. Principes fondamentaux

| Principe | Règle |
|----------|-------|
| **Append-only** | Aucun DELETE sur `pay_payments` ni `pay_allocations`. Les triggers DB bloquent toute suppression. |
| **Statut calculé** | Le statut PAID / PARTIAL / UNPAID n'est **jamais stocké** en base. Il est calculé en temps réel par `payEngine.ts`. |
| **Euro uniquement** | Pas de multi-devise. Tout montant est en EUR, arrondi à 2 décimales via `_round2()`. |
| **Multi-tenant** | Toutes les tables incluent `organization_id` + `establishment_id`. RLS activé sur chaque table. |
| **Void logique** | Une correction = UPDATE `voided_at` + `void_reason`. Motif obligatoire. |
| **Mensuel strict** | Les opérations UI sont **verrouillées au mois visible** (`yearMonth`). Aucune allocation cross-month depuis l'UI. |
| **Crédit global** | Le crédit fournisseur n'est **pas mensuel**. Il est calculé sur l'ensemble des paiements non-voidés du fournisseur. |

---

## 2. SSOT paiement — Chemins unifiés

Il existe **trois et seulement trois** points d'entrée pour créer un paiement :

```
┌─────────────────────────────────────────────────────────────┐
│ 1. createPaymentWithAllocation()   ← Paiement direct facture │
│    Source: "manuel" · Idempotency: UUID aléatoire            │
│    Appelant: AddPaymentDialog → useCreatePaymentWithAllocation│
│                                                               │
│ 2. createSupplierPaymentFIFOMonthly() ← Wallet fournisseur   │
│    Source: "manuel" · Idempotency: UUID aléatoire            │
│    Appelant: GlobalSupplierPaymentDialog → useSupplierGlobal  │
│    Délègue à: autoAllocateFIFO() — verrou mensuel strict      │
│                                                               │
│ 3. createAutoPaymentIdempotent()   ← CRON serveur UNIQUEMENT  │
│    Source: "auto" · Idempotency: clé déterministe (voir §6)  │
│    Appelant: pay-auto-payments-cron (pg_cron 0 * * * *)       │
└─────────────────────────────────────────────────────────────┘
```

**❌ Toute création de paiement hors de ces trois chemins est interdite.**

---

## 3. Flux Wallet facture (paiement direct)

```
Utilisateur → AddPaymentDialog
  → useCreatePaymentWithAllocation(establishmentId, yearMonth)
    → createPaymentWithAllocation({
        pay_invoice_id,
        amount_eur,       ← surpaiement autorisé (surplus = crédit)
        method,
        payment_source: "manuel",
        idempotency_key: UUID
      })
      → INSERT pay_payments
      → INSERT pay_allocations (amount = amount_eur passé)
  → invalidate ["pay-cockpit", estId, yearMonth]
```

- Le surpaiement est autorisé : si `amount > remaining`, le surplus devient crédit fournisseur non alloué.
- Pas de vérification `remaining` côté service — responsabilité du composant UI.

---

## 4. Flux Wallet fournisseur (paiement global FIFO)

```
Utilisateur → GlobalSupplierPaymentDialog
  → useSupplierGlobalPayment(establishmentId, yearMonth)
    → createSupplierPaymentFIFOMonthly({
        supplier_id,
        amount_eur,
        yearMonth,        ← VERROU MENSUEL OBLIGATOIRE
        payment_source: "manuel"
      })
      → INSERT pay_payments (paiement global)
      → autoAllocateFIFO({
          yearMonth,      ← filtre SQL sur invoice_date ∈ [mois-01, mois-dernier]
          supplierId
        })
        → listPayInvoicesByMonth()  ← UNIQUEMENT factures du mois
        → FIFO : distribue budget sur factures triées par invoice_date ASC
        → INSERT pay_allocations pour chaque facture jusqu'à budget épuisé
        → creditLeft = budget restant non alloué (= crédit fournisseur)
```

**⚠️ autoAllocateFIFO ne touche jamais une facture hors du mois affiché.**

---

## 5. Flux CRON — Mode direct_debit

```
pg_cron (0 * * * *) → pay-auto-payments-cron
  → SELECT pay_establishment_settings WHERE auto_record = true
  → Pour chaque établissement :
      → SELECT pay_invoices (toutes)
      → SELECT pay_allocations + join pay_payments(voided_at)
      → SELECT pay_supplier_rules
      → Pour chaque facture non soldée (remaining > 0) :
          Si rule.mode ∈ {direct_debit_delay, direct_debit_fixed_day} :
            Calculer dueDate
            Si dueDate <= today :
              → createAutoPaymentIdempotent(base_key = "auto-{invoiceId}-{dueDate}")
```

**Modes traités :**
- `direct_debit_delay` : `dueDate = invoice_date + delay_days`
- `direct_debit_fixed_day` : `dueDate = prochain jour fixe du mois`

---

## 6. Flux CRON — Mode installments

```
pg_cron (0 * * * *) → pay-auto-payments-cron
  → Pour chaque établissement :
      → SELECT pay_schedule_items
          WHERE voided_at IS NULL
          AND due_date <= today    ← SQL, pas JS
      → Pour chaque schedule_item :
          Si rule.mode === "installments" :
          Si remaining > 0 :
            amount = min(expected_amount_eur, remaining)
            → createAutoPaymentIdempotent(base_key = "auto-sched-{itemId}")
```

**Clé par `schedule_item.id`** (et non `invoice + date`) pour permettre plusieurs échéances le même jour sur la même facture.

---

## 7. Logique d'idempotency (CRON)

### Format des clés

| Mode | Clé de base | Retry après void |
|------|-------------|-----------------|
| `direct_debit_delay` | `auto-{invoice.id}-{YYYY-MM-DD}` | `{base}-v{N}` |
| `direct_debit_fixed_day` | `auto-{invoice.id}-{YYYY-MM-DD}` | `{base}-v{N}` |
| `installments` | `auto-sched-{schedule_item.id}` | `{base}-v{N}` |

### Algorithme

```
1. UPSERT pay_payments ON CONFLICT (establishment_id, idempotency_key) DO NOTHING
2. Si retour NULL → paiement existant → SELECT pour récupérer
3. Si voided_at IS NOT NULL :
     count = SELECT COUNT(*) WHERE idempotency_key LIKE base_key%
     retryKey = base_key + "-v" + (count + 1)
     INSERT pay_payments avec retryKey
4. Vérifier doublon allocation (payment_id, pay_invoice_id) → skip si existant
5. INSERT pay_allocations
```

### ⚠️ Note sur le compteur versionnement

`N = (nombre TOTAL de paiements avec idempotency_key LIKE base_key%) + 1`

Ce n'est **pas** le "nombre de voids". C'est le nombre total de paiements partageant la racine de clé (voidés ou non). Cela garantit l'unicité même en cas de concurrent anormal.

### Pourquoi la logique est dupliquée vs createPaymentWithAllocation

1. **Contexte Deno** : les Edge Functions n'ont pas accès au client browser (`src/integrations/supabase/client`). Elles utilisent le service role key directement.
2. **Sémantique différente** : `"auto"` vs `"manuel"`, clé déterministe vs UUID.
3. **Retry void** : le CRON doit gérer silencieusement les paiements voidés. Le chemin manuel n'en a pas besoin (l'utilisateur voit l'erreur).

---

## 8. Règle mensuel strict

```
listPayInvoicesByMonth(establishmentId, yearMonth)
  → monthBounds(yearMonth) → { from: "YYYY-MM-01", to: "YYYY-MM-DD" }
  → SQL : .gte("invoice_date", from).lte("invoice_date", to)
```

**Toutes les queries UI passent par cette fonction.** Il n'existe aucun chemin UI qui alloue sur des factures hors du mois visible.

**Le CRON n'a pas de contrainte mensuelle** : il traite toutes les factures non soldées dont l'échéance est dépassée, quel que soit leur mois.

---

## 9. Crédit fournisseur

### Définition

```
crédit = Math.max(0,
  Σ pay_payments[voided_at IS NULL].amount_eur   (pour ce supplier_id)
  − Σ pay_allocations[payment_voided_at IS NULL].amount_eur
)
```

### Implémentation

`getSupplierCreditData(establishmentId, supplierId)` dans `payLedgerService.ts` :
- Paiements filtrés en SQL : `eq("supplier_id", supplierId)`
- Allocations filtrées en SQL : `in("payment_id", paymentIds)`
- **Aucun filtre JS post-fetch.**

### Pourquoi le crédit n'est PAS mensuel

Le crédit représente la trésorerie réelle disponible chez le fournisseur. Un surplus de janvier reste un actif en mars. Le limiter au mois serait faux comptablement et créerait des "pertes fictives" de crédit.

### Affichage

| Endroit | Composant | Hook |
|---------|-----------|------|
| Fiche fournisseur | `SupplierPaymentHistory` | `useSupplierCreditData` |
| Dialog wallet | `GlobalSupplierPaymentDialog` | `useSupplierCreditData` |

---

## 10. Tables et relations

```
pay_invoices          ← dette comptable (source_invoice_id → invoices optionnel)
  ↓ 1:N
pay_allocations       ← lien paiement → dette (append-only)
  ↑ N:1
pay_payments          ← événement paiement (append-only, void logique)

pay_supplier_rules    ← règle paiement par fournisseur (mode, délai, etc.)
pay_schedule_items    ← échéancier multi-dates (mode installments)
pay_establishment_settings ← auto_record_direct_debit par établissement
```

---

## 11. Dette technique résiduelle (post Hard Clean v1.0)

| # | Item | Sévérité | Action |
|---|------|----------|--------|
| R1 | `generateDueAutoPayments` supprimée ✅ | Résolu | — |
| R2 | `createAutoPaymentIdempotent` documenté ✅ | Résolu | — |
| R3 | Aucun test E2E CRON | Moyen | À ajouter avant scale-out |
| R4 | Compteur versionnement = total, pas void count | Faible | Acceptable, documenté §7 |

---

## 12. Interdictions absolues

```
❌ Ne jamais créer un nouveau chemin paiement hors des 3 SSOT
❌ Ne jamais stocker le statut PAID/PARTIAL/UNPAID en base
❌ Ne jamais appeler generateDueAutoPayments (supprimée)
❌ Ne jamais allouer cross-month depuis l'UI
❌ Ne jamais DELETE sur pay_payments ou pay_allocations (triggers bloquants)
❌ Ne jamais calculer le crédit par mois (sémantique fausse)
❌ Ne jamais déclencher autopay depuis un composant React
```

---

*Généré automatiquement — Hard Clean v1.0 — 2026-02-19*

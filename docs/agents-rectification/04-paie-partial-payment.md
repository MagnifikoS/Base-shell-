# Agent 04: PaiePartialPayment

## Mission
Add partial payment support for both "Virement" and "Espèces" columns in the Paie table. Users can enter a partial amount paid instead of just toggling "Payé / Non payé".

## Current State
- `src/pages/payroll/PayrollTable.tsx` — `PaymentBadge` component with binary toggle
- `src/hooks/payroll/usePayrollValidation.ts` — stores `cashPaid: boolean`, `netPaid: boolean`
- `src/lib/payroll/payroll.compute.ts` — `PayrollValidationFlags` type
- Edge function: `supabase/functions/payroll-validation/index.ts` — upserts flags
- **Current behavior**: Click badge → toggles between "Payé" (green) / "Non payé" (gray)

## Target Behavior

### Click on Virement/Espèces badge → Popover with amount input
```
┌──────────────────────────────┐
│ Virement pour AGAMEZ Meisen  │
│                              │
│ Net à payer: 1 463,06 €      │
│                              │
│ Montant versé:               │
│ [________] €                 │
│                              │
│ ○ Totalité (1 463,06 €)     │
│ ○ Montant partiel            │
│ ○ Non payé                   │
│                              │
│ [Annuler]       [Valider]    │
└──────────────────────────────┘
```

### Visual States in Table
| State | Badge Display | Color |
|-------|--------------|-------|
| Fully paid | ✓ Payé | Green |
| Partial | ✓ 800,00 € | Orange/Amber |
| Not paid | ✗ Non payé | Gray |

### Badge for partial:
```
[✓ 800,00 €]  (amber background, shows partial amount)
```

### Reste à payer
- Footer: "Reste virement" = sum of (net_salary - net_amount_paid) for each employee
- Footer: "Reste espèces" = sum of (cash_amount - cash_amount_paid) for each employee
- Employee detail drawer: show "Reste à payer: XXX €"

## Data Model Changes

### PayrollValidationFlags (extend)
```typescript
interface PayrollValidationFlags {
  includeExtras: boolean;
  includeAbsences: boolean;
  includeDeductions: boolean;
  cashPaid: boolean;           // true = fully paid OR partially paid
  netPaid: boolean;            // true = fully paid OR partially paid
  extrasPaidEur: number | null;
  // NEW:
  netAmountPaid: number | null;   // null = not paid, number = partial/full amount
  cashAmountPaid: number | null;  // null = not paid, number = partial/full amount
}
```

### Database: payroll_validations table
```sql
ALTER TABLE public.payroll_validations 
  ADD COLUMN IF NOT EXISTS net_amount_paid NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS cash_amount_paid NUMERIC(12, 2);
```

### Logic
- `netPaid = true` + `netAmountPaid = null` → fully paid (backward compat)
- `netPaid = true` + `netAmountPaid = 800` → partially paid (800€ out of net)
- `netPaid = false` → not paid (`netAmountPaid` ignored)
- Same for `cashPaid` / `cashAmountPaid`

## Files to modify
- `supabase/migrations/YYYYMMDD_payroll_partial_payments.sql` — add columns
- `src/lib/payroll/payroll.compute.ts` — extend `PayrollValidationFlags` type
- `src/hooks/payroll/usePayrollValidation.ts` — handle partial amounts in mutations
- `supabase/functions/payroll-validation/index.ts` — accept partial amount fields
- `src/pages/payroll/PayrollTable.tsx`:
  - Replace `PaymentBadge` with `PaymentBadgeWithPopover`
  - Update footer "Reste" calculation to account for partial payments
- NEW: `src/pages/payroll/PaymentPopover.tsx` — popover with amount input
- `src/pages/payroll/EmployeeDetailSheet.tsx` — show reste à payer

## What NOT to change
- Payroll computation engine (net_salary, extras, deductions)
- Print/export functionality
- Month navigation

## Tests
- [ ] Click badge → popover opens with amount input
- [ ] Select "Totalité" → fully paid (green badge)
- [ ] Enter partial amount → partial badge (amber, shows amount)
- [ ] Select "Non payé" → gray badge
- [ ] Footer "Reste virement" accounts for partial amounts
- [ ] Footer "Reste espèces" accounts for partial amounts
- [ ] Employee drawer shows reste à payer
- [ ] Backward compatible: existing `cashPaid: true` without amount → fully paid
- [ ] Amount validated: cannot exceed net salary
- [ ] Amount validated: must be ≥ 0

## Definition of Done
- [ ] Popover with 3 options (full, partial, not paid)
- [ ] Visual distinction: green (full), amber (partial), gray (not paid)
- [ ] Partial amount shown on badge
- [ ] Footer and drawer updated with reste calculations
- [ ] DB migration for partial amount columns
- [ ] Edge function updated
- [ ] Backward compatible with existing data

# Agent 03: BadgeuseDoubleShift

## Mission
Handle badge events for employees with **two shifts in a day** (e.g., 10:00-14:00 + 18:00-23:00). Detect forgotten clock-outs, missing clock-ins between shifts, and provide smart resolution dialogs.

## Context
The badge system (`supabase/functions/badge-events/`) handles clock_in/clock_out events. Currently it works well for single-shift days. For double-shift days, edge cases arise:
- Employee forgets to clock out of shift 1
- Employee forgets to clock in for shift 2
- Double badges (clock_in twice without clock_out)

## Current Architecture
- Edge function: `supabase/functions/badge-events/index.ts`
- Frontend: `src/components/badgeuse/BadgeuseKioskView.tsx`
- Helpers: `supabase/functions/badge-events/_shared/userHandlers.ts`
- Planning data: `planning-week` edge function provides expected shifts

## Target Behavior

### Scenario 1: Forgot clock-out of shift 1, arrives for shift 2
```
Expected: Shift 1 (10:00-14:00) + Shift 2 (18:00-23:00)
Events:   clock_in 10:02 → [no clock_out] → clock_in 17:55

Detection: The system sees a clock_in at 17:55 while there's an open clock_in from 10:02.
```

**Resolution popup**:
```
┌──────────────────────────────────────────────┐
│ ⚠️ Pointage d'entrée sans sortie précédente  │
│                                               │
│ Vous aviez pointé à 10:02 mais pas de        │
│ sortie enregistrée.                           │
│                                               │
│ Le planning prévoit un shift 10:00-14:00.     │
│                                               │
│ ○ J'ai oublié de pointer la sortie           │
│   → Enregistrer sortie à 14:00 (planning)    │
│   → Enregistrer entrée à 17:55 (maintenant)  │
│                                               │
│ ○ Mon planning a été modifié                  │
│   → Contactez votre responsable               │
│                                               │
│ [Annuler]                      [Confirmer]    │
└──────────────────────────────────────────────┘
```

### Scenario 2: Normal double shift flow
```
Events: clock_in 10:02 → clock_out 14:05 → clock_in 17:55 → clock_out 23:10
```
All events should be recorded correctly with proper shift assignment.

### Scenario 3: Double clock-in (badge twice by mistake)
```
Events: clock_in 10:02 → clock_in 10:03 (mistake)

Detection: Two clock_ins within 5 minutes without clock_out.
```
**Resolution**: Ignore the second clock_in, show toast: "Déjà pointé à 10:02"

### Detection Logic (in edge function or frontend)
```typescript
interface ShiftContext {
  expectedShifts: Array<{ start_time: string; end_time: string }>;
  lastEvent: { type: "clock_in" | "clock_out"; time: string } | null;
  openClockIn: string | null; // Timestamp of unmatched clock_in
}

function detectDoubleShiftIssue(context: ShiftContext, newEventTime: string): 
  | "normal"           // No issue, proceed
  | "forgot_clockout"  // Open clock_in from previous shift
  | "duplicate_badge"  // Same type within 5 min
  | "unknown_shift"    // No matching expected shift
```

### Auto-Resolution Rules
1. **Forgot clock-out**: If there's an open clock_in AND the current time is within 30 min of the next shift's start → auto-suggest closing at previous shift's planned end time
2. **Duplicate badge**: If same event type within 5 minutes → ignore with toast
3. **Unknown shift**: If badge time doesn't match any planned shift → show warning but allow

## Files to modify
- MODIFY: `supabase/functions/badge-events/_shared/userHandlers.ts` — double-shift detection logic
- MODIFY: `src/components/badgeuse/BadgeuseKioskView.tsx` — resolution popup UI
- NEW: `src/components/badgeuse/DoubleShiftResolutionDialog.tsx` — popup component
- MODIFY: `supabase/functions/badge-events/_shared/helpers.ts` — shift matching helpers

## What NOT to change
- Badge PIN flow
- Rate limiting
- Admin badge actions
- Badge settings

## Tests
- [ ] Single shift: normal clock_in/clock_out — unchanged behavior
- [ ] Double shift: full normal flow (in-out-in-out) recorded correctly
- [ ] Forgot clock_out: detected and popup shown with auto-fill suggestion
- [ ] "Oubli" confirmed → clock_out at planned end + new clock_in recorded
- [ ] "Planning modifié" → message to contact manager
- [ ] Duplicate badge within 5 min → ignored with toast
- [ ] Badge time not matching any shift → warning but allowed

## Definition of Done
- [ ] Double-shift detection in edge function
- [ ] Resolution popup in frontend
- [ ] Auto-fill suggestion from planning data
- [ ] All badge scenarios handled without data corruption
- [ ] Existing single-shift behavior unchanged

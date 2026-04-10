# Agent 02: PlanningDragDropFix

## Mission
Fix drag & drop in planning: make shift moves **instant visually** (optimistic update), remove excessive delay, and eliminate the need to reload the page.

## Current State
- `src/components/planning/week/PlanningWeekRow.tsx` — `handleDrop` calls `createShiftMutation.mutate()`
- `src/components/planning/week/PlanningWeekCell.tsx` — `handleDragStart` sets drag payload
- **Bugs reported**:
  - Excessive delay after drag & drop
  - Change only visible after page reload
  - Not visually immediate

## Root Cause Analysis
The drag & drop calls `createShiftMutation` which:
1. Makes an API call to `planning-week` edge function
2. Waits for response
3. Invalidates query cache
4. React Query refetches
5. UI updates

This creates a **2-4 second delay**. The fix is **optimistic updates**.

## Target Behavior
1. User drags shift from Day A → Day B
2. **Immediately**: shift disappears from Day A, appears in Day B (optimistic)
3. **Background**: API call to move/create shift
4. **On success**: no visual change (already applied)
5. **On failure**: revert to original position + show error toast

## Implementation

### Optimistic Update Pattern
```typescript
// In handleDrop:
const queryKey = ["planning-week", establishmentId, weekStart];

// 1. Cancel any in-flight queries
queryClient.cancelQueries({ queryKey });

// 2. Snapshot previous data
const previousData = queryClient.getQueryData(queryKey);

// 3. Optimistically update the cache
queryClient.setQueryData(queryKey, (old) => {
  // Remove shift from source date, add to target date
  return applyOptimisticMove(old, sourceShift, targetDate);
});

// 4. Mutate (API call in background)
createShiftMutation.mutate(payload, {
  onError: () => {
    // Revert on failure
    queryClient.setQueryData(queryKey, previousData);
    toast.error("Impossible de déplacer le shift");
  },
  onSettled: () => {
    // Always refetch to ensure consistency
    queryClient.invalidateQueries({ queryKey });
  },
});
```

### Additional: Move vs Copy
Currently drag & drop only **copies** (creates a new shift). For a true **move**:
1. Delete the original shift
2. Create the new shift at target date

Use the existing `deleteShift` mutation from the planning-week edge function.

**Enhancement**: Detect if drag is within same employee (move) vs different employee (copy):
- Same employee: **move** (delete old + create new)
- Different employee: **copy** (create new only, keep original)

## Files to modify
- MODIFY: `src/components/planning/week/PlanningWeekRow.tsx` — optimistic drag & drop
- MODIFY: `src/components/planning/hooks/usePlanningWeek.ts` — expose `queryClient` + optimistic helpers
- Possibly: `src/components/planning/week/PlanningWeekCell.tsx` — drag visual feedback

## What NOT to change
- Edge function `planning-week` — API stays the same
- Shift creation/deletion logic — only the UI timing changes
- Week view layout

## Tests
- [ ] Drag shift → instantly visible at target (no delay)
- [ ] API failure → shift reverts to original position
- [ ] Error toast shown on failure
- [ ] Same employee drag → move (old deleted)
- [ ] No page reload needed after drop
- [ ] Multiple rapid drag & drops handled correctly
- [ ] Shift data consistent after optimistic update settles

## Definition of Done
- [ ] Optimistic drag & drop with instant visual feedback
- [ ] Revert on API failure
- [ ] No page reload required
- [ ] Move behavior for same-employee drags

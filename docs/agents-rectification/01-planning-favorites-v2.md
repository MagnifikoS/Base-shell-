# Agent 01: PlanningFavoritesV2

## Mission
Rewrite the planning favorites system: support **named favorites** (max 2 per employee), fix star visual inconsistencies, and implement proper apply-favorite flow with conflict resolution.

## Current State
- `src/components/planning/hooks/usePlanningFavorites.ts` — localStorage-based, **1 unnamed favorite per employee**
- Star icon next to employee name in `PlanningWeekRow.tsx` — toggle save/clear
- Star icon next to print button in `PlanningWeekView.tsx` — apply favorite
- **Bugs reported**:
  - Star stays selected when changing weeks
  - "Aucun favori enregistré" message appears after adding a favorite
  - Inconsistency between the two star icons

## Target Behavior

### 1. Saving Favorites (star next to employee name)
- Click star → **prompt for a name** (e.g., "Semaine normale", "Semaine haute")
- Save the current week's shifts as a **named template**
- **Max 2 favorites per employee**
- If user tries to save a 3rd → modal: "Choisir lequel remplacer" with the 2 existing names
- Each favorite stores: `{ name, shifts[], savedAt }`
- Star is **filled (yellow)** only if the currently displayed week **matches** a saved favorite
- Star is **outline** if no match or different week

### 2. Visual Consistency
- Star next to name: shows whether current employee's **current week** matches a saved template
- Star next to print: opens the **apply** flow (always outline, not toggle)
- Changing weeks → star state **recalculated** (compare current shifts to saved templates)
- Never show "aucun favori" immediately after saving

### 3. Applying Favorites (star next to print button)
Flow:
```
1. Click star → Modal: "Appliquer un favori"
2. List employees with saved favorites
3. Click employee → show their 1 or 2 favorites by name
4. If 1 favorite → show name + "Appliquer ?" + [Annuler] [Valider]
5. If 2 favorites → show both names, user picks one
6. If shifts already exist in target week → confirmation: "Des shifts existent déjà. Remplacer ?"
7. On confirm → delete existing shifts + create new shifts from template
```

### 4. Data Model Upgrade
```typescript
interface NamedFavorite {
  name: string;
  shifts: FavoriteShiftTemplate[];
  savedAt: string;
}

// Per employee: up to 2 named favorites
type EmployeeFavorites = NamedFavorite[]; // max length 2

// Storage: Record<userId, EmployeeFavorites>
```

**Enhancement: Consider moving from localStorage to Supabase table** (`planning_favorites`) for persistence across devices. Create migration if implementing DB storage.

## Files to modify
- REWRITE: `src/components/planning/hooks/usePlanningFavorites.ts` — named favorites, max 2
- MODIFY: `src/components/planning/week/PlanningWeekRow.tsx` — star logic, save prompt
- MODIFY: `src/components/planning/week/PlanningWeekView.tsx` — apply flow with employee/favorite selection
- NEW: `src/components/planning/week/FavoriteSaveDialog.tsx` — name input + replace dialog
- NEW: `src/components/planning/week/FavoriteApplyDialog.tsx` — employee list → favorite selection → apply
- OPTIONAL: `supabase/migrations/YYYYMMDD_planning_favorites.sql` — if moving to DB

## Tests
- [ ] Save favorite with custom name
- [ ] Max 2 favorites enforced — 3rd prompts replacement
- [ ] Star filled only when current week matches saved template
- [ ] Star outline when week doesn't match
- [ ] Changing weeks recalculates star state
- [ ] Apply favorite: single favorite → direct apply with confirmation
- [ ] Apply favorite: two favorites → selection modal
- [ ] Apply with existing shifts → replacement confirmation
- [ ] Shifts correctly created from template on apply

## Definition of Done
- [ ] Named favorites (max 2) with save/replace flow
- [ ] Visual consistency between both stars
- [ ] Apply flow with employee selection + conflict resolution
- [ ] No "aucun favori" bug after save
- [ ] Star state recalculated on week change

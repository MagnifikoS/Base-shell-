# CLAUDE.md — Restaurant OS Development Guide

> **This file is the single source of truth for Claude Code working on this project.**
> Read this ENTIRELY before making any change.

---

## Project Identity

**Restaurant OS** — A comprehensive SaaS platform for restaurant management covering HR, payroll, scheduling, time-tracking, invoicing, inventory, and AI-powered invoice extraction.

**Production status:** Pre-launch. 72 improvement tasks identified in `docs/TASKS.md`. See `docs/AUDIT.md` for the complete audit.

---

## Workflow Preferences

### Don't Get Stuck in Plan Mode

Planning is valuable and expected for complex tasks. However, when the user explicitly asks for implementation or gives a prioritized task list, **do not stay in plan mode** — transition to writing code. Don't spend an entire session reading files and creating task lists without shipping any changes.

### Parallel Agent Orchestration — CRITICAL Context Management

Launching many parallel agents is encouraged for throughput. **Context overflow is the #1 failure mode.** Follow these rules strictly:

#### Rule 1: File-Based Results (MANDATORY)
- Every sub-agent MUST write its full output to a file (e.g., `.agent-results/agent-name.md`)
- Return ONLY a **2-3 line summary** to the parent context: `"Agent X complete. Score: Y/10. 3 issues found. Report: .agent-results/X.md"`
- NEVER return raw command output to the parent — write it to the file

#### Rule 2: Batch in Small Waves
- Launch **max 3 agents in parallel** per wave, not 9 at once
- After each wave completes, run `/compact` before launching the next wave
- Suggested audit waves:
  - Wave 1: Agent 01 (Build) + Agent 06 (Tests) — fastest, gate-keepers
  - Wave 2: Agent 02 (Security) + Agent 03 (Database) + Agent 04 (Performance)
  - Wave 3: Agent 05 (Architecture) + Agent 07 (UX) + Agent 08 (Backend)
  - Wave 4: Agent 09 (DevOps) + Final Report consolidation

#### Rule 3: Compact Between Waves
- After each wave, use `/compact` to summarize conversation
- The compacted context should only retain: file paths of results, scores, and issue counts

#### Rule 4: Agent Self-Containment
- Each agent should run its commands, score, and write its report **entirely within its own context**
- The agent returns: `{ score, issueCount, reportPath }` — nothing else
- The parent reads the report files only when consolidating the final report

### Post-Change Checklist

After completing code changes:
1. Run `npm run lint` and fix any issues
2. Run `npm run test` to verify no regressions
3. Run `npm run build` to verify the build passes
4. Do NOT push or commit unless explicitly asked

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend** | React 18 + TypeScript + Vite | SPA, port 8080 |
| **UI Components** | shadcn/ui + Tailwind CSS + Radix UI | 50 components in `src/components/ui/` |
| **State** | React Query (TanStack) + React Context | Query cache 1min, 13 realtime channels |
| **Routing** | react-router-dom v6 | All routes in `src/App.tsx` |
| **Backend** | Supabase (PostgreSQL + Edge Functions + Auth + Storage) | Edge functions in Deno |
| **Mobile** | Capacitor (web wrapper) | Config in `capacitor.config.ts` |
| **Testing** | Vitest + Testing Library + Playwright (config only) | Very low coverage currently |

---

## Critical Rules — NEVER Break These

### 1. SSOT (Single Source of Truth)

Every piece of data has ONE canonical source. Never duplicate logic.

- **Permissions** → `src/hooks/usePermissions.ts` (V2-ONLY, from `get_my_permissions_v2` RPC)
- **Navigation** → `src/config/navRegistry.ts` (ALL nav items defined here)
- **Sidebar sections** → `src/config/sidebarSections.ts`
- **Feature flags** → `src/config/featureFlags.ts`
- **Active establishment** → `src/contexts/EstablishmentContext.tsx`
- **Auth state** → `src/contexts/AuthContext.tsx`
- **Payroll calculations** → `src/lib/payroll/payroll.compute.ts` (pure functions, no React)
- **Timezone** → `src/lib/time/paris.ts` + `src/lib/time/dateKeyParis.ts` (Europe/Paris ONLY)
- **Presence computation** → `src/lib/presence/presence.compute.ts` (pure functions)
- **Effective time** → `src/lib/badgeuse/computeEffectiveTime.ts` (pure functions)
- **Query client** → `src/lib/queryClient.ts` (singleton)
- **Service day** → Backend RPC `get_service_day_now()` (NEVER calculate locally)

### 2. Module Independence

Modules in `src/modules/` MUST be as independent as possible:
- Each module has `index.ts` as its ONLY public entry point
- Other modules MUST import through `index.ts`, never deep-import internal files
- Exceptions exist (Vision AI ↔ ProduitsV2) — do NOT add new ones
- To check if a module is truly removable: `rm -rf src/modules/<name>` should require only removing routes in `App.tsx` and nav items in `navRegistry.ts`

### 3. Edge Function Security Pattern

ALL edge functions MUST follow this pattern:
```typescript
// 1. CORS preflight
if (req.method === "OPTIONS") {
  return new Response(null, { headers: corsHeaders });
}

// 2. Auth check (MANDATORY unless explicitly public)
const authHeader = req.headers.get("Authorization");
if (!authHeader) {
  return jsonErr("Missing authorization", 401);
}
const supabaseUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
const { data: { user }, error } = await supabaseUser.auth.getUser();
if (error || !user) {
  return jsonErr("Unauthorized", 401);
}

// 3. RBAC check (for protected operations)
const { data: hasAccess } = await supabaseUser.rpc("has_module_access", {
  _module_key: "module_name",
  _min_level: "write",
  _establishment_id: establishmentId,
});
if (!hasAccess) {
  return jsonErr("Access denied", 403);
}

// 4. Business logic using adminClient (service role for mutations)
const supabaseAdmin = createClient(url, serviceRoleKey);
```

**CRITICAL:** `supabase/config.toml` has `verify_jwt = false` for all functions. Auth is done IN CODE via `getUser()`. Never skip this step.

### 4. TypeScript Safety

Current config has `strict: true` with full strict checks (`strictNullChecks`, `noImplicitAny`). When writing new code:
- Always use explicit types (no implicit `any`)
- Always handle `null`/`undefined` cases
- Use `as` casts only when absolutely necessary (prefer type guards)
- Current codebase has 0 `as any` casts — do not add any

### 5. Timezone — Always Paris

- NEVER use `new Date().toISOString().split("T")[0]` for date keys (UTC shift bug)
- ALWAYS use `formatParisDateKey()` from `src/lib/time/dateKeyParis.ts`
- ALWAYS use `formatParisHHMM()` from `src/lib/time/paris.ts` for time display
- Service day cutoff is per-establishment (from `service_day_cutoff` column)
- Default cutoff is `"03:00"` — but ALWAYS fetch from DB

### 6. French Labor Law (Payroll)

- Weekly overtime = per civil week (Monday→Sunday), attached to month of Sunday
- `WEEKS_PER_MONTH = 52/12` (legal constant)
- `DAILY_WORK_MINUTES = 420` (7h/day for absence calculation)
- CP (congés payés) = counted but NOT deducted from salary
- Absences = deducted using `hourlyRateOperational`
- R-Extra = calculated on-the-fly, NEVER stored

---

## Project Structure

```
src/
├── App.tsx                    # Route table (625 lines — needs splitting)
├── main.tsx                   # Entry point (no StrictMode currently)
├── components/
│   ├── ui/                    # 50 shadcn/ui base components
│   ├── layout/                # AppLayout, AppSidebar, SidebarSectioned
│   ├── mobile/                # Mobile-specific components
│   ├── planning/              # Planning module components
│   ├── presence/              # Presence module components
│   ├── employees/             # Employee management
│   ├── badgeuse/              # Badge clock components
│   ├── admin/                 # Admin panel components
│   ├── establishments/        # Establishment settings
│   ├── settings/              # Settings components
│   ├── ProtectedRoute.tsx     # Auth-only gate
│   └── PermissionGuard.tsx    # RBAC gate (moduleKey)
├── modules/                   # Independent business modules
│   ├── visionAI/              # AI invoice extraction (44 files)
│   ├── theBrain/              # Learning engine (18 files)
│   ├── produitsV2/            # Products catalog (21 files)
│   ├── inventaire/            # Inventory (18 files)
│   ├── factures/              # Invoices (11 files)
│   ├── fournisseurs/          # Suppliers (9 files)
│   ├── achat/                 # Purchase summary (13 files)
│   ├── congesAbsences/        # Leave management (14 files)
│   ├── conditionnementV2/     # Unit conversion engine (7 files)
│   ├── cash/                  # Cash register (11 files)
│   ├── signatureStudio/       # Signature prototype (15 files)
│   └── ...                    # Other modules
├── hooks/                     # Shared hooks (usePermissions, useIsMobile, etc.)
├── contexts/                  # AuthContext, EstablishmentContext, BlockingDialogContext
├── config/                    # featureFlags, navRegistry, sidebarSections, testModeFlags
├── lib/                       # Pure logic: payroll, presence, time, rbac, permissions
├── core/                      # Unit conversion engine
├── integrations/supabase/     # Supabase client + auto-generated types
├── pages/                     # 27 page components
└── utils/                     # exportCsv

supabase/
├── config.toml                # Edge function config (verify_jwt=false)
├── functions/                 # 30 edge functions (Deno)
│   ├── _shared/               # Shared utilities (normalizeProductName)
│   ├── badge-events/          # Badge clock-in/out (largest function)
│   ├── planning-week/         # Planning CRUD (14 shared files)
│   ├── employees/             # Employee CRUD + encryption
│   ├── vision-ai-extract/     # AI invoice extraction
│   └── ...                    # Other functions
├── migrations/                # 162 SQL migrations
└── diagnostics/               # Diagnostic queries
```

---

## Key Patterns

### Adding a New Page

1. Create page in `src/pages/NewPage.tsx`
2. Add route in `src/App.tsx` inside `<Routes>`:
   ```tsx
   <Route path="/new-page" element={
     <ProtectedRoute>
       <PermissionGuard moduleKey="module_name">
         <NewPage />
       </PermissionGuard>
     </ProtectedRoute>
   } />
   ```
3. Add navigation item in `src/config/navRegistry.ts`
4. Add to sidebar section in `src/config/sidebarSections.ts`
5. Use `<ResponsiveLayout>` or `<AppLayout>` as wrapper

### Adding a New Module

1. Create folder `src/modules/newModule/` with:
   - `index.ts` (barrel export)
   - `types.ts`
   - `components/`, `hooks/`, `services/`
2. Import ONLY through `index.ts` from outside the module
3. Add feature flag in `src/config/featureFlags.ts` if needed
4. Add page + route + nav item (see above)

### Adding a New Edge Function

1. Create `supabase/functions/new-function/index.ts`
2. Follow the security pattern (section 3 above)
3. Add to `supabase/config.toml`:
   ```toml
   [functions.new-function]
   verify_jwt = false
   ```
4. Use TWO clients: `supabaseUser` (JWT) for auth/RBAC, `supabaseAdmin` (service role) for mutations
5. Always return proper CORS headers

### React Query Keys Convention

Keys follow the pattern `[resource, ...scope]`:
```typescript
["planning-week", establishmentId, weekStart]
["presence", establishmentId, date]
["employees", establishmentId]
["my-permissions-v2", userId, establishmentId]
["payroll", "month", establishmentId, month]
["cash-day", establishmentId, date]
```

### Realtime Subscriptions

All realtime is centralized in `src/hooks/useAppRealtimeSync.ts` (mounted ONCE in AppLayout). Do NOT create local realtime subscriptions in individual modules — add new channels to the central hook instead.

**Exception:** `inventaire` module has local realtime (to be migrated per TASKS.md INV-04).

---

## What NOT To Do

| Don't | Do Instead |
|-------|-----------|
| Calculate dates with `toISOString()` | Use `formatParisDateKey()` |
| Create local realtime subscriptions | Add to `useAppRealtimeSync.ts` |
| Import module internals directly | Import through `index.ts` |
| Add `console.log` in production paths | Use `import.meta.env.DEV` guard |
| Create new `as any` casts | Use proper types or type guards |
| Skip auth in edge functions | Use `requireAuth` pattern |
| Hardcode French text in components | Use French text (app is FR-only for now) but keep strings extractable |
| Duplicate business logic | Find the SSOT and use it |
| Create new feature flags outside `featureFlags.ts` | Add to `featureFlags.ts` |
| Modify `src/integrations/supabase/types.ts` | This is auto-generated — run `supabase gen types` |

---

## Environment

### Required Environment Variables

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...  # Supabase anon key
```

### Edge Function Environment (set in Supabase dashboard)

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # Secret — never expose
EMPLOYEE_DATA_KEY=...              # For AES-256-GCM (IBAN/SSN)
BOOTSTRAP_SECRET=...               # For first admin creation
```

### Commands

```bash
npm run dev          # Start dev server (port 8080)
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Vitest (127 test files, 2694 tests)
```

---

## Important Files to Know

| File | Lines | Why It Matters |
|------|:-----:|---------------|
| `src/App.tsx` | ~39 | Route table (refactored from 625 lines) |
| `src/hooks/usePermissions.ts` | 385 | RBAC V2 — controls who sees what |
| `src/hooks/useAppRealtimeSync.ts` | ~124 | Realtime subscriptions (refactored from 958 lines) |
| `src/lib/payroll/payroll.compute.ts` | 1205 | Payroll engine — pure functions |
| `src/lib/presence/presence.compute.ts` | 444 | Presence calculation — pure functions |
| `src/config/navRegistry.ts` | 702 | Navigation SSOT |
| `src/config/featureFlags.ts` | 161 | Feature flags + RBAC V2 gating |
| `src/contexts/EstablishmentContext.tsx` | 176 | Multi-restaurant state |
| `src/contexts/AuthContext.tsx` | 84 | Auth session management |
| `supabase/functions/badge-events/index.ts` | 182 | Badge clock-in/out entry point |
| `supabase/functions/planning-week/index.ts` | 233 | Planning CRUD entry point |
| `supabase/functions/employees/index.ts` | ~800 | Employee CRUD + encryption |
| `supabase/config.toml` | 97 | Edge function config — verify_jwt=false on ALL |
| `docs/AUDIT.md` | 1000+ | Complete audit report |
| `docs/TASKS.md` | 500+ | 72 improvement tasks |
| `docs/data-deletion-policy.md` | ~200 | GDPR deletion rules |

---

## Testing

### Current State

127 test files with 2,694 tests across unit, integration, security (red/blue team), and E2E categories. Key test areas:
- `src/lib/` — payroll, presence, time, badgeuse pure function tests
- `src/modules/` — module-specific unit tests
- `tests/security/` — 55 red/blue team security tests
- `src/pages/payroll/__tests__/` — payment logic tests

### Writing New Tests

Use Vitest (already configured in `vitest.config.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { myFunction } from "../myModule";

describe("myFunction", () => {
  it("should handle the happy path", () => {
    expect(myFunction(input)).toBe(expected);
  });
});
```

Place test files in `__tests__/` next to the code they test, or in `src/lib/*/__tests__/`.

### Security Tests

See `tests/SECURITY-AGENTS.md` for the red/blue team testing framework.

---

## Known Technical Debt

See `docs/TASKS.md` for the complete list (72 tasks). Key items:

1. **`verify_jwt = false`** on all edge functions — auth done in code via `getUser()`
2. **18 files > 700 lines** — need splitting (e.g., Rapports.tsx 1,496 lines)
3. **Two duplicate `useIsMobile` hooks** — consolidate `use-mobile.tsx` and `useIsMobile.ts`
4. **8 edge functions still use legacy wildcard CORS** — migrate to `makeCorsHeaders()`

---

## Database

- **339 RLS policies** — every table is protected (84/84 tables)
- **229 migrations** — incremental, ordered by timestamp
- **3 storage buckets** — employee-documents, invoices, vision-ia-documents
- **Key RPC functions:**
  - `get_my_permissions_v2(_establishment_id)` — RBAC
  - `has_module_access(_module_key, _min_level, _establishment_id)` — edge function RBAC
  - `is_admin(_user_id)` — admin check (legacy, prefer has_module_access)
  - `admin_exists()` — bootstrap check
  - `get_service_day_now(_establishment_id)` — current service day
  - `increment_counted_products(p_session_id)` — inventory counter

---

## When In Doubt

1. Check if an SSOT exists for what you're building (Section: Critical Rules #1)
2. Check `docs/AUDIT.md` for known issues
3. Check `docs/TASKS.md` for planned improvements
4. Follow the edge function security pattern (Section: Critical Rules #3)
5. Never bypass RLS — if you need service role access, use an edge function
6. Keep modules independent — import through `index.ts` only

# Audit Agent 05: Architecture & Code Quality

## Mission
Audit module structure, barrel exports, deep imports, file sizes, code organization, and architectural consistency.

## Weight: 10%

## Checklist

### 5.1 Module Structure
```bash
ls -d src/modules/*/
```
- Each module is a domain boundary
- Module count reasonable for app size

### 5.2 Barrel Exports (CRITICAL)
```bash
for d in src/modules/*/; do
  mod=$(basename "$d")
  [ ! -f "$d/index.ts" ] && echo "❌ NO BARREL: $mod"
done
echo "✅ Check complete"
```
- **Every module MUST have index.ts** → missing = 🟡 HIGH

### 5.3 Deep Import Violations
```bash
grep -rn 'from "@/modules/[^"]*/[^"]*/' src/ --include="*.ts" --include="*.tsx" | grep -v "index\|types\|test\|spec\|__tests__" | wc -l
```
- 0 = perfect
- Any deep import = 🟠 MEDIUM (breaks encapsulation)
- List each violation

### 5.4 File Size Analysis
```bash
find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | head -15
```
- Files > 800 lines = 🟠 MEDIUM (consider decomposition)
- Files > 1200 lines = 🟡 HIGH
- Auto-generated files (types.ts) exempt

### 5.5 Total Codebase Size
```bash
echo "Frontend:" && find src \( -name "*.ts" -o -name "*.tsx" \) -exec cat {} + | wc -l
echo "Edge functions:" && find supabase/functions -name "*.ts" -exec cat {} + | wc -l
echo "Migrations:" && find supabase/migrations -name "*.sql" -exec cat {} + | wc -l
echo "Tests:" && find src tests -name "*.test.*" -o -name "*.spec.*" 2>/dev/null | xargs cat 2>/dev/null | wc -l
```
- Track growth between audits

### 5.6 Circular Dependencies
```bash
# Check for potential circular imports between modules
for mod in src/modules/*/; do
  modname=$(basename "$mod")
  imports=$(grep -rh "from \"@/modules/" "$mod" --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "$modname" | grep -o "@/modules/[^/\"]*" | sort -u)
  if [ -n "$imports" ]; then
    echo "$modname imports: $imports"
  fi
done
```
- Circular A→B→A = 🟡 HIGH
- One-way dependencies = OK

### 5.7 Shared Utilities
```bash
ls supabase/functions/_shared/
wc -l supabase/functions/_shared/*.ts
```
- Edge function shared code properly factored
- No duplication between functions

### 5.8 Type Safety
```bash
grep -rn "as any\|@ts-ignore\|@ts-expect-error\|@ts-nocheck" src/ --include="*.ts" --include="*.tsx" | grep -v "test\|spec\|__tests__" | wc -l
```
- 0 = perfect, <5 = OK, >10 = 🟠 MEDIUM

### 5.9 Naming Conventions
- Components: PascalCase
- Hooks: useXxx
- Services: xxxService.ts
- Types: xxxTypes.ts or types.ts
- Constants: UPPER_CASE

### 5.10 Documentation
```bash
find docs -name "*.md" | wc -l
ls docs/*.md
```
- Architecture docs present
- API documentation
- Setup instructions

## Scoring Guide
| Score | Criteria |
|-------|----------|
| 10 | All barrels, 0 deep imports, no huge files, clean module boundaries |
| 8-9 | Minor file size issues, all barrels present |
| 7 | Some deep imports, a few large files |
| 5-6 | Missing barrels, significant deep imports |
| <5 | No module structure, circular deps |

# Audit Agent 01: Build & Compilation

## Mission
Verify the project builds cleanly with zero errors. This is the **gate-keeper** — if build fails, NOTHING ships.

## Weight: 15%

## Checklist (run ALL commands, report exact output)

### 1.1 TypeScript Compilation
```bash
npx tsc --noEmit 2>&1
echo "EXIT CODE: $?"
```
- **PASS**: Exit code 0, no output
- **FAIL**: Any type error → 🔴 CRITICAL (blocks deploy)

### 1.2 Vite Production Build
```bash
npm run build 2>&1
```
- **PASS**: "✓ built in Xs" with no errors
- **FAIL**: Any build error → 🔴 CRITICAL
- Note build time (>15s = 🟠 MEDIUM concern)
- Note total module count

### 1.3 ESLint — Errors
```bash
npx eslint src/ 2>&1 | tail -5
```
- **PASS**: "0 errors" (warnings acceptable)
- **FAIL**: Any error → 🔴 CRITICAL (lint errors = potential runtime bugs)
- Count warnings: >100 = 🟡 HIGH, >50 = 🟠 MEDIUM, >20 = 🔵 LOW

### 1.4 ESLint — Warning Breakdown
```bash
npx eslint src/ --max-warnings 9999 2>&1 | grep "warning" | awk -F'  ' '{print $NF}' | sort | uniq -c | sort -rn | head -10
```
- Report top warning categories

### 1.5 TypeScript Strict Mode
```bash
grep -E '"strict"|"noImplicitAny"|"strictNullChecks"' tsconfig.json tsconfig.app.json
```
- **PASS**: All three enabled
- **FAIL**: Any missing → 🟡 HIGH

### 1.6 `as any` Casts
```bash
grep -rn "as any" src/ --include="*.ts" --include="*.tsx" | grep -v "test\|spec\|__tests__" | wc -l
```
- 0 = perfect, 1-5 = 🔵 LOW, 6-15 = 🟠 MEDIUM, >15 = 🟡 HIGH
- List each occurrence with file:line

### 1.7 Console Statements in Production Code
```bash
grep -rn "console\.\(log\|error\|warn\)" src/ --include="*.ts" --include="*.tsx" | grep -v "test\|spec\|__tests__\|import.meta.env.DEV" | wc -l
```
- 0-20 = OK, 21-100 = 🟠 MEDIUM, >100 = 🟡 HIGH

### 1.8 Uncommitted Changes
```bash
git status --short | wc -l
git status --short | head -20
```
- 0 = perfect
- Any modified files = 🟡 HIGH (deployed code doesn't match repo)
- Untracked artifacts (PDFs, screenshots) = 🔵 LOW if in .gitignore

### 1.9 Package.json Integrity
```bash
node -e "const p=require('./package.json');console.log('engines:', JSON.stringify(p.engines));console.log('deps:', Object.keys(p.dependencies).length, 'devDeps:', Object.keys(p.devDependencies).length)"
```
- Check `engines.node` is set
- Check for suspicious dependency counts

### 1.10 Vercel Config
```bash
cat vercel.json
```
- SPA rewrite rule present
- Build command set
- Output directory correct

## Scoring Guide
| Score | Criteria |
|-------|----------|
| 10 | Zero TS errors, zero lint errors, zero warnings, strict mode, <5 as any, <20 console |
| 9 | Zero errors, <50 warnings, strict mode |
| 8 | Zero errors, <100 warnings, some as any |
| 7 | Zero errors, >100 warnings |
| 5-6 | Build passes but lint/type issues |
| <5 | Build fails or critical type errors |

## Output Format
```markdown
# Build & Compilation Audit — [DATE]
## Score: X/10
## Summary: [one sentence]
## Details:
[for each check: PASS/FAIL + evidence]
## Issues Found:
[severity + description + recommended fix]
## Strengths:
[what's good]
```

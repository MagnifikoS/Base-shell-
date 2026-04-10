# Audit Agent 06: Tests & Coverage

## Mission
Audit test suite health, coverage, CI pipeline, and regression prevention capability. This agent's score directly reflects confidence in shipping without breaking things.

## Weight: 15%

## Checklist

### 6.1 Test Suite Execution (CRITICAL)
```bash
npx vitest run 2>&1 | tail -15
```
- **ALL tests MUST pass** → any failure = 🔴 CRITICAL
- Note: test count, duration, pass/fail breakdown

### 6.2 Test Count & Distribution
```bash
echo "Test files in src/:" && find src -name "*.test.*" -o -name "*.spec.*" | wc -l
echo "Test files in tests/:" && find tests -name "*.test.*" -o -name "*.spec.*" | wc -l
echo "Total test cases:" && npx vitest run 2>&1 | grep "Tests" | tail -1
```
- Track growth between audits
- More tests = higher confidence

### 6.3 Coverage Thresholds
```bash
grep -A6 "thresholds" vitest.config.ts
```
- `lines: ≥30` = minimum acceptable
- `functions: ≥25` = minimum acceptable
- Critical modules (payroll, stock, presence): should be ≥60%
- Thresholds < 20% → 🟡 HIGH

### 6.4 Coverage Report (Critical Modules)
```bash
npx vitest run --coverage 2>&1 | grep -E "payroll|stock|presence|badge|planning" | head -20
```
- Key business logic modules should have highest coverage
- 0% coverage on critical module → 🔴 CRITICAL

### 6.5 E2E Tests
```bash
find tests/e2e -name "*.spec.*" | wc -l
find tests/e2e -name "*.spec.*" | xargs grep -c "test(\|it(" 2>/dev/null | awk -F: '{sum+=$2} END {print sum, "e2e test cases"}'
```
- E2E tests exist for critical flows
- Auth, navigation, error handling covered

### 6.6 Security Tests
```bash
find tests/security -name "*.test.*" | wc -l
```
- Red team (attack) tests
- Blue team (defense) tests

### 6.7 CI Pipeline
```bash
cat .github/workflows/ci.yml | grep -E "name:|run:" | head -30
```
- Jobs: lint, typecheck, test, security, e2e
- All jobs run on PR and push to main
- Tests block merge on failure

### 6.8 Test Quality Indicators
```bash
# Check for test anti-patterns
echo "Skip/todo:" && grep -rn "\.skip\|\.todo\|xit(\|xdescribe(" src/ tests/ --include="*.test.*" --include="*.spec.*" 2>/dev/null | wc -l
echo "Only:" && grep -rn "\.only" src/ tests/ --include="*.test.*" --include="*.spec.*" 2>/dev/null | wc -l
```
- `.only` in committed code → 🔴 CRITICAL (skips other tests)
- `.skip`/`.todo` > 10 → 🟠 MEDIUM (dead tests)

### 6.9 Test Execution Speed
- < 15s = excellent
- 15-30s = good
- 30-60s = 🟠 MEDIUM (slow)
- > 60s = 🟡 HIGH (too slow for CI)

### 6.10 Flaky Test Detection
```bash
# Run tests twice and compare
npx vitest run 2>&1 | grep -E "passed|failed" | tail -3
```
- Same result both times = stable
- Different results = flaky → 🟡 HIGH

## Scoring Guide
| Score | Criteria |
|-------|----------|
| 10 | 100% pass, >2000 tests, coverage ≥30%, E2E in CI, <15s, no skips |
| 8-9 | 100% pass, >1000 tests, coverage ≥20%, E2E exists |
| 7 | 100% pass, >500 tests, some coverage |
| 5-6 | Some failures, low coverage |
| <5 | Multiple failures, no coverage thresholds |

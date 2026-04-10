# Audit Agent 08: Edge Functions & Backend

## Mission
Audit all Supabase Edge Functions for correctness, error handling, logging, and deployment status.

## Weight: 5%

## Checklist

### 8.1 Edge Function Deployment Status
```bash
supabase functions list --project-ref [PROJECT_REF] 2>&1 | head -40
```
- All functions ACTIVE
- No stale/orphaned functions

### 8.2 Edge Function Health (Live Test)
```bash
# Test each function responds (not 500/502)
BASE="https://[SUPABASE_URL]/functions/v1"
for fn in health-check planning-week employees badge-events absence-declaration payroll-daily-cost; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/$fn" -X OPTIONS 2>/dev/null)
  echo "$fn: HTTP $code"
done
```
- All return 200 on OPTIONS (CORS preflight)
- 500/502 → 🔴 CRITICAL

### 8.3 Error Handling Pattern
For each edge function, verify:
```bash
for f in supabase/functions/*/index.ts; do
  fn=$(basename $(dirname $f))
  try_catch=$(grep -c "try\|catch" "$f")
  json_error=$(grep -c "error.*JSON\|JSON.*error\|status.*[45]" "$f")
  echo "$fn: try/catch=$try_catch error_responses=$json_error"
done | head -20
```
- Every function uses try/catch
- Errors return JSON with `{ error: string }` not raw exceptions
- Proper HTTP status codes (400, 401, 403, 500)

### 8.4 Structured Logging
```bash
grep -l "createLogger\|log\.\(info\|warn\|error\)" supabase/functions/*/index.ts | wc -l
```
- All functions use `createLogger` from `_shared/logger.ts`
- Not raw `console.log`

### 8.5 Input Validation
```bash
for f in supabase/functions/*/index.ts; do
  fn=$(basename $(dirname $f))
  validation=$(grep -c "typeof\|required\|missing\|invalid\|!body\.\|!.*body" "$f")
  echo "$fn: validation_checks=$validation"
done | sort -t= -k2 -rn | head -20
```
- All user inputs validated before processing
- Missing validation → 🟡 HIGH

### 8.6 Response Times (Cold Start)
```bash
TOKEN="[auth_token]"
for fn in planning-week employees badge-events; do
  time=$(curl -s -o /dev/null -w "%{time_total}" "$BASE/$fn" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -d '{}')
  echo "$fn: ${time}s"
done
```
- < 1s = excellent
- 1-3s = acceptable (cold start)
- > 5s = 🟡 HIGH

### 8.7 Shared Code Quality
```bash
ls supabase/functions/_shared/
wc -l supabase/functions/_shared/*.ts
```
- CORS, rate limiting, logging, auth in shared
- No duplicated logic across functions

### 8.8 Environment Variables
```bash
cat .env.example | grep -v "^#" | grep -v "^$"
```
- All required env vars documented
- Sensitive vars marked as "set in Supabase dashboard"

## Scoring Guide
| Score | Criteria |
|-------|----------|
| 10 | All functions deployed, healthy, proper error handling, logging, <1s response |
| 8-9 | Minor logging gaps, all else solid |
| 7 | Some missing validation, cold start issues |
| 5-6 | Functions returning 500, missing error handling |
| <5 | Functions not deployed or broken |

# Audit Agent 02: Security

## Mission
Audit authentication, authorization, data protection, secrets management, and web security. This is the **highest-weighted** agent — security issues can sink the product.

## Weight: 20%

## Checklist

### 2.1 Edge Function Authentication
For EVERY edge function in `supabase/functions/*/index.ts`:
```bash
for f in supabase/functions/*/index.ts; do
  fn=$(basename $(dirname $f))
  auth=$(grep -c "Authorization\|requireAuth\|getUser\|Bearer\|timingSafeEqual\|hashToken" "$f")
  rate=$(grep -c "rateLimit\|checkRateLimit" "$f")
  echo "$fn: auth=$auth rate=$rate"
done
```
- Every function MUST have auth OR a justified exception (health-check, accept-invitation with token, bootstrap with secret)
- Every function MUST have rate limiting
- **Missing auth** → 🔴 CRITICAL
- **Missing rate limiting** → 🟡 HIGH

### 2.2 CORS Configuration
```bash
cat supabase/functions/_shared/cors.ts
```
- Check allowed origins list
- `*` is acceptable ONLY if all functions have JWT auth
- Verify `Access-Control-Allow-Headers` includes required headers
- Test CORS preflight from staging:
```bash
curl -s -D - "https://[SUPABASE_URL]/functions/v1/health-check" -X OPTIONS \
  -H "Origin: https://restaurantosstaging.vercel.app" 2>&1 | grep "access-control"
```

### 2.3 Secrets Management
```bash
# Check no secrets in frontend code
grep -rn "sk-\|service_role\|SERVICE_ROLE\|EMPLOYEE_DATA_KEY\|BOOTSTRAP_SECRET" src/ --include="*.ts" --include="*.tsx" | grep -v "test\|spec\|\.env\|example\|comment"
```
- **Any match** → 🔴 CRITICAL

```bash
# Check .env doesn't contain secrets
cat .env | grep -v "^#" | grep -v "^$"
```
- Only `VITE_*` vars should be here (safe for frontend)
- Service role keys MUST NOT be in .env

### 2.4 XSS Protection
```bash
grep -rn "dangerouslySetInnerHTML\|innerHTML\|outerHTML\|eval(" src/ --include="*.ts" --include="*.tsx" | grep -v "test\|spec\|node_modules"
```
- `dangerouslySetInnerHTML` in vendor UI components = 🔵 LOW
- Any custom code using these = 🔴 CRITICAL

### 2.5 CSP & Security Headers
```bash
grep "Content-Security-Policy\|X-Frame-Options\|X-Content-Type-Options" index.html
```
- CSP present with `frame-ancestors 'none'`
- X-Frame-Options: DENY
- `unsafe-eval` in CSP = 🟠 MEDIUM (needed for Vite, document why)

### 2.6 RLS Coverage
```bash
grep -l "ENABLE ROW LEVEL SECURITY" supabase/migrations/*.sql | wc -l
grep -c "CREATE POLICY" supabase/migrations/*.sql
```
- Every table with user data MUST have RLS
- Count policies vs tables

### 2.7 Data Encryption
```bash
grep -l "encrypt\|decrypt\|AES\|EMPLOYEE_DATA_KEY\|PBKDF2" supabase/functions/*/index.ts
```
- Sensitive employee data (IBAN, SSN) MUST be encrypted
- Verify encryption key derivation (PBKDF2 preferred)

### 2.8 Audit Logging
```bash
grep -l "audit_log" supabase/migrations/*.sql | wc -l
grep "immutab\|trigger.*audit\|anonymi" supabase/migrations/*.sql | wc -l
```
- Audit log table exists with RLS
- Immutability trigger present
- GDPR anonymization path exists

### 2.9 Supabase Client
```bash
cat src/integrations/supabase/client.ts
```
- Only anon key used (NEVER service_role)
- `persistSession: true` for auth persistence

### 2.10 Frontend Route Protection
```bash
grep -c "ProtectedRoute\|RequireAuth" src/routes/AppRoutes.tsx
```
- All authenticated routes behind ProtectedRoute

## Scoring Guide
| Score | Criteria |
|-------|----------|
| 10 | All functions auth'd + rate-limited, no secrets exposed, CSP, RLS everywhere, encryption, audit logs |
| 8-9 | Minor CSP gaps, all else solid |
| 7 | Some rate limiting gaps, CSP issues |
| 5-6 | Missing auth on non-trivial functions |
| <5 | Secrets exposed or critical auth gaps |

## Output Format
```markdown
# Security Audit — [DATE]
## Score: X/10
## Summary: [one sentence]
## Edge Function Auth Matrix:
[table: function | auth | rate-limit | status]
## Issues Found:
[severity + description + recommended fix]
## Strengths:
[what's good]
```

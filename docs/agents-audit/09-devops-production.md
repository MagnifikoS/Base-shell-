# Audit Agent 09: DevOps & Production Readiness

## Mission
Audit CI/CD, deployment config, monitoring, and operational readiness for production.

## Weight: 5%

## Checklist

### 9.1 CI/CD Pipeline
```bash
cat .github/workflows/ci.yml | grep -E "name:|jobs:" | head -20
```
- Jobs: lint, typecheck, test, security tests, E2E
- Triggers: push to main + PRs
- Tests block merge on failure

### 9.2 Vercel Deployment Config
```bash
cat vercel.json
```
- Framework: vite
- SPA rewrite rule present
- Build command correct
- Output directory correct
- Install command handles lifecycle scripts

### 9.3 Pre-commit Hooks
```bash
ls .husky/
cat .husky/pre-commit 2>/dev/null
grep "lint-staged" package.json | head -3
```
- Husky installed with pre-commit hook
- lint-staged runs on staged files

### 9.4 Node Version
```bash
node -e "const p=require('./package.json');console.log('engines:', JSON.stringify(p.engines))"
node --version
```
- `engines.node` specified in package.json
- Current node version matches

### 9.5 Environment Configuration
```bash
cat .env.example
grep "VITE_" .env | wc -l
```
- `.env.example` documents all required vars
- No secrets in `.env` (only VITE_ vars)
- Comments explain each var

### 9.6 Monitoring & Alerting
```bash
grep -rn "Sentry\|sentry" src/main.tsx | head -5
grep "dsn:" src/main.tsx
```
- Sentry configured with DSN
- Error tracking enabled
- Uptime monitoring configured (external service)

### 9.7 Health Check
```bash
curl -s "https://[SUPABASE_URL]/functions/v1/health-check" | head -1
```
- Health check endpoint returns OK
- Should be monitored by external service

### 9.8 Git Hygiene
```bash
git log --oneline -10
git status --short | wc -l
cat .gitignore | tail -10
```
- Descriptive commit messages
- No untracked artifacts
- .gitignore covers: .env.local, node_modules, dist, .agent-results, PDFs, screenshots

### 9.9 Documentation
```bash
ls docs/*.md | head -15
```
- Setup/deployment docs exist
- Architecture docs exist
- Runbook for incidents

### 9.10 Staging vs Production Parity
```bash
# Check if staging uses staging Supabase (not production)
git show HEAD:.env | head -3
```
- Staging Vercel → staging Supabase
- Production Vercel → production Supabase
- Never cross-wired

## Scoring Guide
| Score | Criteria |
|-------|----------|
| 10 | Full CI/CD, Sentry, health monitoring, pre-commit hooks, proper env setup, staging parity |
| 8-9 | Missing external monitoring, all else solid |
| 7 | CI/CD works, some gaps in monitoring/docs |
| 5-6 | No E2E in CI, missing env docs |
| <5 | No CI/CD, broken deployment |

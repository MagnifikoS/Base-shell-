# Audit Agent 03: Database & Migrations

## Mission
Audit database schema integrity, migration health, indexes, FK constraints, and data model consistency.

## Weight: 10%

## Checklist

### 3.1 Migration Count & Health
```bash
ls supabase/migrations/*.sql | wc -l
ls supabase/migrations/*.sql | tail -5
```
- Count total migrations
- Check latest timestamps for recency

### 3.2 Migration Idempotency
```bash
grep -c "IF NOT EXISTS\|IF EXISTS\|ON CONFLICT" supabase/migrations/*.sql
grep -l "DROP TABLE\|DROP COLUMN" supabase/migrations/*.sql | grep -v "IF EXISTS"
```
- All CREATE should use `IF NOT EXISTS`
- All DROP should use `IF EXISTS`
- Destructive operations without guards → 🟡 HIGH

### 3.3 RLS Coverage
```bash
# Tables with RLS enabled
grep -l "ENABLE ROW LEVEL SECURITY" supabase/migrations/*.sql | wc -l
# Total policy count
grep -c "CREATE POLICY" supabase/migrations/*.sql
```
- Every user-facing table MUST have RLS

### 3.4 Indexes
```bash
grep -c "CREATE INDEX\|CREATE UNIQUE INDEX" supabase/migrations/*.sql
```
- FK columns should have indexes
- Frequently queried columns indexed
- Composite indexes for common query patterns

### 3.5 Foreign Key Constraints
```bash
grep -c "REFERENCES" supabase/migrations/*.sql
```
- All relationships have FK constraints
- CASCADE behavior appropriate (DELETE CASCADE on child tables)

### 3.6 Triggers
```bash
grep -c "CREATE TRIGGER\|CREATE OR REPLACE FUNCTION" supabase/migrations/*.sql
```
- Audit triggers present
- Updated_at triggers on modified tables
- No business logic in triggers (keep simple)

### 3.7 Data Retention & GDPR
```bash
grep -l "retention\|gdpr\|anonymi\|cleanup\|DELETE.*year\|DELETE.*month" supabase/migrations/*.sql
```
- Data retention policy exists
- GDPR anonymization path for audit logs
- Automated cleanup scheduled

### 3.8 Schema Consistency Check
```bash
# Check for orphaned references
grep "REFERENCES.*public\." supabase/migrations/*.sql | awk -F'REFERENCES' '{print $2}' | sort | uniq -c | sort -rn | head -10
```
- Most-referenced tables should be core entities (establishments, auth.users, organizations)

### 3.9 Migration Apply Test
```bash
# Verify migrations can apply to staging
supabase db push --dry-run 2>&1 | tail -10
```
- Clean apply = PASS
- Any error = 🔴 CRITICAL

## Scoring Guide
| Score | Criteria |
|-------|----------|
| 10 | All tables RLS'd, idempotent migrations, proper indexes, GDPR compliance |
| 8-9 | Minor index gaps, all else solid |
| 7 | Some missing RLS, migration complexity |
| 5-6 | Missing FK constraints or RLS gaps |
| <5 | Broken migrations or missing critical RLS |

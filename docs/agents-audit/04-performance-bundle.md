# Audit Agent 04: Performance & Bundle

## Mission
Audit bundle size, code splitting, lazy loading, caching strategy, and runtime performance patterns.

## Weight: 10%

## Checklist

### 4.1 Bundle Size Analysis
```bash
npm run build 2>&1 | grep "gzip:" | awk -F'gzip:' '{print $2, $1}' | sort -rn | head -15
du -sh dist/
```
- Total dist < 8 MB = OK, > 10 MB = 🟡 HIGH
- No single chunk > 150 KB gzip (except vendor libs)
- Identify chunks that could be lazy-loaded

### 4.2 Lazy Loading Routes
```bash
grep -c "lazy(" src/routes/AppRoutes.tsx
```
- All page-level routes should be lazy-loaded
- >30 lazy routes = good for large app

### 4.3 Code Splitting Effectiveness
```bash
npm run build 2>&1 | grep "gzip:" | wc -l
```
- Count of output chunks
- More chunks = better splitting (>50 = good)
- Check for "god chunks" (>200 KB gzip)

### 4.4 Vendor Bundle Separation
```bash
npm run build 2>&1 | grep "vendor-" | head -10
```
- Heavy vendors (recharts, pdf, sentry) in separate chunks
- Not bundled with application code

### 4.5 React Performance Patterns
```bash
echo "React.memo:" && grep -rn "React.memo\|memo(" src/ --include="*.tsx" | grep -v "test\|spec" | wc -l
echo "useMemo:" && grep -rn "useMemo" src/ --include="*.ts" --include="*.tsx" | grep -v "test\|spec" | wc -l
echo "useCallback:" && grep -rn "useCallback" src/ --include="*.ts" --include="*.tsx" | grep -v "test\|spec" | wc -l
```
- memo, useMemo, useCallback used appropriately
- List components > 500 lines that lack memo

### 4.6 Query Caching Strategy
```bash
cat src/lib/queryClient.ts
grep -c "staleTime\|gcTime\|cacheTime" src/ -r --include="*.ts" --include="*.tsx"
```
- Default staleTime set (>30s)
- gcTime reasonable (5-15 min)
- refetchOnWindowFocus disabled if realtime handles updates
- Count of custom staleTime overrides

### 4.7 Realtime Channels
```bash
find src/hooks/realtime -name "*.ts" | wc -l
```
- Channels decomposed (not monolith)
- No duplicate subscriptions

### 4.8 Image/Asset Optimization
```bash
find public -name "*.png" -o -name "*.jpg" -o -name "*.svg" | xargs du -sh 2>/dev/null | sort -rn | head -10
```
- No oversized images (>500 KB)
- SVGs used where possible

### 4.9 CSS Size
```bash
npm run build 2>&1 | grep "\.css" | head -5
```
- Single CSS file < 30 KB gzip = excellent
- Tailwind purging working correctly

### 4.10 Largest Application Chunks
```bash
npm run build 2>&1 | grep "gzip:" | grep -v "vendor-\|node_modules" | awk -F'gzip:' '{print $2, $1}' | sort -rn | head -10
```
- Application chunks (non-vendor) should be < 50 KB gzip each
- Flag any > 100 KB as 🟡 HIGH

## Scoring Guide
| Score | Criteria |
|-------|----------|
| 10 | All routes lazy, no god chunks, <6 MB total, proper caching, >20 memo |
| 8-9 | Minor chunk optimization possible |
| 7 | Some large chunks, but lazy loading in place |
| 5-6 | Missing lazy loading on key routes, large bundles |
| <5 | No code splitting, >15 MB total |

# Audit Agent 07: UX/UI & Frontend

## Mission
Audit error handling, loading states, accessibility, responsive design, and user-facing quality. This agent thinks like a **user**, not a developer.

## Weight: 10%

## Checklist

### 7.1 Error Boundaries
```bash
grep -rn "ErrorBoundary" src/ --include="*.tsx" | grep -v "test\|spec\|__tests__" | wc -l
grep -rn "ErrorBoundary" src/routes/AppRoutes.tsx | head -10
```
- Global ErrorBoundary in App.tsx
- Per-section boundaries in route tree
- Error fallback shows useful message (not white screen)

### 7.2 Suspense Boundaries
```bash
grep -rn "<Suspense" src/ --include="*.tsx" | grep -v "test\|spec" | wc -l
```
- Lazy-loaded routes wrapped in Suspense
- Fallback shows loading indicator (not blank)

### 7.3 Loading States
```bash
echo "Skeleton:" && grep -rn "Skeleton" src/ --include="*.tsx" | grep -v "test\|spec\|node_modules\|ui/skeleton" | wc -l
echo "Loader/Spinner:" && grep -rn "Loader2\|Spinner\|isLoading" src/ --include="*.tsx" | grep -v "test\|spec" | wc -l
```
- Pages should show skeletons during data fetch
- No blank screens during loading
- Loading indicators on mutations

### 7.4 Toast Notifications
```bash
grep -rn "toast\.\(success\|error\|warning\|info\)" src/ --include="*.ts" --include="*.tsx" | grep -v "test\|spec" | wc -l
```
- Success toasts after mutations
- Error toasts with helpful messages (not raw error objects)
- No missing feedback on actions

### 7.5 Form Validation
```bash
grep -rn "zodResolver\|z\.object\|useForm\|react-hook-form" src/ --include="*.ts" --include="*.tsx" | grep -v "test\|spec" | wc -l
```
- Forms use Zod schemas for validation
- Validation errors shown inline
- Submit buttons disabled during submission

### 7.6 Accessibility
```bash
echo "aria:" && grep -rn "aria-" src/ --include="*.tsx" | grep -v "test\|spec\|node_modules\|ui/" | wc -l
echo "sr-only:" && grep -rn "sr-only" src/ --include="*.tsx" | grep -v "test\|spec\|ui/" | wc -l
echo "role:" && grep -rn 'role="' src/ --include="*.tsx" | grep -v "test\|spec\|ui/" | wc -l
```
- Interactive elements have aria labels
- Screen reader support for key actions
- Keyboard navigation works for modals

### 7.7 Responsive / Mobile
```bash
find src/components/mobile -name "*.tsx" | wc -l
grep -rn "md:\|lg:\|sm:" src/components/layout/AppLayout.tsx | wc -l
```
- Mobile-specific components exist
- Layout responsive with breakpoints
- Touch targets ≥ 44px on mobile

### 7.8 Offline Support
```bash
grep -rn "OfflineBanner\|navigator.onLine\|offline" src/ --include="*.ts" --include="*.tsx" | head -5
cat public/sw.js | head -20 2>/dev/null
```
- Offline detection banner
- Service worker for PWA
- Graceful degradation when offline

### 7.9 PWA Manifest
```bash
cat public/manifest.json | head -15
```
- App name, icons, theme color set
- `display: standalone`
- Start URL correct

### 7.10 Console Errors on Key Pages
**Navigate to each page and check browser console:**
- Dashboard: any errors?
- Planning: any errors?
- Salariés: any errors?
- Badgeuse: any errors?
- Inventaire: any errors?
- Factures: any errors?
- Paie: any errors?
- Vision AI: any errors?

**Each page with console errors** → 🟡 HIGH

### 7.11 Visual Consistency (Manual Check)
Navigate through the app and check:
- Consistent spacing and typography
- Dark mode works (if enabled)
- Tables align properly
- Modals/drawers open and close correctly
- No overlapping elements
- No clipped text

## Scoring Guide
| Score | Criteria |
|-------|----------|
| 10 | All pages error-free, full a11y, responsive, offline support, PWA, skeletons everywhere |
| 8-9 | Minor a11y gaps, all else solid |
| 7 | Some console errors, some missing loading states |
| 5-6 | Multiple console errors, poor mobile experience |
| <5 | White screens, broken layouts, no error handling |

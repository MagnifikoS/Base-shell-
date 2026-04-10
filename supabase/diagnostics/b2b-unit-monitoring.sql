-- ═══════════════════════════════════════════════════════════════════
-- B2B Unit Mapping — Monitoring Dashboard Query
-- ═══════════════════════════════════════════════════════════════════
-- Run periodically to check health of the B2B unit mapping system.
--
-- KPI 1: Mapping coverage (target: > 99%)
-- KPI 2: Fallback events (target: < 1%)
-- KPI 3: Suspicious qty events (target: 0)
-- ═══════════════════════════════════════════════════════════════════

-- ── KPI 1: Mapping coverage ──
SELECT
  COUNT(*) AS total_imports,
  COUNT(unit_mapping) AS mapped,
  COUNT(*) - COUNT(unit_mapping) AS missing,
  ROUND(COUNT(unit_mapping)::numeric / GREATEST(COUNT(*), 1) * 100, 2) AS coverage_pct
FROM b2b_imported_products;

-- ── KPI 2: Fallback rate (target: < 1%) ──
SELECT
  COUNT(*) FILTER (WHERE action = 'translation_ok') AS ok_count,
  COUNT(*) FILTER (WHERE action = 'fallback_used') AS fallback_count,
  COUNT(*) FILTER (WHERE action = 'mapping_miss') AS miss_count,
  COUNT(*) FILTER (WHERE action = 'suspicious_qty') AS suspicious_count,
  ROUND(
    COUNT(*) FILTER (WHERE action = 'fallback_used')::numeric /
    GREATEST(COUNT(*) FILTER (WHERE action IN ('translation_ok', 'fallback_used', 'mapping_miss')), 1) * 100, 2
  ) AS fallback_rate_pct
FROM brain_events
WHERE subject = 'b2b_unit_translation'
  AND created_at > NOW() - INTERVAL '7 days';

-- ── KPI 3: Events by action (last 7 days) ──
SELECT
  action,
  COUNT(*) AS event_count,
  MIN(created_at) AS first_seen,
  MAX(created_at) AS last_seen
FROM brain_events
WHERE subject = 'b2b_unit_translation'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY action
ORDER BY event_count DESC;

-- ── Detail: Recent fallback events (last 24h) ──
SELECT
  context->>'product_id' AS product_id,
  context->>'label' AS unit_label,
  action,
  created_at
FROM brain_events
WHERE subject = 'b2b_unit_translation'
  AND action IN ('fallback_used', 'mapping_miss', 'suspicious_qty')
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 20;

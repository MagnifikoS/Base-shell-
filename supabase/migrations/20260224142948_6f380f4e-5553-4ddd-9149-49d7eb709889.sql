
-- ═══════════════════════════════════════════════════════════════
-- 9.4 Fix: platform_list_establishment_users — aggregate ALL roles
-- 9.5 New: platform_list_modules — real data from modules table
-- ═══════════════════════════════════════════════════════════════

-- 9.4: Replace platform_list_establishment_users to return aggregated roles
CREATE OR REPLACE FUNCTION public.platform_list_establishment_users(_establishment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: not a platform admin';
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'full_name'), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'user_id', p.user_id,
      'full_name', COALESCE(p.full_name, ''),
      'email', COALESCE(p.email, ''),
      'status', COALESCE(p.status, 'active'),
      'role_name', string_agg(DISTINCT r.name, ', ' ORDER BY r.name),
      'role_names', jsonb_agg(DISTINCT r.name ORDER BY r.name)
    ) AS row_data
    FROM profiles p
    JOIN user_establishments ue ON ue.user_id = p.user_id
    LEFT JOIN user_roles ur ON ur.user_id = p.user_id AND ur.establishment_id = _establishment_id
    LEFT JOIN roles r ON r.id = ur.role_id
    WHERE ue.establishment_id = _establishment_id
    GROUP BY p.user_id, p.full_name, p.email, p.status
  ) sub;

  RETURN v_result;
END;
$function$;

-- 9.5: Create platform_list_modules RPC
CREATE OR REPLACE FUNCTION public.platform_list_modules()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: not a platform admin';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'key', m.key,
      'name', m.name,
      'description', m.description,
      'status', CASE WHEN m.is_active THEN 'active' ELSE 'inactive' END,
      'establishments_using', COALESCE(usage.est_count, 0),
      'organizations_using', COALESCE(usage.org_count, 0)
    ) ORDER BY m.name
  ), '[]'::jsonb)
  INTO v_result
  FROM modules m
  LEFT JOIN (
    SELECT
      rp.module_key,
      COUNT(DISTINCT ur.establishment_id) AS est_count,
      COUNT(DISTINCT e.organization_id) AS org_count
    FROM role_permissions rp
    JOIN user_roles ur ON ur.role_id = rp.role_id
    JOIN establishments e ON e.id = ur.establishment_id
    WHERE rp.access_level != 'none'
    GROUP BY rp.module_key
  ) usage ON usage.module_key = m.key;

  RETURN v_result;
END;
$function$;

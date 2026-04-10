
-- Add missing columns to modules table for platform module management
ALTER TABLE public.modules 
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS description text;
  
-- Recreate platform_list_modules to match actual schema
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
    ) ORDER BY m.display_order, m.name
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


-- ══════════════════════════════════════════════════════════════
-- P1: Platform read RPCs (SECURITY DEFINER, bypass RLS, check is_platform_admin)
-- 100% additive — no existing function/table modified
-- ══════════════════════════════════════════════════════════════

-- 1. List all organizations with stats
CREATE OR REPLACE FUNCTION public.platform_list_organizations()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.name), '[]'::jsonb)
    FROM (
      SELECT
        o.id,
        o.name,
        o.created_at,
        (SELECT count(*) FROM establishments e WHERE e.organization_id = o.id) AS establishment_count,
        (SELECT count(DISTINCT ue.user_id) FROM user_establishments ue 
         JOIN establishments e2 ON e2.id = ue.establishment_id 
         WHERE e2.organization_id = o.id) AS user_count
      FROM organizations o
    ) t
  );
END;
$$;

-- 2. List establishments for an org
CREATE OR REPLACE FUNCTION public.platform_list_establishments(_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.name), '[]'::jsonb)
    FROM (
      SELECT
        e.id,
        e.name,
        e.status,
        e.created_at,
        e.establishment_type,
        (SELECT count(*) FROM user_establishments ue WHERE ue.establishment_id = e.id) AS user_count
      FROM establishments e
      WHERE e.organization_id = _org_id
    ) t
  );
END;
$$;

-- 3. List users of an establishment with their role
CREATE OR REPLACE FUNCTION public.platform_list_establishment_users(_establishment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.full_name), '[]'::jsonb)
    FROM (
      SELECT DISTINCT ON (p.user_id)
        p.user_id,
        p.full_name,
        p.email,
        p.status,
        COALESCE(r.name, 'Aucun rôle') AS role_name
      FROM user_establishments ue
      JOIN profiles p ON p.user_id = ue.user_id
      LEFT JOIN user_roles ur ON ur.user_id = ue.user_id AND ur.establishment_id = _establishment_id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE ue.establishment_id = _establishment_id
      ORDER BY p.user_id, r.name
    ) t
  );
END;
$$;

-- 4. Platform KPIs
CREATE OR REPLACE FUNCTION public.platform_get_kpis()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN';
  END IF;

  RETURN jsonb_build_object(
    'total_organizations', (SELECT count(*) FROM organizations),
    'total_establishments', (SELECT count(*) FROM establishments),
    'total_users', (SELECT count(DISTINCT user_id) FROM user_establishments),
    'active_establishments', (SELECT count(*) FROM establishments WHERE status = 'active'),
    'suspended_establishments', (SELECT count(*) FROM establishments WHERE status = 'suspended')
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.platform_rename_organization(_org_id uuid, _new_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not a platform admin');
  END IF;

  IF _new_name IS NULL OR trim(_new_name) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Name cannot be empty');
  END IF;

  UPDATE organizations SET name = trim(_new_name), updated_at = now() WHERE id = _org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Organization not found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

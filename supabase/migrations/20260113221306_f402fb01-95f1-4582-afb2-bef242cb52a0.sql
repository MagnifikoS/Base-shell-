
-- Create test roles for risk-0 validation
DO $$
DECLARE
  v_org_id uuid;
  v_role_self uuid;
  v_role_estab uuid;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations LIMIT 1;

  -- Role: Test_Salaries_Read_Self (type = 'system' to pass check constraint)
  INSERT INTO public.roles (name, type, organization_id)
  VALUES ('Test_Salaries_Read_Self', 'system', v_org_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_role_self;

  IF v_role_self IS NULL THEN
    SELECT id INTO v_role_self FROM public.roles 
    WHERE name = 'Test_Salaries_Read_Self' AND organization_id = v_org_id;
  END IF;

  -- Role: Test_Salaries_Read_Establishment
  INSERT INTO public.roles (name, type, organization_id)
  VALUES ('Test_Salaries_Read_Establishment', 'system', v_org_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_role_estab;

  IF v_role_estab IS NULL THEN
    SELECT id INTO v_role_estab FROM public.roles 
    WHERE name = 'Test_Salaries_Read_Establishment' AND organization_id = v_org_id;
  END IF;

  -- Permissions for Test_Salaries_Read_Self
  INSERT INTO public.role_permissions (role_id, module_key, access_level, scope)
  VALUES (v_role_self, 'salaries', 'read', 'self')
  ON CONFLICT DO NOTHING;

  -- Permissions for Test_Salaries_Read_Establishment  
  INSERT INTO public.role_permissions (role_id, module_key, access_level, scope)
  VALUES (v_role_estab, 'salaries', 'read', 'establishment')
  ON CONFLICT DO NOTHING;
END $$;

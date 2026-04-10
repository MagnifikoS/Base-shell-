
-- Fix: Remove legacy duplicate before adding unique constraint
-- Migration 20260110122124 inserted ('utilisateurs', 'Utilisateurs')
-- Migration 20260110131109 inserted ('users', 'Utilisateurs')
-- Both have name='Utilisateurs' — delete the legacy one first
DELETE FROM public.modules WHERE key = 'utilisateurs' AND name = 'Utilisateurs';

-- Also clean up any role_permissions referencing the legacy key
DELETE FROM public.role_permissions WHERE module_key = 'utilisateurs';

-- Garde-fou 1 : UNIQUE sur modules.name pour empêcher deux modules avec le même nom affiché
ALTER TABLE public.modules ADD CONSTRAINT modules_name_unique UNIQUE (name);

-- Garde-fou 2 : CHECK constraint pour bloquer la clé 'utilisateurs' (legacy)
ALTER TABLE public.modules ADD CONSTRAINT modules_key_not_legacy 
CHECK (key != 'utilisateurs');

-- Garde-fou 3 : CHECK constraint sur role_permissions pour bloquer 'utilisateurs'
ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_module_key_not_legacy 
CHECK (module_key != 'utilisateurs');

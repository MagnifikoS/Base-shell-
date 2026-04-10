-- Étendre l'enum permission_scope avec les valeurs spécifiques au module caisse
ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'caisse_day';
ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'caisse_month';
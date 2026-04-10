-- Add early_arrival_limit_min to badgeuse_settings
-- This controls how early before shift start an employee can badge
-- If badge is within this limit: effective_at = planned_start (accepted)
-- If badge is before this limit: BADGE_TOO_EARLY error (rejected)

ALTER TABLE public.badgeuse_settings 
ADD COLUMN early_arrival_limit_min INTEGER NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.badgeuse_settings.early_arrival_limit_min IS 
'Maximum minutes before shift start that badge is accepted. Beyond this limit, badge is rejected with BADGE_TOO_EARLY.';
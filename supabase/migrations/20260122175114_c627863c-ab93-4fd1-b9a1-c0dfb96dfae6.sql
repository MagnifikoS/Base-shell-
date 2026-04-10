-- Add explicit RLS policies for user_badge_pins (fix linter: RLS enabled, no policy)

ALTER TABLE public.user_badge_pins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own badge pin" ON public.user_badge_pins;
CREATE POLICY "Users can view own badge pin"
ON public.user_badge_pins
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own badge pin" ON public.user_badge_pins;
CREATE POLICY "Users can insert own badge pin"
ON public.user_badge_pins
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own badge pin" ON public.user_badge_pins;
CREATE POLICY "Users can update own badge pin"
ON public.user_badge_pins
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own badge pin" ON public.user_badge_pins;
CREATE POLICY "Users can delete own badge pin"
ON public.user_badge_pins
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Extend personnel_leaves CHECK to include 'am'
ALTER TABLE public.personnel_leaves DROP CONSTRAINT IF EXISTS personnel_leaves_type_check;
ALTER TABLE public.personnel_leaves ADD CONSTRAINT personnel_leaves_type_check
  CHECK (leave_type = ANY (ARRAY['absence','cp','rest','am']));

-- Extend personnel_leave_requests CHECK to include 'am'
ALTER TABLE public.personnel_leave_requests DROP CONSTRAINT IF EXISTS personnel_leave_requests_type_check;
ALTER TABLE public.personnel_leave_requests ADD CONSTRAINT personnel_leave_requests_type_check
  CHECK (leave_type = ANY (ARRAY['absence','cp','am']));
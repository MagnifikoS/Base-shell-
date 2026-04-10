-- Add 'rest' leave type to personnel_leaves constraint
ALTER TABLE personnel_leaves
DROP CONSTRAINT IF EXISTS personnel_leaves_type_check;

ALTER TABLE personnel_leaves
ADD CONSTRAINT personnel_leaves_type_check
CHECK (leave_type IN ('absence', 'cp', 'rest'));
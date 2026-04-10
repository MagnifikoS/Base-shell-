CREATE TABLE IF NOT EXISTS public._migration_id_map (
  old_id UUID NOT NULL,
  new_id UUID NOT NULL DEFAULT gen_random_uuid(),
  tbl TEXT NOT NULL,
  PRIMARY KEY (old_id, tbl)
);
ALTER TABLE public._migration_id_map ENABLE ROW LEVEL SECURITY;
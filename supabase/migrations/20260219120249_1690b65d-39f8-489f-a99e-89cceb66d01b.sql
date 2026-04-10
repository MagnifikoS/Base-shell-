
-- Ajouter une vraie contrainte unique sur (establishment_id, idempotency_key)
-- pour que le ON CONFLICT du CRON fonctionne.
-- On exclut les NULL car PostgreSQL ne les inclut pas dans les contraintes UNIQUE,
-- mais on a besoin que les non-NULL soient uniques par établissement.
ALTER TABLE public.pay_payments
  ADD CONSTRAINT pay_payments_estab_idempotency_key 
  UNIQUE (establishment_id, idempotency_key);

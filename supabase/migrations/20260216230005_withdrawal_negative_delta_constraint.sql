-- STK-LED-023: Enforce WITHDRAWAL events always have negative delta_quantity_canonical
-- This prevents data integrity issues where a WITHDRAWAL could accidentally add stock.

ALTER TABLE public.stock_events
  ADD CONSTRAINT chk_withdrawal_negative_delta
  CHECK (
    event_type <> 'WITHDRAWAL'
    OR delta_quantity_canonical < 0
  );

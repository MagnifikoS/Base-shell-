
-- Prevent duplicate categories per establishment
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_categories_establishment_name 
ON product_categories (establishment_id, name) 
WHERE is_archived = false;

-- Ajouter le statut ABANDONED à l'enum stock_document_status
-- Utilisé pour les DRAFTs orphelins/déplacés — jamais pour des documents avec events
ALTER TYPE stock_document_status ADD VALUE IF NOT EXISTS 'ABANDONED';
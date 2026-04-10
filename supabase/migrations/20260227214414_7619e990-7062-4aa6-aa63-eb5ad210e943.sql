
-- Clean orphan DRAFT a94c55ea only (no guards on bl_withdrawal_lines)
DELETE FROM bl_withdrawal_lines WHERE bl_withdrawal_document_id = '98b6e4cd-ce3a-46f0-a257-84a71734bb8d';
DELETE FROM bl_withdrawal_documents WHERE id = '98b6e4cd-ce3a-46f0-a257-84a71734bb8d';
DELETE FROM stock_document_lines WHERE document_id = 'a94c55ea-3c0b-4cdf-9962-0902f544194e';
DELETE FROM stock_documents WHERE id = 'a94c55ea-3c0b-4cdf-9962-0902f544194e' AND status = 'DRAFT';

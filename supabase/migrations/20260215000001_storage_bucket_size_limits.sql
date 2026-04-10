-- STORAGE-01: Set file_size_limit on all storage buckets to prevent
-- arbitrarily large uploads. Limits aligned with application constraints.

UPDATE storage.buckets SET file_size_limit = 10485760 WHERE id = 'employee-documents';
UPDATE storage.buckets SET file_size_limit = 10485760 WHERE id = 'invoices';
UPDATE storage.buckets SET file_size_limit = 6291456 WHERE id = 'vision-ia-documents';

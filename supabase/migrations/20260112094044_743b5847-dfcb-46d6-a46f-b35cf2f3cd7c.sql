-- ROLLBACK: Restore scope='org' for system Administrator role only
UPDATE role_permissions
SET scope = 'org'
WHERE role_id = (
  SELECT id FROM roles
  WHERE name = 'Administrateur'
  AND organization_id IS NULL
);
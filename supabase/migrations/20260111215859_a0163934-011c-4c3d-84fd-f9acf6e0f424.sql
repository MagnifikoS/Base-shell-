-- Neutralize 'org' scope: convert all existing 'org' to 'establishment'
UPDATE role_permissions SET scope = 'establishment' WHERE scope = 'org';
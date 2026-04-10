
-- SUPPLIER SIDE (Nonna Secret)
INSERT INTO products_v2 (id, establishment_id, nom_produit, name_normalized, code_produit, category,
  supplier_id, supplier_billing_unit, supplier_billing_unit_id, final_unit, final_unit_id,
  final_unit_price, stock_handling_unit_id, storage_zone_id)
VALUES
  ('a0000001-0e50-b2b0-0000-000000000001', '7775d89d-9977-4b1b-bf0c-1b2efe486000',
   '[TEST] TOMATE PELÉE', 'test tomate pelee', 'TEST-A01', 'Épicerie',
   '836f8d10-7225-4e08-a3a4-21e8d48f9ba7', 'kg', '09a320f0-c826-4234-b1d9-a30fd87508cf',
   'kg', '09a320f0-c826-4234-b1d9-a30fd87508cf', 2.50,
   '09a320f0-c826-4234-b1d9-a30fd87508cf', '3b238780-c718-4c90-a55c-788ef7f76142'),

  ('a0000001-0e50-b2b0-0000-000000000002', '7775d89d-9977-4b1b-bf0c-1b2efe486000',
   '[TEST] MOZZARELLA DI BUFALA', 'test mozzarella di bufala', 'TEST-B01', 'Frais',
   '836f8d10-7225-4e08-a3a4-21e8d48f9ba7', 'kg', '09a320f0-c826-4234-b1d9-a30fd87508cf',
   'kg', '09a320f0-c826-4234-b1d9-a30fd87508cf', 18.00,
   '09a320f0-c826-4234-b1d9-a30fd87508cf', 'a3f25e23-33b4-42d0-902d-b159b9653b2b'),

  ('a0000001-0e50-b2b0-0000-000000000003', '7775d89d-9977-4b1b-bf0c-1b2efe486000',
   '[TEST] HUILE OLIVE EXTRA VIERGE', 'test huile olive extra vierge', 'TEST-C01', 'Épicerie',
   '836f8d10-7225-4e08-a3a4-21e8d48f9ba7', 'L', '5d959707-b7cd-4a0b-81cb-c1fbcb11ac29',
   'L', '5d959707-b7cd-4a0b-81cb-c1fbcb11ac29', 8.50,
   '5d959707-b7cd-4a0b-81cb-c1fbcb11ac29', '3b238780-c718-4c90-a55c-788ef7f76142'),

  ('a0000001-0e50-b2b0-0000-000000000004', '7775d89d-9977-4b1b-bf0c-1b2efe486000',
   '[TEST] BASILIC FRAIS BOTTE', 'test basilic frais botte', 'TEST-D01', 'Frais',
   '836f8d10-7225-4e08-a3a4-21e8d48f9ba7', 'pce', '252649a4-3905-4e56-959e-f4735521fbf4',
   'pce', '252649a4-3905-4e56-959e-f4735521fbf4', 1.20,
   '252649a4-3905-4e56-959e-f4735521fbf4', 'a3f25e23-33b4-42d0-902d-b159b9653b2b'),

  ('a0000001-0e50-b2b0-0000-000000000005', '7775d89d-9977-4b1b-bf0c-1b2efe486000',
   '[TEST] FARINE TYPE 00', 'test farine type 00', 'TEST-E01', 'Épicerie',
   '836f8d10-7225-4e08-a3a4-21e8d48f9ba7', 'kg', '09a320f0-c826-4234-b1d9-a30fd87508cf',
   'kg', '09a320f0-c826-4234-b1d9-a30fd87508cf', 1.80,
   '09a320f0-c826-4234-b1d9-a30fd87508cf', '3b238780-c718-4c90-a55c-788ef7f76142'),

  ('a0000001-0e50-b2b0-0000-000000000006', '7775d89d-9977-4b1b-bf0c-1b2efe486000',
   '[TEST] PARMIGIANO REGGIANO 24M', 'test parmigiano reggiano 24m', 'TEST-F01', 'Frais',
   '836f8d10-7225-4e08-a3a4-21e8d48f9ba7', 'kg', '09a320f0-c826-4234-b1d9-a30fd87508cf',
   'kg', '09a320f0-c826-4234-b1d9-a30fd87508cf', 22.00,
   '09a320f0-c826-4234-b1d9-a30fd87508cf', 'a3f25e23-33b4-42d0-902d-b159b9653b2b'),

  ('a0000001-0e50-b2b0-0000-000000000007', '7775d89d-9977-4b1b-bf0c-1b2efe486000',
   '[TEST] PROSCIUTTO CRUDO', 'test prosciutto crudo', 'TEST-G01', 'Frais',
   '836f8d10-7225-4e08-a3a4-21e8d48f9ba7', 'kg', '09a320f0-c826-4234-b1d9-a30fd87508cf',
   'kg', '09a320f0-c826-4234-b1d9-a30fd87508cf', 35.00,
   '09a320f0-c826-4234-b1d9-a30fd87508cf', 'a3f25e23-33b4-42d0-902d-b159b9653b2b'),

  ('a0000001-0e50-b2b0-0000-000000000008', '7775d89d-9977-4b1b-bf0c-1b2efe486000',
   '[TEST] BURRATA PUGLIESE', 'test burrata pugliese', 'TEST-H01', 'Frais',
   '836f8d10-7225-4e08-a3a4-21e8d48f9ba7', 'pce', '252649a4-3905-4e56-959e-f4735521fbf4',
   'pce', '252649a4-3905-4e56-959e-f4735521fbf4', 4.50,
   '252649a4-3905-4e56-959e-f4735521fbf4', 'a3f25e23-33b4-42d0-902d-b159b9653b2b');

-- CLIENT SIDE (Magnifiko)
INSERT INTO products_v2 (id, establishment_id, nom_produit, name_normalized, code_produit, category,
  supplier_id, supplier_billing_unit, supplier_billing_unit_id, final_unit, final_unit_id,
  final_unit_price, stock_handling_unit_id, storage_zone_id)
VALUES
  ('b0000001-0e50-b2b0-0000-000000000001', 'e9c3dccf-bee3-46c0-b068-52e05c18d883',
   '[TEST] TOMATE PELÉE', 'test tomate pelee', 'TEST-A01', 'Épicerie',
   '884b3101-7908-4311-ba69-4af5f79c829b', 'kg', '0acf2a5f-5ea4-48c5-8fee-e91a587eab53',
   'kg', '0acf2a5f-5ea4-48c5-8fee-e91a587eab53', 2.50,
   '0acf2a5f-5ea4-48c5-8fee-e91a587eab53', '6b923a0c-4263-4cd2-b50e-5f8c849dc87c'),

  ('b0000001-0e50-b2b0-0000-000000000002', 'e9c3dccf-bee3-46c0-b068-52e05c18d883',
   '[TEST] MOZZARELLA DI BUFALA', 'test mozzarella di bufala', 'TEST-B01', 'Frais',
   '884b3101-7908-4311-ba69-4af5f79c829b', 'kg', '0acf2a5f-5ea4-48c5-8fee-e91a587eab53',
   'kg', '0acf2a5f-5ea4-48c5-8fee-e91a587eab53', 18.00,
   '0acf2a5f-5ea4-48c5-8fee-e91a587eab53', '2e9ef7ef-dff9-4a97-8fa8-decf5d20b91f'),

  ('b0000001-0e50-b2b0-0000-000000000003', 'e9c3dccf-bee3-46c0-b068-52e05c18d883',
   '[TEST] HUILE OLIVE EXTRA VIERGE', 'test huile olive extra vierge', 'TEST-C01', 'Épicerie',
   '884b3101-7908-4311-ba69-4af5f79c829b', 'L', 'be5d064e-9860-45c6-9049-af88e77436c7',
   'L', 'be5d064e-9860-45c6-9049-af88e77436c7', 8.50,
   'be5d064e-9860-45c6-9049-af88e77436c7', '6b923a0c-4263-4cd2-b50e-5f8c849dc87c'),

  ('b0000001-0e50-b2b0-0000-000000000004', 'e9c3dccf-bee3-46c0-b068-52e05c18d883',
   '[TEST] BASILIC FRAIS BOTTE', 'test basilic frais botte', 'TEST-D01', 'Frais',
   '884b3101-7908-4311-ba69-4af5f79c829b', 'pce', '100978f3-3e0d-437c-89ac-23d7a9fd6738',
   'pce', '100978f3-3e0d-437c-89ac-23d7a9fd6738', 1.20,
   '100978f3-3e0d-437c-89ac-23d7a9fd6738', '2e9ef7ef-dff9-4a97-8fa8-decf5d20b91f'),

  ('b0000001-0e50-b2b0-0000-000000000005', 'e9c3dccf-bee3-46c0-b068-52e05c18d883',
   '[TEST] FARINE TYPE 00', 'test farine type 00', 'TEST-E01', 'Épicerie',
   '884b3101-7908-4311-ba69-4af5f79c829b', 'kg', '0acf2a5f-5ea4-48c5-8fee-e91a587eab53',
   'kg', '0acf2a5f-5ea4-48c5-8fee-e91a587eab53', 1.80,
   '0acf2a5f-5ea4-48c5-8fee-e91a587eab53', '6b923a0c-4263-4cd2-b50e-5f8c849dc87c'),

  ('b0000001-0e50-b2b0-0000-000000000006', 'e9c3dccf-bee3-46c0-b068-52e05c18d883',
   '[TEST] PARMIGIANO REGGIANO 24M', 'test parmigiano reggiano 24m', 'TEST-F01', 'Frais',
   '884b3101-7908-4311-ba69-4af5f79c829b', 'kg', '0acf2a5f-5ea4-48c5-8fee-e91a587eab53',
   'kg', '0acf2a5f-5ea4-48c5-8fee-e91a587eab53', 22.00,
   '0acf2a5f-5ea4-48c5-8fee-e91a587eab53', '2e9ef7ef-dff9-4a97-8fa8-decf5d20b91f'),

  ('b0000001-0e50-b2b0-0000-000000000007', 'e9c3dccf-bee3-46c0-b068-52e05c18d883',
   '[TEST] PROSCIUTTO CRUDO', 'test prosciutto crudo', 'TEST-G01', 'Frais',
   '884b3101-7908-4311-ba69-4af5f79c829b', 'kg', '0acf2a5f-5ea4-48c5-8fee-e91a587eab53',
   'kg', '0acf2a5f-5ea4-48c5-8fee-e91a587eab53', 35.00,
   '0acf2a5f-5ea4-48c5-8fee-e91a587eab53', '2e9ef7ef-dff9-4a97-8fa8-decf5d20b91f'),

  ('b0000001-0e50-b2b0-0000-000000000008', 'e9c3dccf-bee3-46c0-b068-52e05c18d883',
   '[TEST] BURRATA PUGLIESE', 'test burrata pugliese', 'TEST-H01', 'Frais',
   '884b3101-7908-4311-ba69-4af5f79c829b', 'pce', '100978f3-3e0d-437c-89ac-23d7a9fd6738',
   'pce', '100978f3-3e0d-437c-89ac-23d7a9fd6738', 4.50,
   '100978f3-3e0d-437c-89ac-23d7a9fd6738', '2e9ef7ef-dff9-4a97-8fa8-decf5d20b91f');

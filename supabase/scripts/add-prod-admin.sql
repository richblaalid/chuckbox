-- Add richard.blaalid+cbprod@withcaldera.com as admin
--
-- PREREQUISITE: The user must first sign up via magic link or be created
-- in Authentication > Users in Supabase Dashboard
--
-- Run this in SQL Editor after the user exists in auth.users

-- ============================================
-- CREATE PROFILE (if not exists)
-- ============================================
INSERT INTO profiles (id, email, full_name, first_name, last_name, phone_home)
SELECT
  id,
  email,
  'Rich Blaalid',
  'Rich',
  'Blaalid',
  NULL
FROM auth.users
WHERE email = 'richard.blaalid+cbprod@withcaldera.com'
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name;

-- ============================================
-- GET OR CREATE UNIT
-- ============================================
-- First check if a unit exists, if not create one
INSERT INTO units (id, name, unit_number, unit_type, council, district, chartered_org)
VALUES (
  '10000000-0000-4000-a000-000000000001',
  'Troop 123',
  '123',
  'troop',
  'Golden Gate Area Council',
  'Redwood District',
  'Charter Org'
)
ON CONFLICT DO NOTHING;

-- ============================================
-- ADD AS ADMIN
-- ============================================
INSERT INTO unit_memberships (unit_id, profile_id, role, status)
SELECT
  '10000000-0000-4000-a000-000000000001',
  id,
  'admin',
  'active'
FROM auth.users
WHERE email = 'richard.blaalid+cbprod@withcaldera.com'
ON CONFLICT DO NOTHING;

-- ============================================
-- VERIFY
-- ============================================
SELECT
  p.email,
  p.full_name,
  um.role,
  um.status,
  u.name as unit_name
FROM profiles p
JOIN unit_memberships um ON um.profile_id = p.id
JOIN units u ON u.id = um.unit_id
WHERE p.email = 'richard.blaalid+cbprod@withcaldera.com';

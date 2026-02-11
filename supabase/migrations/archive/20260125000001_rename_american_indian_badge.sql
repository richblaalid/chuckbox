-- Rename "American Indian Lore" to "American Indian Culture" (current BSA name)
UPDATE bsa_merit_badges
SET name = 'American Indian Culture'
WHERE code = 'american_indian_culture';

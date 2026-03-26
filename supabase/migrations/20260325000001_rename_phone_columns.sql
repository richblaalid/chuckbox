-- Rename phone columns from primary/secondary to home/mobile
-- to match BSA roster data labels and be more semantically meaningful
ALTER TABLE profiles RENAME COLUMN phone_primary TO phone_home;
ALTER TABLE profiles RENAME COLUMN phone_secondary TO phone_mobile;

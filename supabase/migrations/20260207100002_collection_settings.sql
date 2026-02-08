-- Migration: 20260207000002_collection_settings.sql
-- Purpose: Add collection settings to units table for configurable overdue thresholds

-- Add collection settings column to units table
ALTER TABLE units ADD COLUMN IF NOT EXISTS collection_settings JSONB DEFAULT '{
  "overdue_threshold_days": 30,
  "overdue_threshold_amount_cents": 0,
  "reminder_email_subject": "Payment Reminder - {unit_name}",
  "reminder_email_template": "default"
}'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN units.collection_settings IS 'Configurable settings for payment collection: overdue_threshold_days, overdue_threshold_amount_cents, reminder_email_subject, reminder_email_template';

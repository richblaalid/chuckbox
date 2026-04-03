-- Add line items, deposit amount, and deposit due date to billing_records
ALTER TABLE billing_records
  ADD COLUMN line_items jsonb DEFAULT NULL,
  ADD COLUMN deposit_amount numeric DEFAULT NULL,
  ADD COLUMN deposit_due_date date DEFAULT NULL;

-- Add constraint: deposit_amount must be positive if set
ALTER TABLE billing_records
  ADD CONSTRAINT billing_records_deposit_amount_positive
  CHECK (deposit_amount IS NULL OR deposit_amount > 0);

-- Add constraint: deposit_due_date requires deposit_amount
ALTER TABLE billing_records
  ADD CONSTRAINT billing_records_deposit_requires_amount
  CHECK (deposit_due_date IS NULL OR deposit_amount IS NOT NULL);

COMMENT ON COLUMN billing_records.line_items IS 'Informational breakdown of the total amount: [{description: string, amount: number}]';
COMMENT ON COLUMN billing_records.deposit_amount IS 'Optional deposit amount due before the full balance';
COMMENT ON COLUMN billing_records.deposit_due_date IS 'Due date for the deposit amount';

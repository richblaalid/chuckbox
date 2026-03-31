-- Add paid_amount to billing_charges for fast querying
ALTER TABLE billing_charges
  ADD COLUMN paid_amount numeric NOT NULL DEFAULT 0;

-- Create payment_allocations table
CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  billing_charge_id uuid NOT NULL REFERENCES billing_charges(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_allocations_amount_positive CHECK (amount > 0)
);

-- Index for querying allocations by payment or charge
CREATE INDEX idx_payment_allocations_payment_id ON payment_allocations(payment_id);
CREATE INDEX idx_payment_allocations_billing_charge_id ON payment_allocations(billing_charge_id);

-- Enable RLS
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;

-- RLS policies: same access pattern as payments table
CREATE POLICY "Users can view payment allocations for their unit"
  ON payment_allocations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM payments p
      JOIN unit_memberships um ON um.unit_id = p.unit_id
      WHERE p.id = payment_allocations.payment_id
        AND um.profile_id = auth.uid()
        AND um.status = 'active'
    )
  );

CREATE POLICY "Financial roles can insert payment allocations"
  ON payment_allocations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM payments p
      JOIN unit_memberships um ON um.unit_id = p.unit_id
      WHERE p.id = payment_allocations.payment_id
        AND um.profile_id = auth.uid()
        AND um.status = 'active'
        AND um.role IN ('admin', 'treasurer')
    )
  );

COMMENT ON TABLE payment_allocations IS 'Links payments to specific billing charges they cover (partial or full)';
COMMENT ON COLUMN billing_charges.paid_amount IS 'Denormalized sum of payment allocations for this charge. Derived: paid_amount >= amount means fully paid.';

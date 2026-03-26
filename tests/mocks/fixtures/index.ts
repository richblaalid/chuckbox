/**
 * Test fixtures for common data structures
 */

// Re-export advancement fixtures
export * from './advancement'

// Re-export scoutbook import fixtures
export * from './scoutbook'

// Unit fixtures
export const mockUnit = {
  id: 'unit_123',
  name: 'Troop 123',
  unit_type: 'troop' as const,
  council: 'Test Council',
  district: 'Test District',
  processing_fee_percent: 0.026,
  processing_fee_fixed: 0.10,
  pass_fees_to_payer: false,
  logo_url: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

export const mockUnitWithFees = {
  ...mockUnit,
  pass_fees_to_payer: true,
  processing_fee_percent: 0.029,
  processing_fee_fixed: 0.30,
}

// Profile fixtures
export const mockProfile = {
  id: 'profile_123',
  email: 'test@example.com',
  full_name: 'Test User',
  first_name: 'Test',
  last_name: 'User',
  phone_home: '555-1234',
  phone_mobile: null,
  email_secondary: null,
  address_street: '123 Test St',
  address_city: 'Test City',
  address_state: 'TS',
  address_zip: '12345',
  gender: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

export const mockAdminProfile = {
  ...mockProfile,
  id: 'admin_profile_123',
  email: 'admin@example.com',
  full_name: 'Admin User',
  first_name: 'Admin',
  last_name: 'User',
}

// Membership fixtures
export const mockAdminMembership = {
  id: 'membership_admin_123',
  unit_id: mockUnit.id,
  profile_id: mockAdminProfile.id,
  email: mockAdminProfile.email,
  role: 'admin' as const,
  status: 'active' as const,
  scout_ids: null,
  invited_by: null,
  invited_at: null,
  accepted_at: '2024-01-01T00:00:00Z',
  joined_at: '2024-01-01T00:00:00Z',
  expires_at: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

export const mockParentMembership = {
  id: 'membership_parent_123',
  unit_id: mockUnit.id,
  profile_id: mockProfile.id,
  email: mockProfile.email,
  role: 'parent' as const,
  status: 'active' as const,
  scout_ids: ['scout_123'],
  invited_by: mockAdminProfile.id,
  invited_at: '2024-01-01T00:00:00Z',
  accepted_at: '2024-01-02T00:00:00Z',
  joined_at: '2024-01-02T00:00:00Z',
  expires_at: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
}

export const mockInvitedMembership = {
  id: 'membership_invited_123',
  unit_id: mockUnit.id,
  profile_id: null,
  email: 'invited@example.com',
  role: 'parent' as const,
  status: 'invited' as const,
  scout_ids: ['scout_123'],
  invited_by: mockAdminProfile.id,
  invited_at: '2024-01-15T00:00:00Z',
  accepted_at: null,
  joined_at: null,
  expires_at: '2024-01-22T00:00:00Z',
  created_at: '2024-01-15T00:00:00Z',
  updated_at: '2024-01-15T00:00:00Z',
}

// Scout fixtures
export const mockScout = {
  id: 'scout_123',
  unit_id: mockUnit.id,
  first_name: 'Johnny',
  last_name: 'Scout',
  patrol: 'Eagle Patrol',
  rank: 'First Class',
  date_of_birth: '2010-05-15',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

export const mockInactiveScout = {
  ...mockScout,
  id: 'scout_inactive_123',
  first_name: 'Former',
  last_name: 'Scout',
  is_active: false,
}

// Scout account fixtures
export const mockScoutAccount = {
  id: 'account_123',
  unit_id: mockUnit.id,
  scout_id: mockScout.id,
  billing_balance: -50.00, // Owes $50
  funds_balance: 25.00, // Has $25 in funds
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  scouts: mockScout,
}

export const mockPaidUpAccount = {
  ...mockScoutAccount,
  id: 'account_paid_123',
  billing_balance: 0,
  funds_balance: 0,
}

export const mockOverpaidAccount = {
  ...mockScoutAccount,
  id: 'account_overpaid_123',
  billing_balance: 25.00, // Overpaid by $25
  funds_balance: 0,
}

// Account fixtures (chart of accounts)
export const mockBankAccount = {
  id: 'coa_bank_123',
  unit_id: mockUnit.id,
  code: '1000',
  name: 'Bank Account',
  type: 'asset',
  is_system: true,
}

export const mockReceivableAccount = {
  id: 'coa_recv_123',
  unit_id: mockUnit.id,
  code: '1200',
  name: 'Scout Receivables',
  type: 'asset',
  is_system: true,
}

export const mockFeeAccount = {
  id: 'coa_fee_123',
  unit_id: mockUnit.id,
  code: '5600',
  name: 'Payment Processing Fees',
  type: 'expense',
  is_system: true,
}

// Payment link fixtures
export const mockPaymentLink = {
  id: 'link_123',
  unit_id: mockUnit.id,
  scout_account_id: mockScoutAccount.id,
  billing_charge_id: null,
  token: 'a'.repeat(64),
  amount: 5000, // $50.00 in cents
  base_amount: 5000,
  fee_amount: 0,
  fees_passed_to_payer: false,
  description: 'Monthly dues payment',
  status: 'pending' as const,
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  units: { name: mockUnit.name },
  scout_accounts: { scouts: { first_name: mockScout.first_name, last_name: mockScout.last_name } },
}

export const mockExpiredPaymentLink = {
  ...mockPaymentLink,
  id: 'link_expired_123',
  token: 'b'.repeat(64),
  expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Expired yesterday
}

export const mockCompletedPaymentLink = {
  ...mockPaymentLink,
  id: 'link_completed_123',
  token: 'c'.repeat(64),
  status: 'completed' as const,
}

// Payment fixtures
export const mockPayment = {
  id: 'payment_123',
  unit_id: mockUnit.id,
  scout_account_id: mockScoutAccount.id,
  amount: 50.00,
  fee_amount: 1.40,
  net_amount: 48.60,
  payment_method: 'card' as const,
  square_payment_id: 'sq_payment_123',
  square_receipt_url: 'https://squareup.com/receipt/123',
  status: 'completed' as const,
  journal_entry_id: 'journal_123',
  notes: 'Payment for Johnny Scout',
  created_at: '2024-01-15T00:00:00Z',
  updated_at: '2024-01-15T00:00:00Z',
}

// Journal entry fixtures
export const mockJournalEntry = {
  id: 'journal_123',
  unit_id: mockUnit.id,
  entry_date: '2024-01-15',
  description: 'Square payment from Johnny Scout',
  entry_type: 'payment' as const,
  reference: 'sq_payment_123',
  is_posted: true,
  created_at: '2024-01-15T00:00:00Z',
  updated_at: '2024-01-15T00:00:00Z',
}

// Square credentials fixtures
export const mockSquareCredentials = {
  id: 'sq_creds_123',
  unit_id: mockUnit.id,
  merchant_id: 'sq_merchant_123',
  location_id: 'sq_location_123',
  access_token_encrypted: 'encrypted_token_here',
  refresh_token_encrypted: 'encrypted_refresh_here',
  token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

// Billing record fixtures
export const mockBillingRecord = {
  id: 'billing_record_123',
  unit_id: mockUnit.id,
  description: 'January Fair Share',
  total_amount: 25.00,
  billing_date: '2024-01-01',
  due_date: '2024-01-15',
  is_posted: true,
  is_void: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

// Billing charge fixtures
export const mockBillingCharge = {
  id: 'billing_charge_123',
  billing_record_id: mockBillingRecord.id,
  scout_account_id: mockScoutAccount.id,
  amount: 25.00,
  is_paid: false,
  is_void: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

// Helper to create fresh copies of fixtures (prevent mutation between tests)
export function createFixture<T>(fixture: T): T {
  return JSON.parse(JSON.stringify(fixture))
}

// Helper to create fixtures with overrides
export function createFixtureWith<T>(fixture: T, overrides: Partial<T>): T {
  return { ...createFixture(fixture), ...overrides }
}

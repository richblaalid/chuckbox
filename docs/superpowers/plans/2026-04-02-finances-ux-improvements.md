# Finances UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent improvements to the Finances section: rename Add Funds to Adjust Funds with add/remove support, show payment method on paid billing charges, and enable recording payments directly from billing charge rows.

**Architecture:** Each section modifies existing components and patterns. Section 1 adds a new Supabase RPC function and extends the existing funds modal/form. Section 2 extends the billing page query with a join through `payment_allocations`. Section 3 adds a dialog trigger and pre-population props to the existing `QuickPaymentForm`.

**Tech Stack:** Next.js 16 (App Router), Supabase (PostgreSQL RPCs), React 19, shadcn/ui, Tailwind CSS 4, Vitest

---

## File Map

### Section 1: Adjust Funds

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/accounts/add-funds-modal.tsx` | Rename → `adjust-funds-modal.tsx` | Direction toggle, remove validation, balance context |
| `src/components/payments/add-funds-form.tsx` | Rename → `adjust-funds-form.tsx` | Multi-scout direction toggle |
| `src/app/actions/funds.ts` | Modify | Rename `addFundsToScout` → `adjustScoutFunds`, add `direction` param |
| `src/components/accounts/account-actions.tsx` | Modify | Update import to `AdjustFundsModal` |
| `src/components/finances/unified-scout-accounts-table.tsx` | Modify | Add `onAdjustFunds` callback prop and icon button |
| `src/components/finances/unified-accounts-view.tsx` | Modify | Wire `onAdjustFunds` handler, add dialog state |
| `supabase/migrations/YYYYMMDD_debit_funds_from_scout.sql` | Create | New RPC function |
| `tests/unit/actions/funds.test.ts` | Modify | Test `adjustScoutFunds` with both directions |

### Section 2: Payment Method on Billing Charges

| File | Action | Responsibility |
|------|--------|---------------|
| `src/app/(dashboard)/finances/billing/page.tsx` | Modify | Extend query to join `payment_allocations` → `payments` |
| `src/components/billing/billing-management-view.tsx` | Modify | Display payment method on paid charge rows |

### Section 3: Record Payment from Billing Charges

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/billing/billing-management-view.tsx` | Modify | Add Record Payment button on unpaid charges, dialog state |
| `src/components/payments/quick-payment-form.tsx` | Modify | Accept `initialAmount`, `initialChargeId`, `lockedScoutId` props |

---

## Section 1: Adjust Funds

### Task 1: Database Migration — `debit_funds_from_scout` RPC

**Files:**
- Create: `supabase/migrations/20260402100000_debit_funds_from_scout.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Debit funds from scout account (reverse of credit_fundraising_to_scout)
CREATE OR REPLACE FUNCTION debit_funds_from_scout(
    p_scout_account_id UUID,
    p_amount DECIMAL(10,2),
    p_description TEXT,
    p_fundraiser_type TEXT DEFAULT 'general'
)
RETURNS JSONB AS $$
DECLARE
    v_account RECORD;
    v_unit_id UUID;
    v_journal_entry_id UUID;
    v_funds_account_id UUID;
    v_income_account_id UUID;
    v_scout_name TEXT;
BEGIN
    SELECT sa.*, s.first_name, s.last_name, s.unit_id
    INTO v_account
    FROM scout_accounts sa
    JOIN scouts s ON s.id = sa.scout_id
    WHERE sa.id = p_scout_account_id;

    IF v_account IS NULL THEN
        RAISE EXCEPTION 'Scout account not found';
    END IF;

    v_unit_id := v_account.unit_id;
    v_scout_name := v_account.first_name || ' ' || v_account.last_name;

    IF NOT user_has_role(v_unit_id, ARRAY['admin', 'treasurer']::membership_role[]) THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    -- Validate sufficient funds
    IF p_amount > v_account.funds_balance THEN
        RAISE EXCEPTION 'Amount exceeds current funds balance of %', v_account.funds_balance;
    END IF;

    -- Get Scout Funds account (1210)
    SELECT id INTO v_funds_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1210';

    -- Get income account based on fundraiser type
    IF p_fundraiser_type = 'popcorn' THEN
        SELECT id INTO v_income_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '4200';
    ELSIF p_fundraiser_type = 'camp_cards' THEN
        SELECT id INTO v_income_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '4210';
    ELSE
        SELECT id INTO v_income_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '4900';
    END IF;

    IF v_funds_account_id IS NULL OR v_income_account_id IS NULL THEN
        RAISE EXCEPTION 'Required accounts not found for unit';
    END IF;

    -- Create journal entry
    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted)
    VALUES (v_unit_id, CURRENT_DATE, p_description, 'funds_adjustment', true)
    RETURNING id INTO v_journal_entry_id;

    -- Debit Scout Funds (1210) - reduces funds_balance
    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_funds_account_id, p_scout_account_id, p_amount, 0, 'Funds removal: ' || p_description, 'funds');

    -- Credit income account - reverses revenue
    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_income_account_id, p_scout_account_id, 0, p_amount, 'Funds removal reversal', NULL);

    -- Update funds_balance directly
    UPDATE scout_accounts
    SET funds_balance = funds_balance - p_amount,
        updated_at = NOW()
    WHERE id = p_scout_account_id;

    RETURN jsonb_build_object(
        'success', true,
        'journal_entry_id', v_journal_entry_id,
        'amount_debited', p_amount,
        'new_funds_balance', v_account.funds_balance - p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION debit_funds_from_scout TO authenticated;
```

- [ ] **Step 2: Push migration to dev**

```bash
supabase link --project-ref feownmcpkfugkcivdoal
supabase db push
```

Expected: Migration applies successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260402100000_debit_funds_from_scout.sql
git commit -m "feat: add debit_funds_from_scout RPC for fund removal"
```

---

### Task 2: Rename and Extend Server Action

**Files:**
- Modify: `src/app/actions/funds.ts`
- Modify: `tests/unit/actions/funds.test.ts`

- [ ] **Step 1: Update existing tests to use new function name**

In `tests/unit/actions/funds.test.ts`, find all references to `addFundsToScout` and update imports and calls to `adjustScoutFunds`. Add new test cases for the `direction` parameter:

```typescript
import { adjustScoutFunds } from '@/app/actions/funds'

// Update existing test descriptions from "addFundsToScout" to "adjustScoutFunds"
// Add direction: 'add' to existing test calls that were implicitly adding

// New test case for remove direction:
it('should call debit_funds_from_scout RPC when direction is remove', async () => {
  // ... mock setup same as add test but with direction: 'remove'
  const result = await adjustScoutFunds(
    'scout-account-id',
    50,
    'remove',
    undefined,
    'Correcting fundraising credit'
  )
  expect(result.success).toBe(true)
  // Verify rpc was called with 'debit_funds_from_scout'
})

it('should require notes when direction is remove', async () => {
  const result = await adjustScoutFunds(
    'scout-account-id',
    50,
    'remove',
    undefined,
    undefined // no notes
  )
  expect(result.success).toBe(false)
  expect(result.error).toContain('Notes are required')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/actions/funds.test.ts
```

Expected: FAIL — `adjustScoutFunds` is not exported.

- [ ] **Step 3: Rename and extend the server action**

In `src/app/actions/funds.ts`, rename `addFundsToScout` to `adjustScoutFunds` and add the `direction` parameter:

Replace the function signature (lines 12-17):
```typescript
export async function adjustScoutFunds(
  scoutAccountId: string,
  amount: number,
  direction: 'add' | 'remove' = 'add',
  fundraiserTypeId?: string,
  notes?: string
): Promise<ActionResult> {
```

Add notes validation after the amount validation (after line 76):
```typescript
  // Validate notes required for removals
  if (direction === 'remove' && (!notes || !notes.trim())) {
    return { success: false, error: 'Notes are required when removing funds' }
  }
```

Update the description building (lines 93-98):
```typescript
  const directionLabel = direction === 'remove' ? 'removal' : 'credit'
  const description = notes
    ? `${fundraiserTypeName} ${directionLabel}: ${notes} - ${scoutName}`
    : `${fundraiserTypeName} ${directionLabel} - ${scoutName}`
```

Replace the RPC call (lines 100-106) with direction-based logic:
```typescript
  // Call appropriate RPC based on direction
  const rpcName = direction === 'remove' ? 'debit_funds_from_scout' : 'credit_fundraising_to_scout'
  const { data, error } = await supabase.rpc(rpcName, {
    p_scout_account_id: scoutAccountId,
    p_amount: amount,
    p_description: description,
    p_fundraiser_type: fundraiserTypeName,
  })
```

Update error message in permission check (line 70):
```typescript
  if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
    return { success: false, error: 'Only admins and treasurers can adjust funds' }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/actions/funds.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/funds.ts tests/unit/actions/funds.test.ts
git commit -m "feat: rename addFundsToScout to adjustScoutFunds with add/remove direction"
```

---

### Task 3: Rename and Extend AdjustFundsModal

**Files:**
- Rename: `src/components/accounts/add-funds-modal.tsx` → `src/components/accounts/adjust-funds-modal.tsx`
- Modify: `src/components/accounts/account-actions.tsx`

- [ ] **Step 1: Rename the file**

```bash
git mv src/components/accounts/add-funds-modal.tsx src/components/accounts/adjust-funds-modal.tsx
```

- [ ] **Step 2: Update the modal component**

In `src/components/accounts/adjust-funds-modal.tsx`:

Update the import (line 25):
```typescript
import { adjustScoutFunds } from '@/app/actions/funds'
```

Add `Minus` to lucide imports (line 27):
```typescript
import { AlertCircle, CheckCircle2, Minus, Plus } from 'lucide-react'
```

Rename the interface (line 35):
```typescript
interface AdjustFundsModalProps {
  scoutAccountId: string
  scoutName: string
  currentFundsBalance: number
  unitId: string
}
```

Rename the component and add direction state (line 42):
```typescript
export function AdjustFundsModal({
  scoutAccountId,
  scoutName,
  currentFundsBalance,
  unitId,
}: AdjustFundsModalProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [fundraiserTypes, setFundraiserTypes] = useState<FundraiserType[]>([])
  const [loading, setLoading] = useState(false)
  const [direction, setDirection] = useState<'add' | 'remove'>('add')
```

Update validation (line 87):
```typescript
  const parsedAmount = parseFloat(amount) || 0
  const isRemove = direction === 'remove'
  const exceedsBalance = isRemove && parsedAmount > currentFundsBalance
  const notesRequired = isRemove && !notes.trim()
  const isValid = parsedAmount > 0 && !exceedsBalance && (!isRemove || !notesRequired)
```

Update the submit handler call (lines 96-101):
```typescript
      const result = await adjustScoutFunds(
        scoutAccountId,
        parsedAmount,
        direction,
        fundraiserTypeId || undefined,
        notes.trim() || undefined
      )
```

Update the reset handler to also reset direction (line 115-118):
```typescript
        setSuccess(false)
        setAmount('')
        setNotes('')
        setFundraiserTypeId('')
        setDirection('add')
        setIsProcessing(false)
        setOpen(false)
```

Also reset direction in handleOpenChange (lines 130-136):
```typescript
      if (!newOpen) {
        setAmount('')
        setNotes('')
        setFundraiserTypeId('')
        setDirection('add')
        setError(null)
        setSuccess(false)
      }
```

Update the trigger button (line 143-146):
```typescript
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Plus className="h-4 w-4" />
          Adjust Funds
        </Button>
      </DialogTrigger>
```

Update dialog title and description (lines 149-153):
```typescript
        <DialogHeader>
          <DialogTitle>Adjust Funds for {scoutName}</DialogTitle>
          <DialogDescription>
            Add or remove funds from this scout&apos;s account
          </DialogDescription>
        </DialogHeader>
```

Update success message (lines 157-165):
```typescript
        {success ? (
          <div className="text-center py-8 space-y-4">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
            <div>
              <p className="font-medium text-lg">
                Funds {direction === 'remove' ? 'Removed' : 'Added'} Successfully!
              </p>
              <p className="text-muted-foreground">
                {formatCurrency(parsedAmount)} has been {direction === 'remove' ? 'removed' : 'credited'}.
              </p>
            </div>
          </div>
        ) : (
```

Add direction toggle after the current balance display (after line 174):
```tsx
            {/* Direction Toggle */}
            <div className="space-y-2">
              <Label>Action</Label>
              <div className="flex rounded-lg border border-stone-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setDirection('add')}
                  disabled={isProcessing}
                  className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                    direction === 'add'
                      ? 'bg-forest-600 text-white'
                      : 'bg-white text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('remove')}
                  disabled={isProcessing}
                  className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                    direction === 'remove'
                      ? 'bg-red-600 text-white'
                      : 'bg-white text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  Remove
                </button>
              </div>
            </div>
```

Update notes label to show required for removes (line 227):
```tsx
              <Label htmlFor="notes">Notes {isRemove ? '(required)' : '(optional)'}</Label>
```

Add balance exceeded error after the notes field (after line 236):
```tsx
            {/* Balance exceeded warning */}
            {exceedsBalance && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>Amount exceeds current balance of {formatCurrency(currentFundsBalance)}</span>
              </div>
            )}
```

Update summary section (lines 239-251):
```tsx
            {/* Summary */}
            {parsedAmount > 0 && (
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Amount to {isRemove ? 'Remove' : 'Credit'}
                  </span>
                  <span className="font-medium">{formatCurrency(parsedAmount)}</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>New Funds Balance</span>
                  <span className={isRemove ? 'text-red-600' : 'text-green-600'}>
                    {formatCurrency(
                      isRemove
                        ? currentFundsBalance - parsedAmount
                        : currentFundsBalance + parsedAmount
                    )}
                  </span>
                </div>
              </div>
            )}
```

Update submit button text (line 277):
```tsx
                {isProcessing
                  ? (isRemove ? 'Removing Funds...' : 'Adding Funds...')
                  : (isRemove ? 'Remove Funds' : 'Add Funds')}
```

- [ ] **Step 3: Update account-actions.tsx import**

In `src/components/accounts/account-actions.tsx`, update line 8:
```typescript
import { AdjustFundsModal } from './adjust-funds-modal'
```

Update the usage (lines 128-135):
```tsx
          {isFinancialRole && unitId && (
            <AdjustFundsModal
              scoutAccountId={scoutAccountId}
              scoutName={scoutName}
              currentFundsBalance={fundsBalance}
              unitId={unitId}
            />
          )}
```

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/accounts/adjust-funds-modal.tsx src/components/accounts/account-actions.tsx
git add -u  # catches the deleted add-funds-modal.tsx
git commit -m "feat: rename AddFundsModal to AdjustFundsModal with add/remove toggle"
```

---

### Task 4: Rename and Extend AdjustFundsForm (multi-scout)

**Files:**
- Rename: `src/components/payments/add-funds-form.tsx` → `src/components/payments/adjust-funds-form.tsx`

- [ ] **Step 1: Rename the file**

```bash
git mv src/components/payments/add-funds-form.tsx src/components/payments/adjust-funds-form.tsx
```

- [ ] **Step 2: Update the form component**

In `src/components/payments/adjust-funds-form.tsx`:

Update import (line 17):
```typescript
import { adjustScoutFunds } from '@/app/actions/funds'
```

Add `Minus` to lucide imports (line 18):
```typescript
import { AlertCircle, CheckCircle2, Minus, Plus } from 'lucide-react'
```

Rename interface (line 37):
```typescript
interface AdjustFundsFormProps {
```

Rename component (line 53):
```typescript
export function AdjustFundsForm({
```

Add direction state (after line 68):
```typescript
  const [direction, setDirection] = useState<'add' | 'remove'>('add')
```

Update validation (lines 97-101):
```typescript
  const parsedAmount = parseFloat(amount) || 0
  const isRemove = direction === 'remove'
  const currentBalance = scoutAccount && 'funds_balance' in scoutAccount ? (scoutAccount.funds_balance || 0) : 0
  const exceedsBalance = isRemove && parsedAmount > currentBalance
  const notesRequired = isRemove && !notes.trim()
  const isValid =
    (isSingleScoutMode || selectedScoutId) &&
    parsedAmount > 0 &&
    !exceedsBalance &&
    (!isRemove || !notesRequired)
```

Update the submit call (lines 110-115):
```typescript
      const result = await adjustScoutFunds(
        scoutAccount.id,
        parsedAmount,
        direction,
        fundraiserTypeId || undefined,
        notes.trim() || undefined
      )
```

Update success message (lines 159-166):
```tsx
          <p className="font-medium text-lg">
            Funds {direction === 'remove' ? 'Removed' : 'Added'} Successfully!
          </p>
          <p className="text-muted-foreground">
            {formatCurrency(parsedAmount)} has been {direction === 'remove' ? 'removed from' : 'credited to'} the scout account.
          </p>
```

Reset direction in the timeout (after line 139):
```typescript
        setDirection('add')
```

Add direction toggle after the scout selection and balance display, before the amount field (before line 203). Use the same toggle markup as the modal (see Task 3 Step 2, direction toggle section).

Update notes label (line 254):
```tsx
              <Label htmlFor="notes">Notes {isRemove ? '(required)' : '(optional)'}</Label>
```

Add balance exceeded error after notes field:
```tsx
            {exceedsBalance && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>Amount exceeds current balance of {formatCurrency(currentBalance)}</span>
              </div>
            )}
```

Update summary section (lines 266-280):
```tsx
            {parsedAmount > 0 && (
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Amount to {isRemove ? 'Remove' : 'Credit'}
                  </span>
                  <span className="font-medium">{formatCurrency(parsedAmount)}</span>
                </div>
                {scoutAccount && 'funds_balance' in scoutAccount && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>New Funds Balance</span>
                    <span className={isRemove ? 'text-red-600' : 'text-green-600'}>
                      {formatCurrency(
                        isRemove
                          ? currentBalance - parsedAmount
                          : currentBalance + parsedAmount
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}
```

Update submit button (lines 303-316):
```tsx
        <Button
          onClick={handleSubmit}
          disabled={!isValid || isProcessing}
          className="flex-1"
        >
          {isProcessing ? (
            isRemove ? 'Removing Funds...' : 'Adding Funds...'
          ) : (
            <>
              {isRemove ? <Minus className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              {isRemove ? 'Remove Funds' : 'Add Funds'}
            </>
          )}
        </Button>
```

- [ ] **Step 3: Update all import sites**

Search for any files importing `AddFundsForm` or `add-funds-form` and update them. Currently no external imports exist (the form is only used within the payments tab), but verify:

```bash
grep -r "add-funds-form\|AddFundsForm" src/ --include="*.tsx" --include="*.ts"
```

Update any found imports to reference `adjust-funds-form` and `AdjustFundsForm`.

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/payments/adjust-funds-form.tsx
git add -u
git commit -m "feat: rename AddFundsForm to AdjustFundsForm with add/remove toggle"
```

---

### Task 5: Add Adjust Funds Action to Scout Accounts Table

**Files:**
- Modify: `src/components/finances/unified-scout-accounts-table.tsx`
- Modify: `src/components/finances/unified-accounts-view.tsx`

- [ ] **Step 1: Add `onAdjustFunds` callback to table props**

In `src/components/finances/unified-scout-accounts-table.tsx`, update the props interface (lines 39-47):

```typescript
interface UnifiedScoutAccountsTableProps {
  scouts: ScoutAccountRow[]
  patrols: string[]
  selectedIds: string[]
  onScoutSelect: (scout: ScoutAccountRow) => void
  onSelectionChange: (ids: string[]) => void
  onRecordPayment?: (scout: ScoutAccountRow) => void
  onSendReminder?: (scout: ScoutAccountRow) => void
  onAdjustFunds?: (scout: ScoutAccountRow) => void
}
```

Add `Wallet` to lucide imports (find the existing import line):
```typescript
import { ..., Wallet } from 'lucide-react'
```

Destructure the new prop in the component function.

Add a new icon button after the Send Reminder button (after line 378, the closing `</TooltipProvider>` of Send Reminder):

```tsx
                    {onAdjustFunds && (
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              data-action-button
                              onClick={() => onAdjustFunds(scout)}
                              className="h-7 w-7 p-0"
                              aria-label={`Adjust funds for ${scout.scoutName}`}
                            >
                              <Wallet className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Adjust Funds</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
```

- [ ] **Step 2: Wire the callback in unified-accounts-view.tsx**

In `src/components/finances/unified-accounts-view.tsx`:

Add imports at top:
```typescript
import { AdjustFundsModal } from '@/components/accounts/adjust-funds-modal'
```

Add dialog state (after line 69):
```typescript
  const [isAdjustFundsOpen, setIsAdjustFundsOpen] = useState(false)
```

Add handler (after handleSendReminder):
```typescript
  const handleAdjustFunds = (scout: ScoutAccountRow) => {
    setActionScout(scout)
    setIsAdjustFundsOpen(true)
  }
```

Update handleActionSuccess to also close adjust funds dialog:
```typescript
  const handleActionSuccess = () => {
    router.refresh()
    setIsPaymentOpen(false)
    setIsIndividualReminderOpen(false)
    setIsAdjustFundsOpen(false)
    setActionScout(null)
  }
```

Pass the callback to the table (add after `onSendReminder` prop on line 131):
```tsx
        onAdjustFunds={canTakeActions ? handleAdjustFunds : undefined}
```

Add the Adjust Funds dialog after the Individual Reminder Dialog (after line 180):
```tsx
      {/* Individual Adjust Funds Dialog */}
      {actionScout && (
        <Dialog open={isAdjustFundsOpen} onOpenChange={(open) => {
          setIsAdjustFundsOpen(open)
          if (!open) setActionScout(null)
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adjust Funds for {actionScout.scoutName}</DialogTitle>
            </DialogHeader>
            <AdjustFundsModalContent
              scoutAccountId={actionScout.id}
              scoutName={actionScout.scoutName}
              currentFundsBalance={actionScout.fundsBalance}
              unitId={unitId}
              onSuccess={handleActionSuccess}
            />
          </DialogContent>
        </Dialog>
      )}
```

**Note:** The existing `AdjustFundsModal` wraps its own `<Dialog>` with a trigger button. For the table action, we need to control the dialog externally. There are two approaches:

**Option A (simpler):** Extract the form content from `AdjustFundsModal` into a separate `AdjustFundsContent` component that doesn't include its own Dialog wrapper, then use that in both the modal (with trigger) and the external dialog.

**Option B (minimal change):** Add an `open`/`onOpenChange` controlled mode to `AdjustFundsModal` (similar to how `SendPaymentRequestModal` has a `hideTrigger` prop).

Use **Option B** — add optional `open`, `onOpenChange`, and `hideTrigger` props to `AdjustFundsModal`:

In `src/components/accounts/adjust-funds-modal.tsx`, update the props:
```typescript
interface AdjustFundsModalProps {
  scoutAccountId: string
  scoutName: string
  currentFundsBalance: number
  unitId: string
  // Controlled mode (external dialog management)
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  onSuccess?: () => void
}
```

Update the component to use controlled mode when provided:
```typescript
export function AdjustFundsModal({
  scoutAccountId,
  scoutName,
  currentFundsBalance,
  unitId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  hideTrigger = false,
  onSuccess,
}: AdjustFundsModalProps) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  
  const open = controlledOpen ?? internalOpen
  const setOpen = controlledOnOpenChange ?? setInternalOpen
```

Then in the success handler, also call `onSuccess?.()` after the timeout.

In the JSX, conditionally render the trigger:
```tsx
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button variant="outline" className="gap-2">
            <Plus className="h-4 w-4" />
            Adjust Funds
          </Button>
        </DialogTrigger>
      )}
```

Then in `unified-accounts-view.tsx`, use it simply:
```tsx
      {actionScout && (
        <AdjustFundsModal
          scoutAccountId={actionScout.id}
          scoutName={actionScout.scoutName}
          currentFundsBalance={actionScout.fundsBalance}
          unitId={unitId}
          open={isAdjustFundsOpen}
          onOpenChange={(open) => {
            setIsAdjustFundsOpen(open)
            if (!open) setActionScout(null)
          }}
          hideTrigger
          onSuccess={handleActionSuccess}
        />
      )}
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/finances/unified-scout-accounts-table.tsx src/components/finances/unified-accounts-view.tsx src/components/accounts/adjust-funds-modal.tsx
git commit -m "feat: add Adjust Funds action to scout accounts table rows"
```

---

## Section 2: Payment Method on Billing Charges

### Task 6: Extend Billing Query with Payment Method Join

**Files:**
- Modify: `src/app/(dashboard)/finances/billing/page.tsx`

- [ ] **Step 1: Update the Supabase query**

In `src/app/(dashboard)/finances/billing/page.tsx`, extend the billing_charges select (lines 79-91) to include payment allocations and payment method:

```typescript
  const { data: billingRecordsData } = await supabase
    .from('billing_records')
    .select(`
      id,
      description,
      billing_date,
      created_at,
      total_amount,
      is_void,
      billing_import_batch_id,
      billing_charges (
        id,
        amount,
        is_paid,
        is_void,
        scout_account_id,
        scout_accounts (
          scouts (
            first_name,
            last_name
          )
        ),
        payment_allocations (
          payments (
            payment_method,
            notes
          )
        )
      )
    `)
    .eq('unit_id', membership.unit_id)
    .order('created_at', { ascending: false })
```

- [ ] **Step 2: Update the type definition**

Update the `BillingRecordWithCharges` type (lines 96-117) to include the new fields:

```typescript
  type BillingRecordWithCharges = {
    id: string
    description: string
    billing_date: string
    created_at: string | null
    total_amount: number
    is_void: boolean | null
    billing_import_batch_id: string | null
    billing_charges: Array<{
      id: string
      amount: number
      is_paid: boolean | null
      is_void: boolean | null
      scout_account_id: string
      scout_accounts: {
        scouts: {
          first_name: string
          last_name: string
        }
      } | null
      payment_allocations: Array<{
        payments: {
          payment_method: string | null
          notes: string | null
        } | null
      }>
    }>
  }
```

- [ ] **Step 3: Map the payment method into charge data**

Update the charge mapping (lines 129-137) to extract payment method:

```typescript
    const charges = (record.billing_charges || []).map((charge) => {
      // Get payment method from first allocation (if exists)
      const firstAllocation = charge.payment_allocations?.[0]
      const paymentMethod = firstAllocation?.payments?.payment_method || null
      const paymentNotes = firstAllocation?.payments?.notes || null

      // Extract check reference from notes (format: "Check #1234" or "Check #1234 - notes")
      let checkRef: string | null = null
      if (paymentMethod === 'check' && paymentNotes) {
        const match = paymentNotes.match(/Check #(\S+)/)
        if (match) checkRef = match[1]
      }

      return {
        id: charge.id,
        amount: charge.amount,
        is_paid: charge.is_paid,
        is_void: charge.is_void,
        scout_account_id: charge.scout_account_id,
        scout_first_name: charge.scout_accounts?.scouts?.first_name || 'Unknown',
        scout_last_name: charge.scout_accounts?.scouts?.last_name || '',
        payment_method: paymentMethod,
        check_ref: checkRef,
      }
    })
```

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```

Expected: Build succeeds — the `ChargeDetail` type in `billing-management-view.tsx` will need updating too (next task).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/finances/billing/page.tsx
git commit -m "feat: extend billing query with payment method via payment_allocations join"
```

---

### Task 7: Display Payment Method on Paid Charges

**Files:**
- Modify: `src/components/billing/billing-management-view.tsx`

- [ ] **Step 1: Update the ChargeDetail type**

In `src/components/billing/billing-management-view.tsx`, update `ChargeDetail` (lines 30-38):

```typescript
interface ChargeDetail {
  id: string
  amount: number
  is_paid: boolean | null
  is_void: boolean | null
  scout_account_id: string
  scout_first_name: string
  scout_last_name: string
  payment_method: string | null
  check_ref: string | null
}
```

- [ ] **Step 2: Update the paid badge to show payment method**

In the expanded charges section (around line 626-629), replace the paid badge:

```tsx
                                  ) : charge.is_paid ? (
                                    <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-xs px-1.5 py-0">
                                      Paid
                                      {charge.payment_method && (
                                        <span className="text-green-500 font-normal">
                                          {' · '}{charge.payment_method === 'check' && charge.check_ref
                                            ? `Check #${charge.check_ref}`
                                            : charge.payment_method === 'check'
                                              ? 'Check'
                                              : charge.payment_method === 'card'
                                                ? 'Card'
                                                : charge.payment_method.charAt(0).toUpperCase() + charge.payment_method.slice(1)}
                                        </span>
                                      )}
                                    </Badge>
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/billing/billing-management-view.tsx
git commit -m "feat: display payment method on paid billing charge rows"
```

---

## Section 3: Record Payment from Billing Charges

### Task 8: Add Pre-population Props to QuickPaymentForm

**Files:**
- Modify: `src/components/payments/quick-payment-form.tsx`

- [ ] **Step 1: Add optional pre-population props**

In `src/components/payments/quick-payment-form.tsx`, update the props interface (lines 29-42):

```typescript
interface QuickPaymentFormProps {
  unitId: string
  scouts: Scout[]
  squareConfig?: {
    applicationId: string
    locationId: string
    environment: 'sandbox' | 'production'
  }
  preselectedScoutId?: string
  /** Pre-fill the amount (e.g., from a billing charge) */
  initialAmount?: number
  /** Pre-select a specific charge in the allocations list */
  initialChargeId?: string
  /** Lock the scout selector (prevent changing) */
  lockedScoutId?: boolean
  onSuccess?: () => void
  onCancel?: () => void
}
```

Destructure the new props:
```typescript
export function QuickPaymentForm({
  unitId,
  scouts,
  squareConfig,
  preselectedScoutId,
  initialAmount,
  initialChargeId,
  lockedScoutId = false,
  onSuccess,
  onCancel,
}: QuickPaymentFormProps) {
```

- [ ] **Step 2: Apply initial amount**

Update the amount state initialization (line 61):
```typescript
  const [amount, setAmount] = useState(initialAmount ? initialAmount.toFixed(2) : '')
```

- [ ] **Step 3: Apply locked scout selector**

Find the scout selector `<select>` element in the JSX and add the disabled prop. The scout selector is a `<select>` element early in the form. Add `disabled` when `lockedScoutId` is true:

```tsx
            <select
              ...
              disabled={isSubmitting || lockedScoutId}
              ...
            >
```

- [ ] **Step 4: Auto-select initial charge in allocations**

After outstanding charges are fetched (in the `useEffect` that fetches charges, around line 160-178), add logic to pre-select the initial charge:

After `setOutstandingCharges(charges)` (line 173), add:
```typescript
        // Pre-select initial charge if provided
        if (initialChargeId) {
          const matchingCharge = charges.find(c => c.id === initialChargeId)
          if (matchingCharge) {
            const remaining = matchingCharge.amount - matchingCharge.paidAmount
            setAllocations([{
              chargeId: matchingCharge.id,
              amount: remaining.toFixed(2),
            }])
          }
        }
```

- [ ] **Step 5: Verify build passes**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/payments/quick-payment-form.tsx
git commit -m "feat: add pre-population props to QuickPaymentForm for billing integration"
```

---

### Task 9: Add Record Payment Action to Billing Charge Rows

**Files:**
- Modify: `src/components/billing/billing-management-view.tsx`
- Modify: `src/app/(dashboard)/finances/billing/page.tsx`

- [ ] **Step 1: Add dialog state and imports to billing-management-view.tsx**

Add imports at top of `billing-management-view.tsx`:
```typescript
import { QuickPaymentForm } from '@/components/payments/quick-payment-form'
import { DollarSign } from 'lucide-react'
```

Add to the `BillingManagementViewProps` interface:
```typescript
interface BillingManagementViewProps {
  records: BillingRecordEntry[]
  scouts: Scout[]
  unitId: string
  initialStatus?: StatusFilter
  squareConfig?: {
    applicationId: string
    locationId: string
    environment: 'sandbox' | 'production'
  }
}
```

Add state for payment dialog (after existing dialog states, around line 124):
```typescript
  const [paymentCharge, setPaymentCharge] = useState<{
    chargeId: string
    scoutAccountId: string
    amount: number
    description: string
  } | null>(null)
```

Add handler:
```typescript
  const handleRecordPaymentForCharge = (charge: ChargeDetail, description: string) => {
    setPaymentCharge({
      chargeId: charge.id,
      scoutAccountId: charge.scout_account_id,
      amount: charge.amount,
      description,
    })
  }
```

Find the scout for the payment form:
```typescript
  const paymentScout = paymentCharge
    ? scouts.find(s => s.scout_accounts?.id === paymentCharge.scoutAccountId)
    : null
```

- [ ] **Step 2: Add Record Payment button on unpaid charge rows**

In the expanded charges section (around lines 605-637), add a Record Payment button for unpaid, non-void charges. After the paid/unpaid badge (around line 634), add:

```tsx
                                {!charge.is_void && !charge.is_paid && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs text-forest-600 hover:text-forest-800"
                                    onClick={() => handleRecordPaymentForCharge(charge, record.description)}
                                  >
                                    <DollarSign className="h-3 w-3 mr-1" />
                                    Record Payment
                                  </Button>
                                )}
```

- [ ] **Step 3: Add the payment dialog**

After the Void Billing Dialog (after line 675), add:

```tsx
      {/* Record Payment for Charge Dialog */}
      {paymentCharge && paymentScout && (
        <Dialog open={!!paymentCharge} onOpenChange={(open) => { if (!open) setPaymentCharge(null) }}>
          <DialogContent className="max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>
                Record Payment for: {paymentCharge.description}
              </DialogTitle>
            </DialogHeader>
            <QuickPaymentForm
              unitId={unitId}
              scouts={[paymentScout]}
              squareConfig={squareConfig}
              preselectedScoutId={paymentScout.id}
              initialAmount={paymentCharge.amount}
              initialChargeId={paymentCharge.chargeId}
              lockedScoutId
              onSuccess={() => {
                setPaymentCharge(null)
                router.refresh()
              }}
              onCancel={() => setPaymentCharge(null)}
            />
          </DialogContent>
        </Dialog>
      )}
```

- [ ] **Step 4: Pass squareConfig from billing page**

In `src/app/(dashboard)/finances/billing/page.tsx`, pass `squareConfig` to `BillingManagementView`. First, build the config from existing data (the page already queries `unit_square_credentials`). Find where `BillingManagementView` is rendered (around line 202) and add:

```tsx
        <BillingManagementView
          records={records}
          scouts={scouts}
          unitId={membership.unit_id}
          initialStatus={initialStatus}
          squareConfig={hasPaymentProcessor ? {
            applicationId: process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID || '',
            locationId: squareCredentials?.location_id || '',
            environment: (process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
          } : undefined}
        />
```

Check how `squareCredentials` is fetched in the page — it already has the query (around lines 56-63). Verify `location_id` is available. If not, adjust the select:

```typescript
  const { data: squareCredentials } = await supabase
    .from('unit_square_credentials')
    .select('id, location_id')
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .single()
```

- [ ] **Step 5: Verify build passes**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/billing/billing-management-view.tsx src/app/\(dashboard\)/finances/billing/page.tsx
git commit -m "feat: add Record Payment action on unpaid billing charge rows"
```

---

## Final Verification

### Task 10: Build and Test

- [ ] **Step 1: Run full build**

```bash
npm run build
```

Expected: Exit 0, no errors.

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 3: Manual verification checklist**

Start the dev server and verify:

1. **Adjust Funds Modal** — Open a scout account detail, click "Adjust Funds", toggle between Add/Remove, verify validation (notes required for remove, amount exceeds balance error)
2. **Adjust Funds on Accounts Table** — On the Scout Accounts page, click the Wallet icon on a scout row, verify the dialog opens with correct scout data
3. **Adjust Funds Form (multi-scout)** — On the Payments tab, verify the Adjust Funds form shows the direction toggle
4. **Payment Method on Billing** — On the Billing page, expand a billing record with paid charges, verify method shows (Cash, Check #NNN, Card, or just "Paid" if no allocation)
5. **Record Payment from Billing** — On the Billing page, expand a record with unpaid charges, click "Record Payment", verify the form pre-populates scout (locked), amount, and charge selection

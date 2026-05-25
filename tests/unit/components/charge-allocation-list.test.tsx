import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChargeAllocationList } from '@/components/payments/charge-allocation-list'
import type { OutstandingCharge, RowState, AllocationResult } from '@/lib/payment-allocation'

const charges: OutstandingCharge[] = [
  { id: 'A', billingRecordId: 'br-A', description: 'Charge A', amount: 30, paidAmount: 0, billingDate: '2026-06-01', createdAt: '2026-06-01' },
  { id: 'B', billingRecordId: 'br-B', description: 'Charge B', amount: 25, paidAmount: 0, billingDate: '2026-06-15', createdAt: '2026-06-15' },
]

const baseRows: RowState[] = [
  { chargeId: 'A', checked: false, manualAmount: null },
  { chargeId: 'B', checked: false, manualAmount: null },
]

const baseResult: AllocationResult = {
  rowAmounts: {},
  autoExtendedIds: new Set(),
  fundsAllocations: [],
  cashAllocations: [],
  issues: [],
  isValid: true,
}

describe('ChargeAllocationList', () => {
  it('renders one row per outstanding charge', () => {
    render(
      <ChargeAllocationList
        charges={charges}
        rows={baseRows}
        result={baseResult}
        onRowChange={() => {}}
      />
    )
    expect(screen.getByText('Charge A')).toBeInTheDocument()
    expect(screen.getByText('Charge B')).toBeInTheDocument()
  })

  it('disables the $-input for unchecked rows', () => {
    render(
      <ChargeAllocationList
        charges={charges}
        rows={baseRows}
        result={baseResult}
        onRowChange={() => {}}
      />
    )
    const inputs = screen.getAllByPlaceholderText('0.00') as HTMLInputElement[]
    expect(inputs).toHaveLength(2)
    inputs.forEach((i) => expect(i).toBeDisabled())
  })

  it('typing in a row input fires onRowChange with manualAmount set', () => {
    const onRowChange = vi.fn()
    const rows: RowState[] = [
      { chargeId: 'A', checked: true, manualAmount: null },
      { chargeId: 'B', checked: false, manualAmount: null },
    ]
    render(
      <ChargeAllocationList
        charges={charges}
        rows={rows}
        result={{ ...baseResult, rowAmounts: { A: 25 } }}
        onRowChange={onRowChange}
      />
    )
    const inputs = screen.getAllByPlaceholderText('0.00') as HTMLInputElement[]
    fireEvent.change(inputs[0], { target: { value: '15.50' } })
    expect(onRowChange).toHaveBeenCalledWith('A', { manualAmount: 15.5 })
  })

  it('clearing a row input fires onRowChange with manualAmount: null', () => {
    const onRowChange = vi.fn()
    const rows: RowState[] = [
      { chargeId: 'A', checked: true, manualAmount: 20 },
      { chargeId: 'B', checked: false, manualAmount: null },
    ]
    render(
      <ChargeAllocationList
        charges={charges}
        rows={rows}
        result={{ ...baseResult, rowAmounts: { A: 20 } }}
        onRowChange={onRowChange}
      />
    )
    const inputs = screen.getAllByDisplayValue('20') as HTMLInputElement[]
    fireEvent.change(inputs[0], { target: { value: '' } })
    expect(onRowChange).toHaveBeenCalledWith('A', { manualAmount: null })
  })

  it('toggling checkbox fires onRowChange with checked and clears manualAmount', () => {
    const onRowChange = vi.fn()
    const rows: RowState[] = [
      { chargeId: 'A', checked: true, manualAmount: 20 },
      { chargeId: 'B', checked: false, manualAmount: null },
    ]
    render(
      <ChargeAllocationList
        charges={charges}
        rows={rows}
        result={{ ...baseResult, rowAmounts: { A: 20 } }}
        onRowChange={onRowChange}
      />
    )
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0]) // uncheck A
    expect(onRowChange).toHaveBeenCalledWith('A', { checked: false, manualAmount: null })
  })

  it('shows "auto-added" subtext for rows in autoExtendedIds', () => {
    const rows: RowState[] = [
      { chargeId: 'A', checked: false, manualAmount: null },
      { chargeId: 'B', checked: true, manualAmount: null },
    ]
    render(
      <ChargeAllocationList
        charges={charges}
        rows={rows}
        result={{
          ...baseResult,
          rowAmounts: { A: 5, B: 25 },
          autoExtendedIds: new Set(['A']),
        }}
        onRowChange={() => {}}
      />
    )
    expect(screen.getByText('auto-added')).toBeInTheDocument()
  })
})

import { describe, it, expect } from 'vitest'
import {
  generateChargeNotificationEmail,
  type ChargeNotificationEmailData,
} from '@/lib/email/templates/charge-notification'

const baseData: ChargeNotificationEmailData = {
  guardianName: 'Pat Doe',
  scoutName: 'Alex Doe',
  unitName: 'Troop 42',
  unitLogoUrl: null,
  chargeDescription: 'Summer Camp Deposit',
  chargeAmount: 50,
  chargeDate: '2026-05-13',
  currentBalance: -50,
  availableCredit: 0,
  paymentUrl: 'https://example.com/pay/abc',
}

describe('generateChargeNotificationEmail — line items', () => {
  it('renders no "Bill Includes" section when lineItems is null', () => {
    const { html, text } = generateChargeNotificationEmail({
      ...baseData,
      lineItems: null,
      totalScoutsOnRecord: 4,
    })
    expect(html).not.toContain('Bill Includes')
    expect(text).not.toContain('Bill Includes')
  })

  it('renders no "Bill Includes" section when lineItems is omitted entirely', () => {
    const { html, text } = generateChargeNotificationEmail(baseData)
    expect(html).not.toContain('Bill Includes')
    expect(text).not.toContain('Bill Includes')
  })

  it('renders no "Bill Includes" section when lineItems is an empty array', () => {
    const { html, text } = generateChargeNotificationEmail({
      ...baseData,
      lineItems: [],
      totalScoutsOnRecord: 4,
    })
    expect(html).not.toContain('Bill Includes')
    expect(text).not.toContain('Bill Includes')
  })

  it('renders line items, total, and NO share line for single-scout records', () => {
    const { html, text } = generateChargeNotificationEmail({
      ...baseData,
      chargeAmount: 50,
      lineItems: [
        { description: 'Activity fee', amount: 40 },
        { description: 'T-shirt', amount: 10 },
      ],
      totalScoutsOnRecord: 1,
    })
    // HTML
    expect(html).toContain('Bill Includes')
    expect(html).toContain('Activity fee')
    expect(html).toContain('$40.00')
    expect(html).toContain('T-shirt')
    expect(html).toContain('$10.00')
    expect(html).toContain('$50.00')
    expect(html).not.toContain("Your scout's share")
    // Text
    expect(text).toContain('Bill Includes')
    expect(text).toContain('Activity fee')
    expect(text).toContain('$40.00')
    expect(text).not.toContain("Your scout's share")
  })

  it('renders line items at full amounts AND a share line for multi-scout records', () => {
    const { html, text } = generateChargeNotificationEmail({
      ...baseData,
      chargeAmount: 50,
      lineItems: [
        { description: 'Tent rental', amount: 80 },
        { description: 'Food', amount: 100 },
        { description: 'T-shirt', amount: 20 },
      ],
      totalScoutsOnRecord: 4,
    })
    // HTML — full record-level amounts present
    expect(html).toContain('Tent rental')
    expect(html).toContain('$80.00')
    expect(html).toContain('Food')
    expect(html).toContain('$100.00')
    expect(html).toContain('T-shirt')
    expect(html).toContain('$20.00')
    expect(html).toContain('$200.00') // total
    // Share line present, anchored to the parent's chargeAmount
    expect(html).toContain("Your scout's share")
    expect(html).toContain('$50.00')
    expect(html).toContain('1/4 of the total')
    // Text
    expect(text).toContain('Tent rental')
    expect(text).toContain('$80.00')
    expect(text).toContain("Your scout's share: $50.00")
    expect(text).toContain('1/4 of the total')
  })

  it('renders line items but NO share line when totalScoutsOnRecord is 0 (defensive)', () => {
    const { html, text } = generateChargeNotificationEmail({
      ...baseData,
      lineItems: [{ description: 'Activity fee', amount: 50 }],
      totalScoutsOnRecord: 0,
    })
    expect(html).toContain('Bill Includes')
    expect(html).toContain('Activity fee')
    expect(html).not.toContain("Your scout's share")
    expect(text).toContain('Bill Includes')
    expect(text).not.toContain("Your scout's share")
  })
})

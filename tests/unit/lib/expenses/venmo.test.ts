import { describe, it, expect } from 'vitest'
import { generateVenmoPaymentLink, generateVenmoRequestLink } from '@/lib/expenses/venmo'

describe('generateVenmoPaymentLink', () => {
  it('generates correct URL with username, amount, and note', () => {
    const url = generateVenmoPaymentLink({
      username: 'john-doe',
      amount: 25.50,
      note: 'Campsite fee',
    })
    expect(url).toBe(
      'https://venmo.com/john-doe?txn=pay&amount=25.50&note=Campsite%20fee'
    )
  })

  it('strips @ prefix from username', () => {
    const url = generateVenmoPaymentLink({
      username: '@john-doe',
      amount: 10,
      note: 'Test',
    })
    expect(url).toContain('venmo.com/john-doe?')
  })

  it('formats amount to 2 decimal places', () => {
    const url = generateVenmoPaymentLink({
      username: 'user',
      amount: 5,
      note: 'Test',
    })
    expect(url).toContain('amount=5.00')
  })

  it('encodes special characters in note', () => {
    const url = generateVenmoPaymentLink({
      username: 'user',
      amount: 10,
      note: 'Pack 42 - Camping & Supplies (Feb)',
    })
    expect(url).toContain('note=Pack%2042%20-%20Camping%20%26%20Supplies%20(Feb)')
  })
})

describe('generateVenmoRequestLink', () => {
  it('generates request (charge) link', () => {
    const url = generateVenmoRequestLink({
      username: 'jane-doe',
      amount: 40,
      note: 'Campsite fee - 2 scouts',
    })
    expect(url).toBe(
      'https://venmo.com/jane-doe?txn=charge&amount=40.00&note=Campsite%20fee%20-%202%20scouts'
    )
  })

  it('uses charge transaction type', () => {
    const url = generateVenmoRequestLink({
      username: 'user',
      amount: 10,
      note: 'Test',
    })
    expect(url).toContain('txn=charge')
  })
})

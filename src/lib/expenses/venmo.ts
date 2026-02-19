export interface VenmoLinkParams {
  username: string
  amount: number
  note: string
}

function buildVenmoUrl(
  params: VenmoLinkParams,
  txnType: 'pay' | 'charge'
): string {
  const cleanUsername = params.username.replace(/^@/, '')
  const amount = params.amount.toFixed(2)
  const note = encodeURIComponent(params.note)
  return `https://venmo.com/${cleanUsername}?txn=${txnType}&amount=${amount}&note=${note}`
}

/** Generate a Venmo payment link (for sending money TO someone) */
export function generateVenmoPaymentLink(params: VenmoLinkParams): string {
  return buildVenmoUrl(params, 'pay')
}

/** Generate a Venmo request link (for requesting money FROM someone) */
export function generateVenmoRequestLink(params: VenmoLinkParams): string {
  return buildVenmoUrl(params, 'charge')
}

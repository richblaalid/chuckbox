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

export interface CostShareVenmoLink {
  participantId: string
  venmoUrl: string
}

interface GenerateCostShareVenmoLinksParams {
  shares: Array<{
    participantId: string
    scoutCount: number
    shareAmount: number
  }>
  organizerVenmo: string | null
  description: string
}

/** Generate Venmo payment links for each cost share participant */
export function generateCostShareVenmoLinks(
  params: GenerateCostShareVenmoLinksParams
): CostShareVenmoLink[] {
  const { shares, organizerVenmo, description } = params

  if (!organizerVenmo || shares.length === 0) {
    return []
  }

  return shares.map((share) => {
    const scoutText = share.scoutCount === 1 ? '1 scout' : `${share.scoutCount} scouts`
    const note = `${description} (${scoutText})`

    return {
      participantId: share.participantId,
      venmoUrl: generateVenmoPaymentLink({
        username: organizerVenmo,
        amount: share.shareAmount,
        note,
      }),
    }
  })
}

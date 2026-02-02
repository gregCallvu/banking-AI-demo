export const intentToFormSlug = {
  APPLY_LOAN: 'PUBLISHED_SLUG_FOR_LOAN_APPLICATION',
  APPLY_CREDIT_CARD: 'PUBLISHED_SLUG_FOR_CREDIT_CARD_APPLICATION',
  CHECK_LOAN_PAYMENT: 'PUBLISHED_SLUG_FOR_LOAN_PAYMENT',
  DISPUTE_CHARGE: '86EB7321-A03C-4D77-966B-9CD585318E83',
  GENERAL_BANKING_QUESTION: null,
}

export const buildCallvuFormUrl = (
  intent,
  orgId = process.env.CALLVU_ORG_ID
) => {
  const formSlug = intentToFormSlug[intent]
  if (!formSlug || !orgId) {
    return null
  }
  const timestamp = Date.now()
  return `https://studio.callvu.net/callvu-viewer/?UrlSlug=${formSlug}&IsGate=true&TID=${orgId}&ts=${timestamp}`
}


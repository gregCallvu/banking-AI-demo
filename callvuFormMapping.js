export const callvuFormMapping = {
  APPLY_CREDIT_CARD: '2000000',
  APPLY_LOAN: '2000002',
  DISPUTE_CHARGE: '2000001',
  CHECK_LOAN_PAYMENT: '2000003',
  GENERAL_BANKING_QUESTION: null,
}

export const buildCallvuFormUrl = (intent, orgId = process.env.CALLVU_ORG_ID) => {
  const formId = callvuFormMapping[intent]
  if (!formId || !orgId) {
    return null
  }
  return `https://studio.callvu.com/forms/${formId}?org=${orgId}`
}


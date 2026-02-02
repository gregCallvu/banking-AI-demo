import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { createCallvuMcpClient } from './callvuMcpClient.js'
import { buildCallvuFormUrl, callvuFormMapping } from './callvuFormMapping.js'
import { intentToFormSlug, buildCallvuFormUrl as buildCallvuSlugUrl } from './intentToFormSlug.js'
import { intentToActionUrl } from './intentToActionUrl.js'

const callvuToolRegistry = JSON.parse(
  fs.readFileSync(path.resolve('./callvuToolRegistry.json'), 'utf8')
)
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const callvuConfig = {
  orgId: process.env.CALLVU_ORG_ID,
  token: process.env.CALLVU_MCP_TOKEN,
  baseUrl: process.env.CALLVU_MCP_BASE_URL,
}
const hasCallvuConfig = Boolean(
  callvuConfig.orgId && callvuConfig.token && callvuConfig.baseUrl
)

if (!hasCallvuConfig) {
  console.warn(
    'Callvu MCP config missing. MCP actions will remain disabled.'
  )
}

app.use(cors())
app.use(express.json())

const demoFlow = [
  'SIGN_IN',
  'ASK_CREDIT_CARD',
  'START_CREDIT_CARD_APPLICATION',
  'ASK_LOAN_PAYMENT',
  'DISPUTE_CHARGE',
]

const demoFlowLabels = {
  SIGN_IN: 'Sign in',
  ASK_CREDIT_CARD: 'Ask about a credit card',
  START_CREDIT_CARD_APPLICATION: 'Start credit card application',
  ASK_LOAN_PAYMENT: 'Ask about loan payment',
  DISPUTE_CHARGE: 'Dispute a charge',
}

const demoFlowByIntent = {
  APPLY_CREDIT_CARD: 'START_CREDIT_CARD_APPLICATION',
  CHECK_LOAN_PAYMENT: 'ASK_LOAN_PAYMENT',
  DISPUTE_CHARGE: 'DISPUTE_CHARGE',
}

const getSuggestedNextSteps = (intent) => {
  const anchor = demoFlowByIntent[intent] || demoFlow[0]
  const anchorIndex = Math.max(demoFlow.indexOf(anchor), 0)
  return demoFlow.slice(anchorIndex, anchorIndex + 2).map((step) => ({
    id: step,
    label: demoFlowLabels[step] ?? step,
  }))
}

const allowedIntents = new Set([
  'CHECK_LOAN_PAYMENT',
  'LOAN_PAYMENT',
  'AUTO_LOAN_PAYMENT',
  'CREDIT_CARD_PAYMENT',
  'MORTGAGE_PAYMENT',
  'APPLY_CREDIT_CARD',
  'APPLY_LOAN',
  'DISPUTE_CHARGE',
  'ACCOUNT_OVERVIEW',
  'GENERAL_BANKING_QUESTION',
  'OUT_OF_SCOPE',
])

const getFallbackReply = () =>
  'Sorry, I’m unable to process that right now. I can help you make a loan payment, apply for a credit card, or dispute a charge. Please tell me which of these you would like to do next.'

const buildChatResponse = ({
  reply,
  intent,
  buttons = null,
  actionUrl = null,
  buttonText = null,
  entities = null,
}) => {
  const handler = intentHandlers[intent] || intentHandlers.GENERAL_BANKING_QUESTION
  const { action, actionHint, launchTarget } = handler({ message: reply })
  return {
    reply,
    assistantMessage: reply,
    intent,
    entities,
    requestedTool: null,
    toolArguments: null,
    toolResult: null,
    toolError: null,
    action,
    actionHint,
    launchTarget,
    mcpConfigured: hasCallvuConfig,
    suggestedNextSteps: getSuggestedNextSteps(intent),
    message: reply,
    actionUrl,
    buttonText,
    button: actionUrl
      ? {
          label: buttonText ?? 'Open Form',
          url: actionUrl,
          openInNewWindow: true,
        }
      : null,
    buttons,
  }
}
const safeReplyForIntent = (intent) => {
  switch (intent) {
    case 'CHECK_LOAN_PAYMENT':
      return 'No problem — I’ll take you to our secure loan payment center.'
    case 'LOAN_PAYMENT':
      return 'No problem — I’ll take you to our secure loan payment center.'
    case 'AUTO_LOAN_PAYMENT':
      return 'No problem — I’ll take you to our secure auto loan payment center.'
    case 'CREDIT_CARD_PAYMENT':
      return 'No problem — I’ll take you to our secure credit card payment center.'
    case 'MORTGAGE_PAYMENT':
      return 'No problem — I’ll take you to our secure mortgage payment center.'
    case 'APPLY_CREDIT_CARD':
      return 'Great choice — let’s get your application started.'
    case 'APPLY_LOAN':
      return 'Perfect — I’ll take you to our secure loan application.'
    case 'DISPUTE_CHARGE':
      return 'Thanks — let’s get that dispute started.'
    default:
      return getFallbackReply()
  }
}
const intentButtonText = {
  CHECK_LOAN_PAYMENT: 'Secure Payment Center',
  LOAN_PAYMENT: 'Secure Payment Center',
  AUTO_LOAN_PAYMENT: 'Secure Payment Center',
  CREDIT_CARD_PAYMENT: 'Secure Payment Center',
  MORTGAGE_PAYMENT: 'Secure Payment Center',
  APPLY_CREDIT_CARD: 'Secure Application',
  APPLY_LOAN: 'Secure Application',
  DISPUTE_CHARGE: 'Dispute Resolution',
}

const getToolDefinition = (toolName) =>
  callvuToolRegistry.tools.find((tool) => tool.name === toolName)

const validateToolArguments = (toolDefinition, args) => {
  if (!toolDefinition) return { isValid: false, error: 'Unknown tool.' }
  const schema = toolDefinition.inputs
  const argObject = args ?? {}

  if (schema?.type !== 'object' || typeof argObject !== 'object') {
    return { isValid: false, error: 'Invalid tool arguments.' }
  }

  const required = schema.required ?? []
  for (const key of required) {
    if (argObject[key] === undefined || argObject[key] === null) {
      return { isValid: false, error: `Missing required field: ${key}` }
    }
  }

  if (schema.additionalProperties === false) {
    const allowedKeys = new Set(Object.keys(schema.properties ?? {}))
    for (const key of Object.keys(argObject)) {
      if (!allowedKeys.has(key)) {
        return { isValid: false, error: `Unexpected field: ${key}` }
      }
    }
  }

  return { isValid: true }
}

const creditCardFlowBySession = new Map()
const paymentFlowBySession = new Map()
const loanApplicationFlowBySession = new Map()
const disputeFlowBySession = new Map()

const isCreditCardApplyRequest = (text) => {
  const msg = text.toLowerCase()
  if (msg.includes('debit')) return false
  const hasCreditCard = msg.includes('credit card') || msg.includes('card')
  const applySignals =
    msg.includes('apply') ||
    msg.includes('application') ||
    msg.includes('sign up') ||
    msg.includes('signup') ||
    msg.includes('get a') ||
    msg.includes('open a') ||
    msg.includes('new card')
  return hasCreditCard && applySignals
}

const isLoanApplyRequest = (text) => {
  const msg = text.toLowerCase()
  return msg.includes('apply') && msg.includes('loan')
}

const isDisputeRequest = (text) => {
  const msg = text.toLowerCase()
  return (
    msg.includes('dispute') ||
    msg.includes('chargeback') ||
    msg.includes('contest') ||
    msg.includes('disputing')
  )
}

const getPaymentSubtypeIntent = (text) => {
  const msg = text.toLowerCase()
  if (msg.includes('mortgage')) return 'MORTGAGE_PAYMENT'
  if (msg.includes('credit card')) return 'CREDIT_CARD_PAYMENT'
  if (msg.includes('auto loan')) return 'AUTO_LOAN_PAYMENT'
  if (msg.includes('loan')) return 'CHECK_LOAN_PAYMENT'
  return null
}

const getSessionKey = (req) => req.body?.sessionId || req.ip || 'anonymous'

const isGenericPaymentRequest = (text) => {
  const msg = text.toLowerCase()
  const hasPayment =
    msg.includes('payment') || msg.includes('pay') || msg.includes('make a payment')
  const hasSpecific =
    msg.includes('loan') ||
    msg.includes('credit card') ||
    msg.includes('mortgage') ||
    msg.includes('auto loan')
  return hasPayment && !hasSpecific
}

const buildPaymentChoiceResponse = () => ({
  reply: 'Sure — what type of account would you like to make a payment on?',
  intent: 'GENERAL_BANKING_QUESTION',
  buttons: [
    { label: 'Mortgage', actionIntent: 'MORTGAGE_PAYMENT' },
    { label: 'Credit Card', actionIntent: 'CREDIT_CARD_PAYMENT' },
    { label: 'Auto Loan', actionIntent: 'AUTO_LOAN_PAYMENT' },
    { label: 'Personal Loan', actionIntent: 'LOAN_PAYMENT' },
  ],
})

const buildCreditCardTypeResponse = () => ({
  reply: 'What type of card are you looking for?',
  intent: 'APPLY_CREDIT_CARD',
  buttons: [
    { label: 'Personal', actionIntent: 'CREDIT_CARD_TYPE_PERSONAL' },
    { label: 'Business', actionIntent: 'CREDIT_CARD_TYPE_BUSINESS' },
  ],
})

const buildCreditCardFeatureResponse = () => ({
  reply: 'Which card features matter most to you?',
  intent: 'APPLY_CREDIT_CARD',
  buttons: [
    { label: 'Cash Back', actionIntent: 'CREDIT_CARD_FEATURE_CASH_BACK' },
    { label: 'Airline Miles', actionIntent: 'CREDIT_CARD_FEATURE_AIRLINE_MILES' },
    { label: 'Low APR', actionIntent: 'CREDIT_CARD_FEATURE_LOW_APR' },
  ],
})

const buildLoanApplicationTypeResponse = () => ({
  reply: 'What type of loan are you interested in?',
  intent: 'APPLY_LOAN',
  buttons: [
    { label: 'Personal Loan', actionIntent: 'LOAN_TYPE_PERSONAL' },
    { label: 'Home Equity', actionIntent: 'LOAN_TYPE_HOME_EQUITY' },
    { label: 'Auto Loan', actionIntent: 'LOAN_TYPE_AUTO' },
  ],
})

const buildDisputeQualificationResponse = () => ({
  reply:
    'Is this a dispute because the card was lost/stolen, or is the charge amount incorrect?',
  intent: 'DISPUTE_CHARGE',
  buttons: [
    { label: 'Lost/Stolen', actionIntent: 'DISPUTE_LOST_STOLEN' },
    { label: 'Wrong Amount', actionIntent: 'DISPUTE_WRONG_AMOUNT' },
  ],
})

const paymentActionIntents = [
  'MORTGAGE_PAYMENT',
  'CREDIT_CARD_PAYMENT',
  'AUTO_LOAN_PAYMENT',
  'LOAN_PAYMENT',
]

const creditCardTypeIntents = ['CREDIT_CARD_TYPE_PERSONAL', 'CREDIT_CARD_TYPE_BUSINESS']
const creditCardFeatureIntents = [
  'CREDIT_CARD_FEATURE_CASH_BACK',
  'CREDIT_CARD_FEATURE_AIRLINE_MILES',
  'CREDIT_CARD_FEATURE_LOW_APR',
]
const loanTypeIntents = ['LOAN_TYPE_PERSONAL', 'LOAN_TYPE_HOME_EQUITY', 'LOAN_TYPE_AUTO']
const disputeAnswerIntents = ['DISPUTE_LOST_STOLEN', 'DISPUTE_WRONG_AMOUNT']

const intentHandlers = {
  CHECK_LOAN_PAYMENT: ({ user }) => ({
    action: {
      type: 'CHECK_LOAN_PAYMENT',
      requiresAuth: true,
      nextStep: 'offer_payment_options',
      user: user ?? null,
    },
    actionHint: 'I can help you make a loan payment.',
    launchTarget: 'loan_payment_flow',
  }),
  LOAN_PAYMENT: ({ user }) => ({
    action: {
      type: 'LOAN_PAYMENT',
      requiresAuth: true,
      nextStep: 'offer_payment_options',
      user: user ?? null,
    },
    actionHint: 'I can help you make a loan payment.',
    launchTarget: 'loan_payment_flow',
  }),
  AUTO_LOAN_PAYMENT: ({ user }) => ({
    action: {
      type: 'AUTO_LOAN_PAYMENT',
      requiresAuth: true,
      nextStep: 'offer_payment_options',
      user: user ?? null,
    },
    actionHint: 'I can help you make an auto loan payment.',
    launchTarget: 'auto_loan_payment',
  }),
  CREDIT_CARD_PAYMENT: ({ user }) => ({
    action: {
      type: 'CREDIT_CARD_PAYMENT',
      requiresAuth: true,
      nextStep: 'offer_payment_options',
      user: user ?? null,
    },
    actionHint: 'I can help you make a credit card payment.',
    launchTarget: 'credit_card_payment',
  }),
  MORTGAGE_PAYMENT: ({ user }) => ({
    action: {
      type: 'MORTGAGE_PAYMENT',
      requiresAuth: true,
      nextStep: 'offer_payment_options',
      user: user ?? null,
    },
    actionHint: 'I can help you make a mortgage payment.',
    launchTarget: 'mortgage_payment',
  }),
  APPLY_CREDIT_CARD: ({ user }) => ({
    action: {
      type: 'APPLY_CREDIT_CARD',
      requiresAuth: false,
      nextStep: 'collect_application_details',
      user: user ?? null,
    },
    actionHint: 'I can help you apply now.',
    launchTarget: 'credit_card_application',
  }),
  APPLY_LOAN: ({ user }) => ({
    action: {
      type: 'APPLY_LOAN',
      requiresAuth: false,
      nextStep: 'collect_loan_type',
      user: user ?? null,
    },
    actionHint: 'I can walk you through the loan application.',
    launchTarget: 'loan_application',
  }),
  DISPUTE_CHARGE: ({ user }) => ({
    action: {
      type: 'DISPUTE_CHARGE',
      requiresAuth: true,
      nextStep: 'collect_transaction_details',
      user: user ?? null,
    },
    actionHint: 'I can start a dispute for you.',
    launchTarget: 'dispute_charge',
  }),
  ACCOUNT_OVERVIEW: ({ user }) => ({
    action: {
      type: 'ACCOUNT_OVERVIEW',
      requiresAuth: true,
      nextStep: 'request_authentication',
      user: user ?? null,
    },
    actionHint: 'I can show your account overview once you sign in.',
    launchTarget: 'account_overview',
  }),
  GENERAL_BANKING_QUESTION: () => ({
    action: {
      type: 'GENERAL_BANKING_QUESTION',
      requiresAuth: false,
      nextStep: 'clarify_request',
    },
  }),
  OUT_OF_SCOPE: () => ({
    action: {
      type: 'OUT_OF_SCOPE',
      requiresAuth: false,
      nextStep: 'redirect_to_banking',
    },
  }),
}

const parseIntentResponse = (content) => {
  try {
    const parsed = JSON.parse(content)
    const isValid =
      typeof parsed.intent === 'string' &&
      allowedIntents.has(parsed.intent) &&
      typeof parsed.assistantMessage === 'string' &&
      parsed.assistantMessage.trim().length > 0
    return {
      intent: parsed.intent,
      assistantMessage: parsed.assistantMessage,
      entities: parsed.entities ?? null,
      requestedTool: parsed.requestedTool ?? null,
      toolArguments: parsed.toolArguments ?? null,
      isValid,
    }
  } catch (error) {
    return {
      intent: 'OUT_OF_SCOPE',
      assistantMessage: null,
      entities: null,
      requestedTool: null,
      toolArguments: null,
      isValid: false,
    }
  }
}

// Mock login endpoint (unchanged)
app.post('/api/login', (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password)
    return res.status(400).json({ message: 'Username and password are required.' })
  if (username === 'demo' && password === 'password123')
    return res.status(200).json({ message: 'Login successful. Welcome back!' })
  return res.status(401).json({ message: 'Invalid credentials. Please try again.' })
})

// OpenAI-backed /api/chat endpoint
app.post('/api/chat', async (req, res) => {
  const { message, user, actionIntent } = req.body ?? {}
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ reply: 'Please provide a message to send.' })
  }

  try {
    const sessionKey = getSessionKey(req)

    const isPaymentAction = paymentActionIntents.includes(actionIntent)
    const isCreditCardAction =
      creditCardTypeIntents.includes(actionIntent) || creditCardFeatureIntents.includes(actionIntent)
    const isLoanAction = loanTypeIntents.includes(actionIntent)
    const isDisputeAction = disputeAnswerIntents.includes(actionIntent)

    // Reset flows if user changes intent mid-flow.
    if (isCreditCardApplyRequest(message) || isCreditCardAction) {
      loanApplicationFlowBySession.delete(sessionKey)
      disputeFlowBySession.delete(sessionKey)
      paymentFlowBySession.delete(sessionKey)
    } else if (isLoanApplyRequest(message) || isLoanAction) {
      creditCardFlowBySession.delete(sessionKey)
      disputeFlowBySession.delete(sessionKey)
      paymentFlowBySession.delete(sessionKey)
    } else if (isDisputeRequest(message) || isDisputeAction) {
      creditCardFlowBySession.delete(sessionKey)
      loanApplicationFlowBySession.delete(sessionKey)
      paymentFlowBySession.delete(sessionKey)
    } else if (isGenericPaymentRequest(message) || getPaymentSubtypeIntent(message) || isPaymentAction) {
      creditCardFlowBySession.delete(sessionKey)
      loanApplicationFlowBySession.delete(sessionKey)
      disputeFlowBySession.delete(sessionKey)
    }

    // Payment flow: ask type, then launch on selection.
    if (isGenericPaymentRequest(message)) {
      paymentFlowBySession.set(sessionKey, { step: 'await_type' })
      const choiceResponse = buildPaymentChoiceResponse()
      return res.json(
        buildChatResponse({
          reply: choiceResponse.reply,
          intent: choiceResponse.intent,
          buttons: choiceResponse.buttons,
        })
      )
    }

    const activePaymentFlow = paymentFlowBySession.get(sessionKey)
    if (activePaymentFlow) {
      const detectedSubtype = getPaymentSubtypeIntent(message)
      if (detectedSubtype) {
        const resolvedIntent =
          detectedSubtype === 'CHECK_LOAN_PAYMENT' ? 'LOAN_PAYMENT' : detectedSubtype
        paymentFlowBySession.delete(sessionKey)
        const actionUrl = intentToActionUrl[resolvedIntent]
        return res.json(
          buildChatResponse({
            reply: safeReplyForIntent(resolvedIntent),
            intent: resolvedIntent,
            actionUrl,
            buttonText: intentButtonText[resolvedIntent] ?? 'Secure Payment Center',
          })
        )
      }

      const choiceResponse = buildPaymentChoiceResponse()
      return res.json(
        buildChatResponse({
          reply: choiceResponse.reply,
          intent: choiceResponse.intent,
          buttons: choiceResponse.buttons,
        })
      )
    }

    if (isPaymentAction) {
      paymentFlowBySession.delete(sessionKey)
      const resolvedIntent = actionIntent
      const actionUrl = intentToActionUrl[resolvedIntent]
      return res.json(
        buildChatResponse({
          reply: safeReplyForIntent(resolvedIntent),
          intent: resolvedIntent,
          actionUrl,
          buttonText: intentButtonText[resolvedIntent] ?? 'Secure Payment Center',
        })
      )
    }

    if (message.toLowerCase().includes('loan payment')) {
      const resolvedIntent = 'CHECK_LOAN_PAYMENT'
      const actionUrl = intentToActionUrl[resolvedIntent]
      return res.json(
        buildChatResponse({
          reply: safeReplyForIntent(resolvedIntent),
          intent: resolvedIntent,
          actionUrl,
          buttonText: intentButtonText[resolvedIntent] ?? 'Secure Payment Center',
        })
      )
    }

    // Credit card application flow: type -> features -> launch.
    const activeCreditFlow = creditCardFlowBySession.get(sessionKey)
    if (activeCreditFlow) {
      if (creditCardTypeIntents.includes(actionIntent)) {
        activeCreditFlow.type = actionIntent
        activeCreditFlow.step = 'await_feature'
        creditCardFlowBySession.set(sessionKey, activeCreditFlow)
        const featureResponse = buildCreditCardFeatureResponse()
        return res.json(
          buildChatResponse({
            reply: featureResponse.reply,
            intent: featureResponse.intent,
            buttons: featureResponse.buttons,
            entities: { cardType: actionIntent },
          })
        )
      }

      if (creditCardFeatureIntents.includes(actionIntent)) {
        creditCardFlowBySession.delete(sessionKey)
        const resolvedIntent = 'APPLY_CREDIT_CARD'
        const actionUrl = intentToActionUrl[resolvedIntent]
        return res.json(
          buildChatResponse({
            reply: safeReplyForIntent(resolvedIntent),
            intent: resolvedIntent,
            actionUrl,
            buttonText: 'Secure Application',
            entities: { cardFeature: actionIntent, cardType: activeCreditFlow.type },
          })
        )
      }

      const fallbackResponse =
        activeCreditFlow.step === 'await_feature'
          ? buildCreditCardFeatureResponse()
          : buildCreditCardTypeResponse()
      return res.json(
        buildChatResponse({
          reply: fallbackResponse.reply,
          intent: fallbackResponse.intent,
          buttons: fallbackResponse.buttons,
        })
      )
    }

    if (isCreditCardApplyRequest(message)) {
      creditCardFlowBySession.set(sessionKey, { step: 'await_type', type: null })
      const typeResponse = buildCreditCardTypeResponse()
      return res.json(
        buildChatResponse({
          reply: typeResponse.reply,
          intent: typeResponse.intent,
          buttons: typeResponse.buttons,
        })
      )
    }

    if (creditCardTypeIntents.includes(actionIntent)) {
      creditCardFlowBySession.set(sessionKey, { step: 'await_feature', type: actionIntent })
      const featureResponse = buildCreditCardFeatureResponse()
      return res.json(
        buildChatResponse({
          reply: featureResponse.reply,
          intent: featureResponse.intent,
          buttons: featureResponse.buttons,
          entities: { cardType: actionIntent },
        })
      )
    }

    if (creditCardFeatureIntents.includes(actionIntent)) {
      const typeResponse = buildCreditCardTypeResponse()
      return res.json(
        buildChatResponse({
          reply: typeResponse.reply,
          intent: typeResponse.intent,
          buttons: typeResponse.buttons,
        })
      )
    }

    // Loan application flow: type -> launch.
    if (isLoanApplyRequest(message)) {
      loanApplicationFlowBySession.set(sessionKey, { step: 'await_type' })
      const typeResponse = buildLoanApplicationTypeResponse()
      return res.json(
        buildChatResponse({
          reply: typeResponse.reply,
          intent: typeResponse.intent,
          buttons: typeResponse.buttons,
        })
      )
    }

    if (isLoanAction) {
      loanApplicationFlowBySession.delete(sessionKey)
      const resolvedIntent = 'APPLY_LOAN'
      const actionUrl = intentToActionUrl[resolvedIntent]
      return res.json(
        buildChatResponse({
          reply: safeReplyForIntent(resolvedIntent),
          intent: resolvedIntent,
          actionUrl,
          buttonText: 'Secure Application',
          entities: { loanType: actionIntent },
        })
      )
    }

    const activeLoanFlow = loanApplicationFlowBySession.get(sessionKey)
    if (activeLoanFlow) {
      const typeResponse = buildLoanApplicationTypeResponse()
      return res.json(
        buildChatResponse({
          reply: typeResponse.reply,
          intent: typeResponse.intent,
          buttons: typeResponse.buttons,
        })
      )
    }

    // Dispute flow: lost/stolen vs wrong amount -> launch.
    if (isDisputeRequest(message)) {
      disputeFlowBySession.set(sessionKey, { step: 'await_answer' })
      const disputeResponse = buildDisputeQualificationResponse()
      return res.json(
        buildChatResponse({
          reply: disputeResponse.reply,
          intent: disputeResponse.intent,
          buttons: disputeResponse.buttons,
        })
      )
    }

    if (isDisputeAction) {
      disputeFlowBySession.delete(sessionKey)
      const resolvedIntent = 'DISPUTE_CHARGE'
      const actionUrl = intentToActionUrl[resolvedIntent]
      return res.json(
        buildChatResponse({
          reply: safeReplyForIntent(resolvedIntent),
          intent: resolvedIntent,
          actionUrl,
          buttonText: 'Dispute Resolution',
          entities: { disputeAnswer: actionIntent },
        })
      )
    }

    const activeDisputeFlow = disputeFlowBySession.get(sessionKey)
    if (activeDisputeFlow) {
      const disputeResponse = buildDisputeQualificationResponse()
      return res.json(
        buildChatResponse({
          reply: disputeResponse.reply,
          intent: disputeResponse.intent,
          buttons: disputeResponse.buttons,
        })
      )
    }

    if (actionIntent && allowedIntents.has(actionIntent)) {
      const resolvedIntent = actionIntent
      const handler = intentHandlers[resolvedIntent] || intentHandlers.OUT_OF_SCOPE
      const { action, actionHint, launchTarget } = handler({ message, user })
      const actionUrl = intentToActionUrl[resolvedIntent] ?? null
      const buttonUrl = actionUrl || buildCallvuSlugUrl(resolvedIntent, callvuConfig.orgId)
      const buttonText = buttonUrl ? intentButtonText[resolvedIntent] ?? 'Open Form' : null

      return res.json({
        reply: safeReplyForIntent(resolvedIntent),
        assistantMessage: safeReplyForIntent(resolvedIntent),
        intent: resolvedIntent,
        entities: null,
        requestedTool: null,
        toolArguments: null,
        toolResult: null,
        toolError: null,
        action,
        actionHint,
        launchTarget,
        mcpConfigured: hasCallvuConfig,
        suggestedNextSteps: getSuggestedNextSteps(resolvedIntent),
        message: safeReplyForIntent(resolvedIntent),
        actionUrl,
        buttonText,
        button: buttonUrl
          ? {
              label: buttonText,
              url: buttonUrl,
              openInNewWindow: true,
            }
          : null,
      })
    }

    const systemContent = `
You are the Finova Bank virtual assistant.
You help customers with banking requests and route them to the best Callvu micro app.
There are multiple possible micro apps, so you must determine the right one before handoff.

Tone and limits:
- Professional, concise, friendly, and action-oriented
- Maximum 4 sentences
- No emojis, no jokes, no slang

Routing rules:
- Prefer buttons over free text
- Ask no more than two qualifying questions per flow
- If intent is clear, skip questions and proceed
- End with a confident handoff to the secure Callvu form
- For credit card applications, ask about desired benefits (cash back, airline miles, low APR) and never ask about annual fees or rate details

Scope:
- Banking topics only
- If off-topic, decline briefly and redirect to payments, applications, or disputes

Below are example interactions that demonstrate the desired flow.

Example 1 – Payment (unspecified)
User: I want to make a payment.
Assistant: Sure — what type of account would you like to make a payment on?
Buttons: Mortgage | Credit Card | Auto Loan | Personal Loan
User selects: Personal Loan
Assistant: Got it. I’ll take you to our secure loan payment center.

Example 2 – Payment (specified)
User: I need to make a loan payment.
Assistant: No problem — I’ll take you to our secure loan payment center.

Example 3 – Credit card application
User: I want to apply for a credit card.
Assistant: What type of card are you looking for?
Buttons: Personal | Business
User selects: Personal
Assistant: Which features matter most to you?
Buttons: Cash Back | Airline Miles | Low APR
Assistant: Great choice — let’s get your application started.

Example 4 – Loan application
User: I’d like to apply for a loan.
Assistant: What type of loan are you interested in?
Buttons: Personal Loan | Auto Loan | Home Equity
User selects: Auto Loan
Assistant: Perfect — I’ll take you to our secure loan application.

Example 5 – Dispute a charge
User: I need to dispute a charge.
Assistant: Is this a dispute because the card was lost/stolen, or is the charge amount incorrect?
Buttons: Lost/Stolen | Wrong Amount
Assistant: Thanks — let’s get that dispute started.

Use these examples as guidance for tone, structure, and flow.
`.trim()
    const userContext = {
      isAuthenticated: Boolean(user?.isAuthenticated ?? false),
      firstName: user?.firstName ?? 'Greg',
      accountTypes: user?.accountTypes ?? ['Checking', 'Savings', 'Credit Card'],
      eligibleOffers: user?.eligibleOffers ?? [
        'Rewards Upgrade',
        'Auto Loan Refi',
        'Cashback Card',
      ],
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `${systemContent}

You must ONLY respond with valid JSON.
Return this exact JSON shape:
{
  "intent": "CHECK_LOAN_PAYMENT | CREDIT_CARD_PAYMENT | MORTGAGE_PAYMENT | APPLY_CREDIT_CARD | APPLY_LOAN | DISPUTE_CHARGE | ACCOUNT_OVERVIEW | GENERAL_BANKING_QUESTION | OUT_OF_SCOPE",
  "entities": { "type": "object", "optional": true },
  "assistantMessage": "assistant response",
  "requestedTool": "optional tool name",
  "toolArguments": { "type": "object", "optional": true }
}

Intent rules:
- "CHECK_LOAN_PAYMENT" for making/scheduling loan payments or payment hardship.
- "LOAN_PAYMENT" for generic loan payments.
- "AUTO_LOAN_PAYMENT" for auto loan payments.
- "CREDIT_CARD_PAYMENT" for credit card payments.
- "MORTGAGE_PAYMENT" for mortgage payments.
- "APPLY_CREDIT_CARD" for applying or eligibility questions.
- "APPLY_LOAN" for applying for personal/auto/refinance loans.
- "DISPUTE_CHARGE" for disputing/contesting/chargebacks.
- "ACCOUNT_OVERVIEW" for balances, account activity, or transaction details.
- "OUT_OF_SCOPE" for anything not banking-related or if intent is unclear.
- "GENERAL_BANKING_QUESTION" for banking questions that do not match above.

Personalization:
Use the userContext to personalize responses (e.g., first name, account types, eligible offers).
If isAuthenticated is false, avoid sharing account-specific details and prompt sign-in when needed.

Callvu MCP Tool Registry (machine-readable):
${JSON.stringify(callvuToolRegistry)}

Tool recommendation rule:
You may recommend a tool by setting requestedTool and toolArguments, but you MUST NOT execute tools or imply that you executed them.
Prefer tools over text-only explanations when the user asks to take an action.

Strict MCP guardrails:
- Never fabricate tool results
- Never assume MCP success
- Always wait for backend confirmation before responding
- If MCP fails, apologize briefly and offer an alternative banking action

Callvu MCP tools (plain language):
- getForms: Use this to list available forms when the user asks what applications or forms are available.
- getFormDetails: Use this to fetch details about a specific form when the user asks about requirements or what a form includes.
- launchForm: Use this to start an application or dispute flow when the user wants to begin a process.
- getFormAnalytics: Use this to review form performance or activity when asked about form metrics.

Tool usage guidance:
- If the user wants to apply for a credit card or loan, request launchForm with the appropriate formId.
- If the user wants to dispute a charge, request launchForm for the dispute form.
- If the user asks which forms are available, request getForms.
- If the user asks about a specific form, request getFormDetails.
- If the user asks about form performance, request getFormAnalytics.

Intent-to-form guidance:
- Each intent may correspond to a real form in Callvu Studio.
- Indicate which tool/form is needed instead of simulating form actions.
- Always output the intent and suggest launching the form using the button.
- Never invent results from forms.
- If the intent has no form, provide a text response only (no simulated form actions).

userContext: ${JSON.stringify(userContext)}`.trim(),
        },
        { role: 'user', content: message },
      ],
    })

    const content = response.choices?.[0]?.message?.content?.trim() || '{}'
    const {
      intent,
      assistantMessage,
      entities,
      requestedTool,
      toolArguments,
      isValid,
    } = parseIntentResponse(content)
    const resolvedIntent = isValid ? intent : 'OUT_OF_SCOPE'
    const handler = intentHandlers[resolvedIntent] || intentHandlers.OUT_OF_SCOPE
    const { action, actionHint, launchTarget } = handler({ message, user })

    const safeReply = isValid ? assistantMessage : getFallbackReply()
    let toolResult = null
    let toolError = null

    if (requestedTool) {
      const toolDefinition = getToolDefinition(requestedTool)
      const validation = validateToolArguments(toolDefinition, toolArguments)

      if (!hasCallvuConfig) {
        toolError = 'MCP configuration is missing.'
      } else if (!validation.isValid) {
        toolError = validation.error
      } else {
        try {
          const mcpClient = createCallvuMcpClient(callvuConfig)
          toolResult = await mcpClient.invokeTool(requestedTool, toolArguments ?? {})
        } catch (error) {
          toolError = 'Tool execution failed.'
        }
      }
    }

    const actionUrl = intentToActionUrl[resolvedIntent] ?? null
    const buttonUrl = actionUrl || buildCallvuSlugUrl(resolvedIntent, callvuConfig.orgId)

    if (!buttonUrl && (intentToActionUrl[resolvedIntent] || intentToFormSlug[resolvedIntent])) {
      console.warn(
        `Missing Callvu form URL for intent: ${resolvedIntent} (org: ${callvuConfig.orgId ?? 'missing'})`
      )
    }
    const buttonText = buttonUrl ? intentButtonText[resolvedIntent] ?? 'Open Form' : null

    return res.json({
      reply: safeReply,
      assistantMessage: safeReply,
      intent: resolvedIntent,
      entities,
      requestedTool,
      toolArguments,
      toolResult,
      toolError,
      action,
      actionHint,
      launchTarget,
      mcpConfigured: hasCallvuConfig,
      suggestedNextSteps: getSuggestedNextSteps(resolvedIntent),
      message: safeReply,
      actionUrl,
      buttonText,
      button: buttonUrl
        ? {
            label: buttonText,
            url: buttonUrl,
            openInNewWindow: true,
          }
        : null,
    })
  } catch (error) {
    return res.status(500).json({
      reply: getFallbackReply(),
      assistantMessage: getFallbackReply(),
      intent: 'OUT_OF_SCOPE',
      entities: null,
      requestedTool: null,
      toolArguments: null,
      action: intentHandlers.OUT_OF_SCOPE().action,
      actionHint: intentHandlers.OUT_OF_SCOPE().actionHint,
      launchTarget: intentHandlers.OUT_OF_SCOPE().launchTarget,
      mcpConfigured: hasCallvuConfig,
      suggestedNextSteps: getSuggestedNextSteps('OUT_OF_SCOPE'),
      message: getFallbackReply(),
      actionUrl: null,
      buttonText: null,
      buttonLabel: null,
      buttonUrl: null,
      openInNewWindow: false,
    })
  }
})

app.listen(PORT, () => {
  console.log(`Mock API running on http://localhost:${PORT}`)
})

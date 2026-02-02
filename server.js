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

const safeReplyForIntent = (intent) => {
  switch (intent) {
    case 'CHECK_LOAN_PAYMENT':
      return 'I can help you make a loan payment now. Click below to continue.'
    case 'LOAN_PAYMENT':
      return 'Click below to make your loan payment securely.'
    case 'AUTO_LOAN_PAYMENT':
      return 'Click below to make your auto loan payment securely.'
    case 'CREDIT_CARD_PAYMENT':
      return 'Click below to make your credit card payment securely.'
    case 'MORTGAGE_PAYMENT':
      return 'Click below to make your mortgage payment securely.'
    case 'APPLY_CREDIT_CARD':
      return 'I can help you apply for a credit card. Please use the Secure Application to continue.'
    case 'APPLY_LOAN':
      return 'I can help you apply for a loan. Please use the Secure Application to continue.'
    case 'DISPUTE_CHARGE':
      return 'I can help you dispute a charge. Please use the Dispute Resolution form to continue.'
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

const fallbackCreditCardQuestions = [
  'Is this for a personal or business card?',
  'Are you interested in rewards, airline miles, or a student card?',
  'Do you want a card with no annual fee or premium perks?',
]

const isCreditCardApplyRequest = (text) => {
  const msg = text.toLowerCase()
  return (
    (msg.includes('apply') && msg.includes('credit card')) ||
    msg.includes('credit card application') ||
    msg.includes('apply for a card')
  )
}

const buildCreditCardQuestions = async () => {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Generate 2 to 3 concise questions to help select a credit card.
Return JSON: {"questions": ["q1","q2","q3"]}.
Avoid emojis. Keep questions short and clear.`.trim(),
        },
      ],
    })

    const content = response.choices?.[0]?.message?.content?.trim() || '{}'
    const parsed = JSON.parse(content)
    const questions = Array.isArray(parsed.questions) ? parsed.questions : []
    const trimmed = questions
      .map((q) => (typeof q === 'string' ? q.trim() : ''))
      .filter((q) => q.length > 0)
      .slice(0, 3)

    if (trimmed.length >= 2) {
      return trimmed
    }
  } catch (error) {
    // fall through to default questions
  }

  return fallbackCreditCardQuestions
}

const pendingPaymentBySession = new Map()

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
  reply: 'Which account would you like to make a payment for?',
  intent: 'GENERAL_BANKING_QUESTION',
  buttons: [
    { label: 'Mortgage', actionIntent: 'MORTGAGE_PAYMENT' },
    { label: 'Loan', actionIntent: 'LOAN_PAYMENT' },
    { label: 'Auto Loan', actionIntent: 'AUTO_LOAN_PAYMENT' },
    { label: 'Credit Card', actionIntent: 'CREDIT_CARD_PAYMENT' },
  ],
})

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

    const activeCreditFlow = creditCardFlowBySession.get(sessionKey)
    if (activeCreditFlow) {
      activeCreditFlow.answers.push(message)
      if (activeCreditFlow.step < activeCreditFlow.questions.length) {
        const nextQuestion = activeCreditFlow.questions[activeCreditFlow.step]
        activeCreditFlow.step += 1
        creditCardFlowBySession.set(sessionKey, activeCreditFlow)
        return res.json({
          reply: nextQuestion,
          assistantMessage: nextQuestion,
          intent: 'APPLY_CREDIT_CARD',
          entities: { answers: activeCreditFlow.answers },
          requestedTool: null,
          toolArguments: null,
          toolResult: null,
          toolError: null,
          action: intentHandlers.APPLY_CREDIT_CARD().action,
          actionHint: intentHandlers.APPLY_CREDIT_CARD().actionHint,
          launchTarget: intentHandlers.APPLY_CREDIT_CARD().launchTarget,
          mcpConfigured: hasCallvuConfig,
          suggestedNextSteps: getSuggestedNextSteps('APPLY_CREDIT_CARD'),
          message: nextQuestion,
          actionUrl: null,
          buttonText: null,
          button: null,
        })
      }

      creditCardFlowBySession.delete(sessionKey)
      const resolvedIntent = 'APPLY_CREDIT_CARD'
      const actionUrl = intentToActionUrl[resolvedIntent]
      const reply =
        'Based on your preferences, you can apply for your selected credit card securely using the link below.'
      return res.json({
        reply,
        assistantMessage: reply,
        intent: resolvedIntent,
        entities: { answers: activeCreditFlow.answers },
        requestedTool: null,
        toolArguments: null,
        toolResult: null,
        toolError: null,
        action: intentHandlers.APPLY_CREDIT_CARD().action,
        actionHint: intentHandlers.APPLY_CREDIT_CARD().actionHint,
        launchTarget: intentHandlers.APPLY_CREDIT_CARD().launchTarget,
        mcpConfigured: hasCallvuConfig,
        suggestedNextSteps: getSuggestedNextSteps(resolvedIntent),
        message: reply,
        actionUrl,
        buttonText: 'Secure Application',
        button: actionUrl
          ? {
              label: 'Secure Application',
              url: actionUrl,
              openInNewWindow: true,
            }
          : null,
      })
    }

    if (isCreditCardApplyRequest(message)) {
      const questions = await buildCreditCardQuestions()
      creditCardFlowBySession.set(sessionKey, {
        step: 1,
        answers: [],
        questions,
      })
      const firstQuestion = questions[0]
      return res.json({
        reply: firstQuestion,
        assistantMessage: firstQuestion,
        intent: 'APPLY_CREDIT_CARD',
        entities: null,
        requestedTool: null,
        toolArguments: null,
        toolResult: null,
        toolError: null,
        action: intentHandlers.APPLY_CREDIT_CARD().action,
        actionHint: intentHandlers.APPLY_CREDIT_CARD().actionHint,
        launchTarget: intentHandlers.APPLY_CREDIT_CARD().launchTarget,
        mcpConfigured: hasCallvuConfig,
        suggestedNextSteps: getSuggestedNextSteps('APPLY_CREDIT_CARD'),
        message: firstQuestion,
        actionUrl: null,
        buttonText: null,
        button: null,
      })
    }

    if (
      actionIntent &&
      ['LOAN_PAYMENT', 'AUTO_LOAN_PAYMENT', 'CREDIT_CARD_PAYMENT', 'MORTGAGE_PAYMENT'].includes(
        actionIntent
      )
    ) {
      if (!pendingPaymentBySession.has(sessionKey)) {
        const choiceResponse = buildPaymentChoiceResponse()
        return res.json({
          ...choiceResponse,
          assistantMessage: choiceResponse.reply,
          message: choiceResponse.reply,
          button: null,
          actionUrl: null,
          buttonText: null,
          requestedTool: null,
          toolArguments: null,
          toolResult: null,
          toolError: null,
          action: intentHandlers.GENERAL_BANKING_QUESTION().action,
          actionHint: intentHandlers.GENERAL_BANKING_QUESTION().actionHint,
          launchTarget: intentHandlers.GENERAL_BANKING_QUESTION().launchTarget,
          mcpConfigured: hasCallvuConfig,
          suggestedNextSteps: getSuggestedNextSteps('GENERAL_BANKING_QUESTION'),
        })
      }
      pendingPaymentBySession.delete(sessionKey)
    }

    if (actionIntent && allowedIntents.has(actionIntent)) {
      const resolvedIntent = actionIntent
      const handler = intentHandlers[resolvedIntent] || intentHandlers.OUT_OF_SCOPE
      const { action, actionHint, launchTarget } = handler({ message, user })
      const actionUrl = intentToActionUrl[resolvedIntent] ?? null
      const buttonUrl =
        actionUrl || buildCallvuSlugUrl(resolvedIntent, callvuConfig.orgId)
      const buttonText =
        buttonUrl ? intentButtonText[resolvedIntent] ?? 'Open Form' : null

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

    if (isGenericPaymentRequest(message)) {
      pendingPaymentBySession.set(sessionKey, { type: 'payment' })
      const choiceResponse = buildPaymentChoiceResponse()
      return res.json({
        ...choiceResponse,
        assistantMessage: choiceResponse.reply,
        message: choiceResponse.reply,
        button: null,
        actionUrl: null,
        buttonText: null,
        requestedTool: null,
        toolArguments: null,
        toolResult: null,
        toolError: null,
        action: intentHandlers.GENERAL_BANKING_QUESTION().action,
        actionHint: intentHandlers.GENERAL_BANKING_QUESTION().actionHint,
        launchTarget: intentHandlers.GENERAL_BANKING_QUESTION().launchTarget,
        mcpConfigured: hasCallvuConfig,
        suggestedNextSteps: getSuggestedNextSteps('GENERAL_BANKING_QUESTION'),
      })
    }

    if (message.toLowerCase().includes('loan payment')) {
      const resolvedIntent = 'CHECK_LOAN_PAYMENT'
      const handler = intentHandlers[resolvedIntent] || intentHandlers.OUT_OF_SCOPE
      const { action, actionHint, launchTarget } = handler({ message, user })
      const actionUrl = intentToActionUrl[resolvedIntent]
      const buttonText = intentButtonText[resolvedIntent]
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
        button: {
          label: buttonText,
          url: actionUrl,
          openInNewWindow: true,
        },
      })
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

    if (isGenericPaymentRequest(message)) {
      const choiceResponse = buildPaymentChoiceResponse()
      return res.json({
        ...choiceResponse,
        assistantMessage: choiceResponse.reply,
        message: choiceResponse.reply,
        button: null,
        actionUrl: null,
        buttonText: null,
        requestedTool: null,
        toolArguments: null,
        toolResult: null,
        toolError: null,
        action: intentHandlers.GENERAL_BANKING_QUESTION().action,
        actionHint: intentHandlers.GENERAL_BANKING_QUESTION().actionHint,
        launchTarget: intentHandlers.GENERAL_BANKING_QUESTION().launchTarget,
        mcpConfigured: hasCallvuConfig,
        suggestedNextSteps: getSuggestedNextSteps('GENERAL_BANKING_QUESTION'),
      })
    }
    const systemContent = `
You are the Finova Bank virtual assistant.
You help customers with:
- Loan payments
- Applying for credit cards
- Applying for loans
- Contesting credit card charges

You are professional, concise, friendly, and proactive.
You NEVER invent account data.
When an action is required, guide the user step-by-step.
When appropriate, suggest starting a form or next action.
If information is missing, ask clear follow-up questions.

You are a digital banking assistant for a modern retail bank. Your job is to help customers with:
- Loan payments
- Applying for credit cards
- Applying for personal or auto loans
- Disputing credit card charges

You are professional, calm, clear, and action-oriented. You do not guess, invent account data, or promise outcomes. If an action requires account access, ask the user to sign in or confirm authentication.

Always guide the user toward the next best action.

Global response rules:
- Maximum 4 sentences
- Professional, calm, reassuring tone
- No emojis
- No jokes or casual slang
- Always end with a suggested next step

Scope guard:
You may ONLY assist with banking-related topics, including:
- Bank accounts and balances
- Loans and loan payments
- Credit cards and credit card disputes
- Applications for financial products
- General banking guidance

Strict scope rule (overrides all other behavior):
- Only banking-related topics are allowed
- Off-topic questions must be politely declined
- Responses must redirect to a banking-related action

If a user asks about anything NOT related to banking (for example food, entertainment, personal opinions, or general knowledge), you must:
1. Politely state that it’s outside your scope
2. Redirect the conversation back to a relevant banking topic or action

Do not answer off-topic questions, even casually.

Use this structure for off-topic requests:
- One short sentence declining the request
- One sentence offering help with a banking-related action

Examples:
User: What’s the best kind of pizza?
Assistant: That’s not something I can help with, but I’d be happy to assist with a credit card, loan, or managing your accounts.

User: Who’s going to win the Super Bowl?
Assistant: I can’t help with that, but I can help you apply for a new credit card or review your loan options.

User: Tell me a joke.
Assistant: I’m here to help with banking needs, but I can assist with payments, applications, or account questions.

Always stay professional, helpful, and focused on banking.

Below are example interactions that demonstrate correct behavior.

Example 1 – Loan payment
User: I want to make a payment on my auto loan.
Assistant: I can help with that. Are you looking to make a one-time payment or set up recurring payments? Once you’re signed in, I can walk you through the steps.

Example 2 – Missed payment concern
User: I think I missed a loan payment.
Assistant: I can help you review that. Please sign in so I can check your payment history and see what options are available to you.

Example 3 – Credit card application
User: How do I apply for a credit card?
Assistant: You can apply directly online in just a few minutes. I can start a credit card application for you now, or answer questions about available card options before you begin.

Example 4 – Credit card eligibility question
User: Will I be approved for a credit card?
Assistant: Approval depends on a review of your application and credit profile. I can help you start an application or explain what information is typically reviewed.

Example 5 – Loan application
User: I want to apply for a personal loan.
Assistant: I can help with that. Would you like to apply for a personal loan now, or review loan amounts, terms, and requirements first?

Example 6 – Loan status
User: What’s going on with my loan application?
Assistant: I can check the status once you’re signed in. Loan applications are reviewed individually, and I’ll show you the latest update available.

Example 7 – Disputing a charge
User: There’s a charge on my credit card I don’t recognize.
Assistant: I’m sorry about that. I can help you dispute a charge. Once you’re signed in, I’ll ask you to confirm the transaction details so we can start the dispute process.

Example 8 – Duplicate charge
User: I was charged twice for the same purchase.
Assistant: Thanks for letting me know. After you sign in, I can help you review the transactions and submit a dispute for the duplicate charge if needed.

Example 9 – Payment hardship
User: I’m having trouble making my loan payments.
Assistant: I’m glad you reached out. There may be options available depending on your situation. Please sign in so I can review your loan and explain potential next steps.

Example 10 – General guidance
User: What can you help me with?
Assistant: I can help you make loan payments, apply for loans or credit cards, and dispute credit card charges. Let me know what you’d like to do.

Use these examples as guidance for tone, structure, and flow. Always be clear, accurate, and focused on helping the user complete their task.
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

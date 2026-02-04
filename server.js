import OpenAI from 'openai'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { intentToActionUrl } from './intentToActionUrl.js'
import { createCallvuMcpClient } from './callvuMcpClient.js'

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

app.use(cors())
app.use(express.json())

const PAYMENT_TYPE_INTENTS = {
  PAYMENT_TYPE_MORTGAGE: {
    label: 'Mortgage',
    url: intentToActionUrl.MORTGAGE_PAYMENT,
  },
  PAYMENT_TYPE_CREDIT_CARD: {
    label: 'Credit Card',
    url: intentToActionUrl.CREDIT_CARD_PAYMENT,
  },
  PAYMENT_TYPE_AUTO_LOAN: {
    label: 'Auto Loan',
    url: intentToActionUrl.AUTO_LOAN_PAYMENT,
  },
  PAYMENT_TYPE_PERSONAL_LOAN: {
    label: 'Personal Loan',
    url: intentToActionUrl.LOAN_PAYMENT,
  },
}

const LOAN_TYPE_INTENTS = {
  LOAN_TYPE_PERSONAL: {
    label: 'Personal Loan',
    loanType: 'personal loan',
    formId: '2000003',
  },
  LOAN_TYPE_AUTO: {
    label: 'Auto Loan',
    loanType: 'auto loan',
    formId: '2000004',
  },
  LOAN_TYPE_HOME_EQUITY: {
    label: 'Home Equity Loan',
    loanType: 'home equity loan',
    formId: '2000005',
  },
}

const LOAN_COMPLETION_URL = intentToActionUrl.APPLY_LOAN
const LOAN_BEGIN_INTENT = 'LOAN_BEGIN_APPLICATION'

const sessionState = new Map()
const mockMcpSessions = new Map()

const loanTypeButtons = Object.entries(LOAN_TYPE_INTENTS).map(([intent, data]) => ({
  label: data.label,
  actionIntent: intent,
}))

const paymentTypeButtons = Object.entries(PAYMENT_TYPE_INTENTS).map(
  ([intent, data]) => ({
    label: data.label,
    actionIntent: intent,
  })
)

const getSessionKey = (req) => req.body?.sessionId || req.ip || 'anonymous'

const buildChatResponse = ({
  reply,
  intent,
  buttons = null,
  button = null,
  inputRequest = null,
  loading = null,
}) => ({
  reply,
  assistantMessage: reply,
  intent,
  buttons,
  button,
  inputRequest,
  loading,
})

const buildMcpInputRequest = (field, sessionId, stepNumber, totalSteps) => ({
  sessionId,
  fieldId: field.fieldId,
  placeholder: 'Enter your response',
  inputType: field.inputType ?? 'text',
  inputMode: field.inputType === 'number' ? 'numeric' : undefined,
  stepNumber,
  totalSteps,
  prefillValue: field.value ?? '',
  label: field.label,
})

const buildVerificationPrompt = (fieldLabel) => fieldLabel

const buildLoanBeginMessage = () =>
  "We'll prefill the information we have on file for you. Please verify the information is correct or update as necessary. If you're ready to start the application in our secure credit center, click below"

const buildGeneralAnswer = async (message) => {
  const systemContent = `
You are a professional banking assistant.
You may answer high-level, educational banking questions.
Stay concise, neutral, and informational only.
Do not provide links, application steps, or collect personal information.
If asked about non-banking topics, politely decline and redirect to banking help.
`.trim()

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: message },
    ],
  })

  return response.choices?.[0]?.message?.content?.trim()
}

const detectIntent = async (message) => {
  const systemContent = `
You classify user intent for a banking assistant.
Return ONLY valid JSON in this exact shape:
{"intent":"loan_application|payment|general|out_of_scope","loanType":"personal loan|auto loan|home equity loan|null"}

Rules:
- "loan_application" if the user wants to apply for a loan.
- "payment" if the user wants to make a payment.
- "general" for banking education questions.
- "out_of_scope" for non-banking topics.

Loan type detection:
- Set loanType if explicitly mentioned (personal, auto, home equity).
- Otherwise use null.
`.trim()

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: message },
    ],
  })

  const content = response.choices?.[0]?.message?.content?.trim() || '{}'
  try {
    const parsed = JSON.parse(content)
    return {
      intent: parsed.intent ?? 'general',
      loanType: parsed.loanType ?? null,
    }
  } catch (error) {
    return { intent: 'general', loanType: null }
  }
}

const buildMockPrefillData = () => ({
  firstName: 'Greg',
  lastName: 'Wilwerding',
  dateOfBirth: '1989-02-14',
  ssnLast4: '1234',
  addressLine1: '123 Market Street',
  addressLine2: 'Suite 500',
  city: 'San Francisco',
  state: 'CA',
  zip: '94105',
  email: 'greg@callvu.com',
  phone: '4155550123',
})

const callvuMcpMock = {
  getFormDetails: ({ formId }) => {
    const fields = [
      { fieldId: 'firstName', label: 'First Name', inputType: 'text', required: true },
      { fieldId: 'lastName', label: 'Last Name', inputType: 'text', required: true },
      { fieldId: 'email', label: 'Email', inputType: 'text', required: true },
      { fieldId: 'phone', label: 'Phone Number', inputType: 'text', required: true },
      { fieldId: 'dateOfBirth', label: 'Date of Birth', inputType: 'date', required: true },
      {
        fieldId: 'ssnLast4',
        label: 'Last 4 digits of SSN (soft check only)',
        inputType: 'number',
        required: true,
      },
      { fieldId: 'addressBlock', label: 'Address', inputType: 'text', required: true },
      { fieldId: 'annualIncome', label: 'Annual Income', inputType: 'number', required: true },
      { fieldId: 'loanAmount', label: 'Requested Loan Amount', inputType: 'number', required: true },
    ]

    return { formId, fields }
  },
  launchForm: ({ formId, metadata }) => ({
    formId,
    metadata,
    status: 'launched',
  }),
  submitStep: ({ sessionId, fieldId, value }) => {
    const session = mockMcpSessions.get(sessionId)
    if (!session) return null
    session.responses[fieldId] = value
    const nextIndex = session.index + 1
    if (nextIndex >= session.fields.length) {
      mockMcpSessions.set(sessionId, session)
      return { completed: true, responses: session.responses }
    }
    session.index = nextIndex
    mockMcpSessions.set(sessionId, session)
    return { completed: false, nextField: session.fields[nextIndex] }
  },
}

const combineAddressFields = (fields) => {
  const addressIds = new Set(['addressLine1', 'addressLine2', 'city', 'state', 'zip'])
  const addressFields = fields.filter((field) => addressIds.has(field.fieldId))
  if (addressFields.length === 0) return fields

  const withoutAddress = fields.filter((field) => !addressIds.has(field.fieldId))
  const addressField = {
    fieldId: 'addressBlock',
    label: 'Address',
    inputType: 'text',
    required: true,
  }
  const insertIndex = fields.findIndex((field) => addressIds.has(field.fieldId))
  const safeIndex = insertIndex >= 0 ? insertIndex : withoutAddress.length
  return [
    ...withoutAddress.slice(0, safeIndex),
    addressField,
    ...withoutAddress.slice(safeIndex),
  ]
}

const normalizeMcpFields = (rawFields = []) =>
  combineAddressFields(
    rawFields.map((field) => ({
      fieldId: field.fieldId ?? field.id ?? field.name,
      label: field.label ?? field.title ?? field.name ?? 'Field',
      inputType: field.inputType ?? field.type ?? 'text',
      required: Boolean(field.required),
    }))
  )

const getCallvuMcpClient = () => createCallvuMcpClient(callvuConfig)

const extractFieldsFromResponse = (response) => {
  if (!response || typeof response !== 'object') return []
  return (
    response.fields ??
    response.data?.fields ??
    response.form?.fields ??
    response.data?.form?.fields ??
    response.payload?.fields ??
    []
  )
}

const fetchFormDetails = async (formId) => {
  if (!hasCallvuConfig) {
    return callvuMcpMock.getFormDetails({ formId })
  }

  const payload = { formId: String(formId) }

  try {
    const client = getCallvuMcpClient()
    const response = await client.getFormDetails(payload.formId, {
      logPayload: true,
      logResponse: true,
    })
    const rawFields = extractFieldsFromResponse(response)
    const fields = normalizeMcpFields(rawFields)
    if (fields.length > 0) {
      return { formId, fields }
    }
    console.warn('Callvu MCP getFormDetails returned no fields.', {
      formId,
      keys: Object.keys(response ?? {}),
    })
  } catch (error) {
    console.error('Callvu MCP getFormDetails rejected request:', error)
    const status = Number(error?.status ?? 0)
    if (!status || status >= 500) {
      console.warn('Callvu MCP getFormDetails fallback to mock due to server error.')
      return callvuMcpMock.getFormDetails({ formId })
    }
    throw error
  }

  return callvuMcpMock.getFormDetails({ formId })
}

const launchCallvuForm = async ({ formId, metadata }) => {
  if (!hasCallvuConfig) {
    return callvuMcpMock.launchForm({ formId, metadata })
  }
  try {
    const client = getCallvuMcpClient()
    return await client.callTool(
      'LaunchForm',
      { formId: String(formId), metadata },
      { logPayload: false, logResponse: false }
    )
  } catch (error) {
    try {
      const client = getCallvuMcpClient()
      return await client.request(`/orgs/${callvuConfig.orgId}/forms/${formId}/launch`, {
        method: 'POST',
        body: JSON.stringify({ metadata }),
      })
    } catch (restError) {
      console.warn('Callvu MCP launchForm failed. Using mock result.', restError)
      return callvuMcpMock.launchForm({ formId, metadata })
    }
  }
}

const createVerificationSession = async ({ formId }) => {
  const sessionId = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const { fields } = await fetchFormDetails(formId)
  const prefill = buildMockPrefillData()
  const addressParts = [
    prefill.addressLine1,
    prefill.addressLine2,
    `${prefill.city}, ${prefill.state} ${prefill.zip}`,
  ]
    .filter(Boolean)
    .join('\n')
  const hydratedFields = fields.map((field) => ({
    ...field,
    value:
      field.fieldId === 'addressBlock'
        ? addressParts
        : prefill[field.fieldId] ?? '',
  }))
  mockMcpSessions.set(sessionId, {
    formId,
    fields: hydratedFields,
    index: 0,
    responses: {},
  })
  return { sessionId, fields: hydratedFields }
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

app.post('/api/chat', async (req, res) => {
  const { message, actionIntent, inputRequest } = req.body ?? {}
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ reply: 'Please provide a message to send.' })
  }

  try {
    const sessionKey = getSessionKey(req)
    const state = sessionState.get(sessionKey) ?? { flow: null }

    if (state.flow === 'loan_verify' && inputRequest?.sessionId) {
      const submitResponse = callvuMcpMock.submitStep({
        sessionId: inputRequest.sessionId,
        fieldId: inputRequest.fieldId,
        value: message,
      })

      if (submitResponse?.completed) {
        await launchCallvuForm({
          formId: state.formId,
          metadata: submitResponse.responses,
        })
        sessionState.delete(sessionKey)
        const approvalMessage = `You’re approved for a ${state.loanType} with a limit of up to $20,000.`
        const completionMessage =
          'To complete your application, verify your identity and sign your loan documents using the secure link below.'
        return res.json(
          buildChatResponse({
            reply: 'Checking eligibility…',
            intent: 'LOAN_APPLICATION',
            loading: {
              durationMs: 4000,
              approvalMessage,
              completionMessage,
              completionButton: {
                label: 'Complete your application securely',
                url: LOAN_COMPLETION_URL,
                openInNewWindow: true,
              },
            },
          })
        )
      }

      if (submitResponse?.nextField) {
        const nextStepNumber = Math.min(state.stepNumber + 1, state.totalSteps)
        sessionState.set(sessionKey, {
          ...state,
          stepNumber: nextStepNumber,
        })
        return res.json(
          buildChatResponse({
            reply: buildVerificationPrompt(submitResponse.nextField.label),
            intent: 'LOAN_APPLICATION',
            inputRequest: buildMcpInputRequest(
              submitResponse.nextField,
              inputRequest.sessionId,
              nextStepNumber,
              state.totalSteps
            ),
          })
        )
      }
    }

    if (state.flow === 'loan_begin') {
      if (actionIntent === LOAN_BEGIN_INTENT) {
        try {
          const sessionStart = await createVerificationSession({
            formId: state.formId,
          })
          const firstField = sessionStart.fields[0]
          const totalSteps = sessionStart.fields.length
          sessionState.set(sessionKey, {
            flow: 'loan_verify',
            loanType: state.loanType,
            formId: state.formId,
            mcpSessionId: sessionStart.sessionId,
            stepNumber: 1,
            totalSteps,
          })
          return res.json(
            buildChatResponse({
              reply: buildVerificationPrompt(firstField.label),
              intent: 'LOAN_APPLICATION',
              inputRequest: buildMcpInputRequest(
                firstField,
                sessionStart.sessionId,
                1,
                totalSteps
              ),
            })
          )
        } catch (error) {
          console.error('Unable to start Callvu MCP loan verification.', error)
          return res.status(500).json(
            buildChatResponse({
              reply:
                'We were unable to load the loan application fields from Callvu. Please try again shortly.',
              intent: 'LOAN_APPLICATION',
            })
          )
        }
      }

      return res.json(
        buildChatResponse({
          reply: buildLoanBeginMessage(),
          intent: 'LOAN_APPLICATION',
          buttons: [{ label: 'Begin Application', actionIntent: LOAN_BEGIN_INTENT }],
        })
      )
    }

    if (state.flow === 'payment_type') {
      if (PAYMENT_TYPE_INTENTS[actionIntent]) {
        sessionState.delete(sessionKey)
        return res.json(
          buildChatResponse({
            reply:
              'Sure I can help with that. Click the link below to make your payment in our Secure Payment Portal.',
            intent: 'PAYMENT',
            button: {
              label: 'Secure Payment Center',
              url: PAYMENT_TYPE_INTENTS[actionIntent].url,
              openInNewWindow: true,
            },
          })
        )
      }

      return res.json(
        buildChatResponse({
          reply: 'Which account would you like to make a payment on?',
          intent: 'PAYMENT',
          buttons: paymentTypeButtons,
        })
      )
    }

    if (state.flow === 'loan_type') {
      if (LOAN_TYPE_INTENTS[actionIntent]) {
        sessionState.set(sessionKey, {
          flow: 'loan_begin',
          loanType: LOAN_TYPE_INTENTS[actionIntent].loanType,
          formId: LOAN_TYPE_INTENTS[actionIntent].formId,
        })
        return res.json(
          buildChatResponse({
            reply: buildLoanBeginMessage(),
            intent: 'LOAN_APPLICATION',
            buttons: [{ label: 'Begin Application', actionIntent: LOAN_BEGIN_INTENT }],
          })
        )
      }

      return res.json(
        buildChatResponse({
          reply: 'What type of loan are you interested in?',
          intent: 'LOAN_APPLICATION',
          buttons: loanTypeButtons,
        })
      )
    }

    if (PAYMENT_TYPE_INTENTS[actionIntent]) {
      return res.json(
        buildChatResponse({
          reply:
            'Sure I can help with that. Click the link below to make your payment in our Secure Payment Portal.',
          intent: 'PAYMENT',
          button: {
            label: 'Secure Payment Center',
            url: PAYMENT_TYPE_INTENTS[actionIntent].url,
            openInNewWindow: true,
          },
        })
      )
    }

      if (LOAN_TYPE_INTENTS[actionIntent]) {
        sessionState.set(sessionKey, {
          flow: 'loan_begin',
          loanType: LOAN_TYPE_INTENTS[actionIntent].loanType,
          formId: LOAN_TYPE_INTENTS[actionIntent].formId,
        })
        return res.json(
          buildChatResponse({
            reply: buildLoanBeginMessage(),
            intent: 'LOAN_APPLICATION',
            buttons: [{ label: 'Begin Application', actionIntent: LOAN_BEGIN_INTENT }],
          })
        )
      }

    const intentResult = await detectIntent(message)

    if (intentResult.intent === 'payment') {
      sessionState.set(sessionKey, { flow: 'payment_type' })
      return res.json(
        buildChatResponse({
          reply: 'Which account would you like to make a payment on?',
          intent: 'PAYMENT',
          buttons: paymentTypeButtons,
        })
      )
    }

    if (intentResult.intent === 'loan_application') {
      if (intentResult.loanType) {
        const match = Object.values(LOAN_TYPE_INTENTS).find(
          (entry) => entry.loanType === intentResult.loanType
        )
        if (match) {
          sessionState.set(sessionKey, {
            flow: 'loan_begin',
            loanType: match.loanType,
            formId: match.formId,
          })
          return res.json(
            buildChatResponse({
              reply: buildLoanBeginMessage(),
              intent: 'LOAN_APPLICATION',
              buttons: [{ label: 'Begin Application', actionIntent: LOAN_BEGIN_INTENT }],
            })
          )
        }
      }

      sessionState.set(sessionKey, { flow: 'loan_type' })
      return res.json(
        buildChatResponse({
          reply: 'What type of loan are you interested in?',
          intent: 'LOAN_APPLICATION',
          buttons: loanTypeButtons,
        })
      )
    }

    if (intentResult.intent === 'out_of_scope') {
      return res.json(
        buildChatResponse({
          reply:
            'I can only help with banking-related questions like payments or loan applications.',
          intent: 'OUT_OF_SCOPE',
        })
      )
    }

    const response = await buildGeneralAnswer(message)
    return res.json(
      buildChatResponse({
        reply:
          response ||
          'I can help with payments, loan applications, or general banking questions. How can I help?',
        intent: 'GENERAL_BANKING_QUESTION',
      })
    )
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      reply:
        'Sorry, I could not get a response from the assistant. Please try again.',
    })
  }
})

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`)
})
/* LEGACY BLOCK START
import OpenAI from 'openai'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { intentToActionUrl } from './intentToActionUrl.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

app.use(cors())
app.use(express.json())

const PAYMENT_TYPE_INTENTS = {
  PAYMENT_TYPE_MORTGAGE: intentToActionUrl.MORTGAGE_PAYMENT,
  PAYMENT_TYPE_CREDIT_CARD: intentToActionUrl.CREDIT_CARD_PAYMENT,
  PAYMENT_TYPE_AUTO_LOAN: intentToActionUrl.AUTO_LOAN_PAYMENT,
  PAYMENT_TYPE_PERSONAL_LOAN: intentToActionUrl.LOAN_PAYMENT,
}

const LOAN_TYPE_INTENTS = {
  LOAN_TYPE_PERSONAL: 'personal loan',
  LOAN_TYPE_AUTO: 'auto loan',
  LOAN_TYPE_HOME_EQUITY: 'home equity loan',
}

const LOAN_COMPLETION_URL = intentToActionUrl.APPLY_LOAN

const sessionState = new Map()
const mockMcpSessions = new Map()

const buildMockLoanSteps = () => [
  { fieldId: 'firstName', prompt: 'First Name', inputType: 'text' },
  { fieldId: 'lastName', prompt: 'Last Name', inputType: 'text' },
  { fieldId: 'dateOfBirth', prompt: 'Date of Birth', inputType: 'date' },
  {
    fieldId: 'ssnLast4',
    prompt: 'Last 4 digits of SSN (soft check only)',
    inputType: 'number',
  },
  { fieldId: 'addressLine1', prompt: 'Street Address', inputType: 'text' },
  { fieldId: 'city', prompt: 'City', inputType: 'text' },
  { fieldId: 'state', prompt: 'State', inputType: 'text' },
  { fieldId: 'zip', prompt: 'ZIP Code', inputType: 'number' },
  { fieldId: 'annualIncome', prompt: 'Annual Income', inputType: 'number' },
  { fieldId: 'loanAmount', prompt: 'Requested Loan Amount', inputType: 'number' },
]

const callvuMcpMock = {
  startSession: ({ flowType }) => {
    const sessionId = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const steps = flowType === 'loan_application' ? buildMockLoanSteps() : []
    mockMcpSessions.set(sessionId, { steps, index: 0 })
    return { sessionId, nextStep: steps[0] }
  },
  submitStep: ({ sessionId }) => {
    const session = mockMcpSessions.get(sessionId)
    if (!session) return null
    const nextIndex = session.index + 1
    if (nextIndex >= session.steps.length) {
      mockMcpSessions.delete(sessionId)
      return { completed: true }
    }
    session.index = nextIndex
    mockMcpSessions.set(sessionId, session)
    return { completed: false, nextStep: session.steps[nextIndex] }
  },
}

const getSessionKey = (req) => req.body?.sessionId || req.ip || 'anonymous'

const isPaymentIntent = (text) => {
  const msg = text.toLowerCase()
  return (
    msg.includes('payment') ||
    msg.includes('pay my bill') ||
    msg.includes('make a payment')
  )
}

const isLoanApplyIntent = (text) => {
  const msg = text.toLowerCase()
  return msg.includes('apply') && msg.includes('loan')
}

const buildMcpInputRequest = (nextStep, sessionId, stepNumber, totalSteps) => ({
  sessionId,
  fieldId: nextStep.fieldId,
  placeholder: 'Enter your response',
  inputType: nextStep.inputType ?? 'text',
  inputMode: nextStep.inputType === 'number' ? 'numeric' : undefined,
  stepNumber,
  totalSteps,
})

const buildChatResponse = ({
  reply,
  intent,
  buttons = null,
  button = null,
  inputRequest = null,
  loading = null,
}) => ({
  reply,
  assistantMessage: reply,
  intent,
  buttons,
  button,
  inputRequest,
  loading,
})

const paymentTypeButtons = [
  { label: 'Mortgage', actionIntent: 'PAYMENT_TYPE_MORTGAGE' },
  { label: 'Credit Card', actionIntent: 'PAYMENT_TYPE_CREDIT_CARD' },
  { label: 'Auto Loan', actionIntent: 'PAYMENT_TYPE_AUTO_LOAN' },
  { label: 'Personal Loan', actionIntent: 'PAYMENT_TYPE_PERSONAL_LOAN' },
]

const loanTypeButtons = [
  { label: 'Personal Loan', actionIntent: 'LOAN_TYPE_PERSONAL' },
  { label: 'Auto Loan', actionIntent: 'LOAN_TYPE_AUTO' },
  { label: 'Home Equity Loan', actionIntent: 'LOAN_TYPE_HOME_EQUITY' },
]

const buildGeneralAnswer = async (message) => {
  const systemContent = `
You are a professional banking assistant.
You may answer high-level, educational banking questions.
Stay concise, neutral, and informational only.
Do not provide links, application steps, or collect personal information.
If asked about non-banking topics, politely decline and redirect to banking help.
`.trim()

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: message },
    ],
  })

  return response.choices?.[0]?.message?.content?.trim()
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

app.post('/api/chat', async (req, res) => {
  const { message, actionIntent, inputRequest } = req.body ?? {}
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ reply: 'Please provide a message to send.' })
  }

  try {
    const sessionKey = getSessionKey(req)
    const state = sessionState.get(sessionKey) ?? { flow: null }

    if (state.flow === 'loan_mcp' && inputRequest?.sessionId) {
      const submitResponse = callvuMcpMock.submitStep({
        sessionId: inputRequest.sessionId,
        fieldId: inputRequest.fieldId,
        value: message,
      })

      if (submitResponse?.completed) {
        sessionState.delete(sessionKey)
        const approvalMessage = `You’re approved for a ${state.loanType} with a limit of up to $20,000.`
        const completionMessage =
          'To complete your application, verify your identity and sign your loan documents using the secure link below.'
        return res.json(
          buildChatResponse({
            reply: 'Checking eligibility…',
            intent: 'LOAN_APPLICATION',
            loading: {
              durationMs: 4000,
              approvalMessage,
              completionMessage,
              completionButton: {
                label: 'Complete Application',
                url: LOAN_COMPLETION_URL,
                openInNewWindow: true,
              },
            },
          })
        )
      }

      if (submitResponse?.nextStep) {
        const nextStepNumber = Math.min(state.stepNumber + 1, state.totalSteps)
        sessionState.set(sessionKey, {
          ...state,
          stepNumber: nextStepNumber,
        })
        return res.json(
          buildChatResponse({
            reply: submitResponse.nextStep.prompt,
            intent: 'LOAN_APPLICATION',
            inputRequest: buildMcpInputRequest(
              submitResponse.nextStep,
              inputRequest.sessionId,
              nextStepNumber,
              state.totalSteps
            ),
          })
        )
      }
    }

    if (state.flow === 'payment_await_type') {
      if (PAYMENT_TYPE_INTENTS[actionIntent]) {
        sessionState.delete(sessionKey)
        return res.json(
          buildChatResponse({
            reply:
              'Great, click the link below to make your payment in our secure payment portal.',
            intent: 'PAYMENT',
            button: {
              label: 'Secure Payment Center',
              url: PAYMENT_TYPE_INTENTS[actionIntent],
              openInNewWindow: true,
            },
          })
        )
      }

      return res.json(
        buildChatResponse({
          reply: 'Which account would you like to make a payment on?',
          intent: 'PAYMENT',
          buttons: paymentTypeButtons,
        })
      )
    }

    if (state.flow === 'loan_await_type') {
      if (LOAN_TYPE_INTENTS[actionIntent]) {
        const sessionStart = callvuMcpMock.startSession({ flowType: 'loan_application' })
        const totalSteps = buildMockLoanSteps().length
        sessionState.set(sessionKey, {
          flow: 'loan_mcp',
          loanType: LOAN_TYPE_INTENTS[actionIntent],
          mcpSessionId: sessionStart.sessionId,
          stepNumber: 1,
          totalSteps,
        })
        return res.json(
          buildChatResponse({
            reply: sessionStart.nextStep.prompt,
            intent: 'LOAN_APPLICATION',
            inputRequest: buildMcpInputRequest(
              sessionStart.nextStep,
              sessionStart.sessionId,
              1,
              totalSteps
            ),
          })
        )
      }

      return res.json(
        buildChatResponse({
          reply: 'What type of loan are you interested in?',
          intent: 'LOAN_APPLICATION',
          buttons: loanTypeButtons,
        })
      )
    }

    if (PAYMENT_TYPE_INTENTS[actionIntent]) {
      return res.json(
        buildChatResponse({
          reply:
            'Great, click the link below to make your payment in our secure payment portal.',
          intent: 'PAYMENT',
          button: {
            label: 'Secure Payment Center',
            url: PAYMENT_TYPE_INTENTS[actionIntent],
            openInNewWindow: true,
          },
        })
      )
    }

    if (LOAN_TYPE_INTENTS[actionIntent]) {
      const sessionStart = callvuMcpMock.startSession({ flowType: 'loan_application' })
      const totalSteps = buildMockLoanSteps().length
      sessionState.set(sessionKey, {
        flow: 'loan_mcp',
        loanType: LOAN_TYPE_INTENTS[actionIntent],
        mcpSessionId: sessionStart.sessionId,
        stepNumber: 1,
        totalSteps,
      })
      return res.json(
        buildChatResponse({
          reply: sessionStart.nextStep.prompt,
          intent: 'LOAN_APPLICATION',
          inputRequest: buildMcpInputRequest(
            sessionStart.nextStep,
            sessionStart.sessionId,
            1,
            totalSteps
          ),
        })
      )
    }

    if (isPaymentIntent(message)) {
      sessionState.set(sessionKey, { flow: 'payment_await_type' })
      return res.json(
        buildChatResponse({
          reply: 'Which account would you like to make a payment on?',
          intent: 'PAYMENT',
          buttons: paymentTypeButtons,
        })
      )
    }

    if (isLoanApplyIntent(message)) {
      sessionState.set(sessionKey, { flow: 'loan_await_type' })
      return res.json(
        buildChatResponse({
          reply: 'What type of loan are you interested in?',
          intent: 'LOAN_APPLICATION',
          buttons: loanTypeButtons,
        })
      )
    }

    const response = await buildGeneralAnswer(message)
    return res.json(
      buildChatResponse({
        reply:
          response ||
          'I can help with payments, loan applications, or general banking questions. How can I help?',
        intent: 'GENERAL_BANKING_QUESTION',
      })
    )
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      reply:
        'Sorry, I could not get a response from the assistant. Please try again.',
    })
  }
})

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`)
})
import OpenAI from 'openai'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { intentToActionUrl } from './intentToActionUrl.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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
  user = null,
  buttons = null,
  actionUrl = null,
  buttonText = null,
  buttonOptions = null,
  entities = null,
  inputRequest = null,
  loading = null,
}) => {
  const handler = intentHandlers[intent] || intentHandlers.GENERAL_BANKING_QUESTION
  const { action, actionHint, launchTarget } = handler({ message: reply, user })
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
          openInNewWindow: buttonOptions?.openInNewWindow ?? true,
          embedInChat: buttonOptions?.embedInChat ?? false,
        }
      : null,
    buttons,
    inputRequest,
    loading,
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
      return 'To protect your personal information, please continue your application using the secure link below.'
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

const loanEligibilityByType = {
  personal: 20000,
  credit_card: 10000,
  auto: 30000,
}

const loanTypeLabel = {
  personal: 'personal',
  credit_card: 'credit card',
  auto: 'auto',
}

const mockMcpSessions = new Map()

const buildMockLoanSteps = () => [
  {
    fieldId: 'firstName',
    prompt: 'First Name',
    inputType: 'text',
    validation: { required: true },
  },
  {
    fieldId: 'lastName',
    prompt: 'Last Name',
    inputType: 'text',
    validation: { required: true },
  },
  {
    fieldId: 'dateOfBirth',
    prompt: 'Date of Birth',
    inputType: 'date',
    validation: { required: true },
  },
  {
    fieldId: 'ssnLast4',
    prompt: 'Last 4 digits of SSN (soft check only)',
    inputType: 'number',
    validation: { required: true, minLength: 4, maxLength: 4 },
  },
  {
    fieldId: 'addressLine1',
    prompt: 'Street Address',
    inputType: 'text',
    validation: { required: true },
  },
  {
    fieldId: 'city',
    prompt: 'City',
    inputType: 'text',
    validation: { required: true },
  },
  {
    fieldId: 'state',
    prompt: 'State',
    inputType: 'text',
    validation: { required: true },
  },
  {
    fieldId: 'zip',
    prompt: 'ZIP Code',
    inputType: 'number',
    validation: { required: true },
  },
  {
    fieldId: 'annualIncome',
    prompt: 'Annual Income',
    inputType: 'number',
    validation: { required: true },
  },
  {
    fieldId: 'loanAmount',
    prompt: 'Requested Loan Amount',
    inputType: 'number',
    validation: { required: true },
  },
]

const callvuMcpMock = {
  startSession: ({ flowType }) => {
    const sessionId = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const steps = flowType === 'loan_application' ? buildMockLoanSteps() : []
    const loanType = 'personal'
    mockMcpSessions.set(sessionId, { flowType, loanType, steps, index: 0 })
    return { sessionId, nextStep: steps[0] }
  },
  submitStep: ({ sessionId }) => {
    const session = mockMcpSessions.get(sessionId)
    if (!session) {
      return null
    }
    const nextIndex = session.index + 1
    if (nextIndex >= session.steps.length) {
      mockMcpSessions.delete(sessionId)
      return {
        completed: true,
      }
    }
    session.index = nextIndex
    mockMcpSessions.set(sessionId, session)
    return { completed: false, nextStep: session.steps[nextIndex] }
  },
}

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

const isCreditCardMention = (text) => {
  const msg = text.toLowerCase()
  if (msg.includes('debit')) return false
  return (
    msg.includes('credit card') ||
    msg.includes('my card') ||
    msg.includes('card') ||
    msg.includes('visa') ||
    msg.includes('mastercard')
  )
}

const isCreditCardPaymentRequest = (text) => {
  const msg = text.toLowerCase()
  if (!isCreditCardMention(msg)) return false
  return msg.includes('pay') || msg.includes('payment') || msg.includes('make a payment')
}

const isCreditCardApplyRequest = (text) => {
  const msg = text.toLowerCase()
  if (!isCreditCardMention(msg)) return false
  const applySignals =
    msg.includes('apply') ||
    msg.includes('application') ||
    msg.includes('sign up') ||
    msg.includes('signup') ||
    msg.includes('get a') ||
    msg.includes('open a') ||
    msg.includes('new card')
  return applySignals
}

const isCreditCardAmbiguous = (text) =>
  isCreditCardMention(text) && !isCreditCardPaymentRequest(text) && !isCreditCardApplyRequest(text)

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
reply: 'Which account would you like to make a payment on?',
  intent: 'GENERAL_BANKING_QUESTION',
  buttons: [
    { label: 'Mortgage', actionIntent: 'MORTGAGE_PAYMENT' },
    { label: 'Credit Card', actionIntent: 'CREDIT_CARD_PAYMENT' },
    { label: 'Auto Loan', actionIntent: 'AUTO_LOAN_PAYMENT' },
    { label: 'Personal Loan', actionIntent: 'LOAN_PAYMENT' },
  ],
})

const buildCreditCardIntentResponse = () => ({
  reply: 'What would you like to do with your credit card?',
  intent: 'GENERAL_BANKING_QUESTION',
  buttons: [
    { label: 'Make a Payment', actionIntent: 'CREDIT_CARD_INTENT_PAYMENT' },
    { label: 'Apply for a Credit Card', actionIntent: 'CREDIT_CARD_INTENT_APPLY' },
  ],
})

const buildCreditCardTypeResponse = () => ({
  reply: 'Is this a personal or business credit card?',
  intent: 'APPLY_CREDIT_CARD',
  buttons: [
    { label: 'Personal', actionIntent: 'CREDIT_CARD_TYPE_PERSONAL' },
    { label: 'Business', actionIntent: 'CREDIT_CARD_TYPE_BUSINESS' },
  ],
})

const buildCreditCardFeatureResponse = () => ({
  reply: 'Which features matter most to you?',
  intent: 'APPLY_CREDIT_CARD',
  buttons: [
    { label: 'Rewards', actionIntent: 'CREDIT_CARD_FEATURE_REWARDS' },
    { label: 'Airline Miles', actionIntent: 'CREDIT_CARD_FEATURE_AIRLINE_MILES' },
    { label: 'Intro APR', actionIntent: 'CREDIT_CARD_FEATURE_INTRO_APR' },
  ],
})

const buildLoanApplicationTypeResponse = () => ({
  reply: 'What type of loan would you like to apply for?',
  intent: 'APPLY_LOAN',
  buttons: [
    { label: 'Personal Loan', actionIntent: 'LOAN_TYPE_PERSONAL' },
    { label: 'Credit Card', actionIntent: 'LOAN_TYPE_CREDIT_CARD' },
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

const creditCardIntentIntents = ['CREDIT_CARD_INTENT_PAYMENT', 'CREDIT_CARD_INTENT_APPLY']
const creditCardTypeIntents = ['CREDIT_CARD_TYPE_PERSONAL', 'CREDIT_CARD_TYPE_BUSINESS']
const creditCardFeatureIntents = [
  'CREDIT_CARD_FEATURE_REWARDS',
  'CREDIT_CARD_FEATURE_AIRLINE_MILES',
  'CREDIT_CARD_FEATURE_INTRO_APR',
]
const loanTypeIntents = ['LOAN_TYPE_PERSONAL', 'LOAN_TYPE_CREDIT_CARD', 'LOAN_TYPE_AUTO']
const disputeAnswerIntents = ['DISPUTE_LOST_STOLEN', 'DISPUTE_WRONG_AMOUNT']
const loanApplicationStartIntent = 'START_LOAN_APPLICATION'

const loanTypeByIntent = {
  LOAN_TYPE_PERSONAL: 'personal',
  LOAN_TYPE_CREDIT_CARD: 'credit_card',
  LOAN_TYPE_AUTO: 'auto',
}

const buildMcpInputRequest = (nextStep, sessionId, stepNumber, totalSteps) => {
  if (!nextStep) return null
  return {
    sessionId,
    fieldId: nextStep.fieldId,
    placeholder: 'Enter your response',
    inputType: nextStep.inputType ?? 'text',
    inputMode: nextStep.inputType === 'number' ? 'numeric' : undefined,
    maxLength: nextStep.validation?.maxLength,
    stepNumber,
    totalSteps,
    helperText:
      stepNumber && totalSteps ? `Step ${stepNumber} of ${totalSteps}` : null,
  }
}


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
    actionHint: 'I can help with payments, applications, or disputes.',
    launchTarget: 'general_banking',
  }),
  OUT_OF_SCOPE: () => ({
    action: {
      type: 'OUT_OF_SCOPE',
      requiresAuth: false,
      nextStep: 'redirect_to_banking',
    },
    actionHint: 'I can help with banking-related requests only.',
    launchTarget: 'redirect_to_banking',
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
  const { message, user, actionIntent, inputRequest } = req.body ?? {}
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ reply: 'Please provide a message to send.' })
  }

  try {
    const sessionKey = getSessionKey(req)
    const buildResponse = (payload) => buildChatResponse({ ...payload, user })

    const isPaymentAction = paymentActionIntents.includes(actionIntent)
    const isCreditCardAction =
      creditCardIntentIntents.includes(actionIntent) ||
      creditCardTypeIntents.includes(actionIntent) ||
      creditCardFeatureIntents.includes(actionIntent)
    const isLoanAction =
      loanTypeIntents.includes(actionIntent) || actionIntent === loanApplicationStartIntent
    const isDisputeAction = disputeAnswerIntents.includes(actionIntent)
    const shouldHandleCreditCard = !isLoanAction

    // Reset flows if user changes intent mid-flow.
    if (isLoanApplyRequest(message) || isLoanAction) {
      creditCardFlowBySession.delete(sessionKey)
      disputeFlowBySession.delete(sessionKey)
      paymentFlowBySession.delete(sessionKey)
    } else if (
      shouldHandleCreditCard &&
      (isCreditCardApplyRequest(message) ||
        isCreditCardPaymentRequest(message) ||
        isCreditCardAmbiguous(message) ||
        isCreditCardAction)
    ) {
      loanApplicationFlowBySession.delete(sessionKey)
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

    const activeLoanFlow = loanApplicationFlowBySession.get(sessionKey)
    const incomingInputRequest = inputRequest ?? null

    if (activeLoanFlow?.step === 'mcp' && incomingInputRequest?.sessionId) {
      const submitResponse = callvuMcpMock.submitStep({
        sessionId: incomingInputRequest.sessionId,
        fieldId: incomingInputRequest.fieldId,
        value: message,
      })
      if (submitResponse?.completed) {
        loanApplicationFlowBySession.delete(sessionKey)
        const resolvedLoanType = loanTypeLabel[activeLoanFlow.loanType] ?? 'personal'
        const limit = loanEligibilityByType[activeLoanFlow.loanType] ?? 20000
        return res.json(
          buildResponse({
            reply: `You’re pre-approved for a ${resolvedLoanType} loan up to $${limit}.`,
            intent: 'APPLY_LOAN',
          })
        )
      }
      if (submitResponse?.nextStep) {
        const nextStepNumber = Math.min(
          (activeLoanFlow.stepNumber ?? 1) + 1,
          activeLoanFlow.totalSteps ?? 10
        )
        loanApplicationFlowBySession.set(sessionKey, {
          step: 'mcp',
          sessionId: incomingInputRequest.sessionId,
          loanType: activeLoanFlow.loanType,
          fieldId: submitResponse.nextStep.fieldId,
          stepNumber: nextStepNumber,
          totalSteps: activeLoanFlow.totalSteps,
        })
        return res.json(
          buildResponse({
            reply: submitResponse.nextStep.prompt,
            intent: 'APPLY_LOAN',
            inputRequest: buildMcpInputRequest(
              submitResponse.nextStep,
              incomingInputRequest.sessionId,
              nextStepNumber,
              activeLoanFlow.totalSteps
            ),
          })
        )
      }
    }

    // Payment flow: ask type, then launch on selection.
    if (isGenericPaymentRequest(message)) {
      paymentFlowBySession.set(sessionKey, { step: 'await_type' })
      const choiceResponse = buildPaymentChoiceResponse()
      return res.json(
        buildResponse({
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
          buildResponse({
            reply: safeReplyForIntent(resolvedIntent),
            intent: resolvedIntent,
            actionUrl,
            buttonText: intentButtonText[resolvedIntent] ?? 'Secure Payment Center',
          })
        )
      }

      const choiceResponse = buildPaymentChoiceResponse()
      return res.json(
        buildResponse({
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
        buildResponse({
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
        buildResponse({
          reply: safeReplyForIntent(resolvedIntent),
          intent: resolvedIntent,
          actionUrl,
          buttonText: intentButtonText[resolvedIntent] ?? 'Secure Payment Center',
        })
      )
    }

    // Credit card payment: immediate handoff.
    if (shouldHandleCreditCard && isCreditCardPaymentRequest(message)) {
      creditCardFlowBySession.delete(sessionKey)
      const resolvedIntent = 'CREDIT_CARD_PAYMENT'
      const actionUrl = intentToActionUrl[resolvedIntent]
      return res.json(
        buildResponse({
          reply: 'I’ll take you to our secure credit card payment center.',
          intent: resolvedIntent,
          actionUrl,
          buttonText: intentButtonText[resolvedIntent] ?? 'Secure Payment Center',
        })
      )
    }

    // Credit card intent disambiguation.
    if (shouldHandleCreditCard && isCreditCardAmbiguous(message)) {
      creditCardFlowBySession.set(sessionKey, { step: 'await_intent' })
      const intentResponse = buildCreditCardIntentResponse()
      return res.json(
        buildResponse({
          reply: intentResponse.reply,
          intent: intentResponse.intent,
          buttons: intentResponse.buttons,
        })
      )
    }

    if (shouldHandleCreditCard && actionIntent === 'CREDIT_CARD_INTENT_PAYMENT') {
      creditCardFlowBySession.delete(sessionKey)
      const resolvedIntent = 'CREDIT_CARD_PAYMENT'
      const actionUrl = intentToActionUrl[resolvedIntent]
      return res.json(
        buildResponse({
          reply: 'I’ll take you to our secure credit card payment center.',
          intent: resolvedIntent,
          actionUrl,
          buttonText: intentButtonText[resolvedIntent] ?? 'Secure Payment Center',
        })
      )
    }

    if (shouldHandleCreditCard && actionIntent === 'CREDIT_CARD_INTENT_APPLY') {
      creditCardFlowBySession.set(sessionKey, { step: 'await_type', type: null })
      const typeResponse = buildCreditCardTypeResponse()
      return res.json(
        buildResponse({
          reply: typeResponse.reply,
          intent: typeResponse.intent,
          buttons: typeResponse.buttons,
        })
      )
    }

    // Credit card application flow: type -> features -> launch.
    const activeCreditFlow = shouldHandleCreditCard
      ? creditCardFlowBySession.get(sessionKey)
      : null
    if (activeCreditFlow) {
      if (creditCardTypeIntents.includes(actionIntent)) {
        activeCreditFlow.type = actionIntent
        activeCreditFlow.step = 'await_feature'
        creditCardFlowBySession.set(sessionKey, activeCreditFlow)
        const featureResponse = buildCreditCardFeatureResponse()
        return res.json(
          buildResponse({
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
          buildResponse({
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
        buildResponse({
          reply: fallbackResponse.reply,
          intent: fallbackResponse.intent,
          buttons: fallbackResponse.buttons,
        })
      )
    }

    if (shouldHandleCreditCard && isCreditCardApplyRequest(message)) {
      creditCardFlowBySession.set(sessionKey, { step: 'await_type', type: null })
      const typeResponse = buildCreditCardTypeResponse()
      return res.json(
        buildResponse({
          reply: typeResponse.reply,
          intent: typeResponse.intent,
          buttons: typeResponse.buttons,
        })
      )
    }

    if (shouldHandleCreditCard && creditCardTypeIntents.includes(actionIntent)) {
      creditCardFlowBySession.set(sessionKey, { step: 'await_feature', type: actionIntent })
      const featureResponse = buildCreditCardFeatureResponse()
      return res.json(
        buildResponse({
          reply: featureResponse.reply,
          intent: featureResponse.intent,
          buttons: featureResponse.buttons,
          entities: { cardType: actionIntent },
        })
      )
    }

    if (shouldHandleCreditCard && creditCardFeatureIntents.includes(actionIntent)) {
      const typeResponse = buildCreditCardTypeResponse()
      return res.json(
        buildResponse({
          reply: typeResponse.reply,
          intent: typeResponse.intent,
          buttons: typeResponse.buttons,
        })
      )
    }

    // Loan application flow: type -> MCP stepwise prompts.
    if (isLoanApplyRequest(message)) {
      loanApplicationFlowBySession.set(sessionKey, { step: 'await_type' })
      const typeResponse = buildLoanApplicationTypeResponse()
      return res.json(
        buildResponse({
          reply: typeResponse.reply,
          intent: typeResponse.intent,
          buttons: typeResponse.buttons,
        })
      )
    }

    if (loanTypeIntents.includes(actionIntent)) {
      const loanType = loanTypeByIntent[actionIntent] ?? 'personal'
      loanApplicationFlowBySession.set(sessionKey, {
        step: 'await_start',
        loanType,
      })
      return res.json(
        buildResponse({
          reply:
            'We can start your application using our secure integration to the form.',
          intent: 'APPLY_LOAN',
          buttons: [{ label: 'Start Application', actionIntent: loanApplicationStartIntent }],
          entities: { loanType: actionIntent },
        })
      )
    }

    if (actionIntent === loanApplicationStartIntent) {
      const pendingLoanFlow = loanApplicationFlowBySession.get(sessionKey)
      const loanType = pendingLoanFlow?.loanType ?? 'personal'
      const sessionStart = callvuMcpMock.startSession({
        flowType: 'loan_application',
      })
      const totalSteps = buildMockLoanSteps().length
      loanApplicationFlowBySession.set(sessionKey, {
        step: 'mcp',
        sessionId: sessionStart.sessionId,
        loanType,
        fieldId: sessionStart.nextStep?.fieldId ?? null,
        stepNumber: 1,
        totalSteps,
      })
      return res.json(
        buildResponse({
          reply: sessionStart.nextStep?.prompt ?? 'Let’s get started.',
          intent: 'APPLY_LOAN',
          inputRequest: buildMcpInputRequest(
            sessionStart.nextStep,
            sessionStart.sessionId,
            1,
            totalSteps
          ),
          entities: { loanType },
        })
      )
    }

    if (activeLoanFlow?.step === 'await_type') {
      const typeResponse = buildLoanApplicationTypeResponse()
      return res.json(
        buildResponse({
          reply: typeResponse.reply,
          intent: typeResponse.intent,
          buttons: typeResponse.buttons,
        })
      )
    }

    if (activeLoanFlow?.step === 'await_start') {
      return res.json(
        buildResponse({
          reply:
            'We can start your application using our secure integration to the form.',
          intent: 'APPLY_LOAN',
          buttons: [{ label: 'Start Application', actionIntent: loanApplicationStartIntent }],
        })
      )
    }

    // Dispute flow: lost/stolen vs wrong amount -> launch.
    if (isDisputeRequest(message)) {
      disputeFlowBySession.set(sessionKey, { step: 'await_answer' })
      const disputeResponse = buildDisputeQualificationResponse()
      return res.json(
        buildResponse({
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
        buildResponse({
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
        buildResponse({
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
- If credit card intent is unclear, ask whether the user wants to make a payment or apply
- For credit card applications, ask about desired benefits (rewards, airline miles, intro APR) and never ask about annual fees or rate details
- For loan applications, ask for loan type using buttons, then only relay MCP prompts one step at a time

Scope:
- Banking topics only
- If off-topic, decline briefly and redirect to payments, applications, or disputes

General Q&A capability:
- You may answer high-level questions about banking products and programs
- Keep answers informational only (no personal advice or guarantees)
- Do not provide exact rates, fees, or terms unless clearly labeled as example only
- Do not ask follow-up questions unless they help route to a payment, loan application, credit card application, or dispute flow
- If the user expresses intent to take action (apply, pay, dispute, open an account), transition immediately into the appropriate flow and stop general Q&A

Below are example interactions that demonstrate the desired flow.

Example 1 – Payment (unspecified)
User: I want to make a payment.
Assistant: Which account would you like to make a payment on?
Buttons: Mortgage | Credit Card | Auto Loan | Personal Loan
User selects: Personal Loan
Assistant: Got it. I’ll take you to our secure loan payment center.

Example 2 – Payment (specified)
User: I need to make a loan payment.
Assistant: No problem — I’ll take you to our secure loan payment center.

Example 3 – Credit card application
User: I want to apply for a credit card.
Assistant: Is this a personal or business credit card?
Buttons: Personal | Business
User selects: Personal
Assistant: Which features matter most to you?
Buttons: Rewards | Airline Miles | Intro APR
Assistant: Great choice — let’s get your application started.

Example 4 – Loan application
User: I’d like to apply for a loan.
Assistant: What type of loan would you like to apply for?
Buttons: Personal Loan | Credit Card | Auto Loan
User selects: Auto Loan
Assistant: First Name
Assistant: Last Name
Assistant: Date of Birth
Assistant: Last 4 digits of SSN (soft check only)
Assistant: Street Address
Assistant: City
Assistant: State
Assistant: ZIP Code
Assistant: Annual Income
Assistant: Requested Loan Amount
Assistant: You’re pre-approved for an auto loan up to $30,000.

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
*/
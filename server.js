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
  LOAN_TYPE_PERSONAL: { label: 'Personal Loan', loanType: 'Personal Loan' },
  LOAN_TYPE_AUTO: { label: 'Auto Loan', loanType: 'Auto Loan' },
  LOAN_TYPE_HOME: { label: 'Home Loan', loanType: 'Home Loan' },
  LOAN_TYPE_OTHER: { label: 'Other', loanType: 'Other' },
}

const BEGIN_LOAN_APPLICATION_INTENT = 'BEGIN_LOAN_APPLICATION'

const loanBeginMessage =
  "I can help you start your application. For your security, I’ll hand this step off to our secure application system to collect your personal information.\n\nTo make this easier, we'll prefill the information we have on file for you. Please verify the information and update anything that's incorrect."

const sessionState = new Map()

const getSessionKey = (req) => req.body?.sessionId || req.ip || 'anonymous'

const buildChatResponse = ({
  reply,
  intent,
  buttons = null,
  button = null,
  mockLoanFlow = null,
}) => ({
  reply,
  assistantMessage: reply,
  intent,
  buttons,
  button,
  mockLoanFlow,
})

const paymentTypeButtons = Object.entries(PAYMENT_TYPE_INTENTS).map(
  ([intent, data]) => ({
    label: data.label,
    actionIntent: intent,
  })
)

const buildLoanBeginResponse = (loanType) =>
  buildChatResponse({
    reply: loanBeginMessage,
    intent: 'LOAN_APPLICATION',
    button: {
      label: 'Begin application',
      actionIntent: BEGIN_LOAN_APPLICATION_INTENT,
      variant: 'secondary',
    },
  })

const loanTypeButtons = Object.entries(LOAN_TYPE_INTENTS).map(([intent, data]) => ({
  label: data.label,
  actionIntent: intent,
}))

const isPaymentIntent = (text) => {
  const msg = text.toLowerCase()
  return (
    msg.includes('payment') ||
    msg.includes('pay my bill') ||
    msg.includes('make a payment') ||
    msg.includes('pay')
  )
}

const detectIntent = async (message) => {
  const systemContent = `
You classify user intent for a banking assistant.
Return ONLY valid JSON in this exact shape:
{"intent":"loan_application|payment|general|out_of_scope","loanType":"personal loan|auto loan|home loan|other|null"}

Rules:
- "loan_application" if the user wants to apply for a loan.
- "payment" if the user wants to make a payment.
- "general" for banking education questions.
- "out_of_scope" for non-banking topics.

Loan type detection:
- Set loanType if explicitly mentioned (personal, auto, home, other).
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
  const { message, actionIntent } = req.body ?? {}
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ reply: 'Please provide a message to send.' })
  }

  try {
    const sessionKey = getSessionKey(req)
    const state = sessionState.get(sessionKey) ?? { flow: null }

    if (state.flow === 'payment_type') {
      if (PAYMENT_TYPE_INTENTS[actionIntent]) {
        sessionState.delete(sessionKey)
        return res.json(
          buildChatResponse({
            reply:
              'Great, click the link below to make your payment in our secure payment portal.',
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
          actionUrl: intentToActionUrl.APPLY_LOAN,
        })
        return res.json(
          buildLoanBeginResponse(LOAN_TYPE_INTENTS[actionIntent].loanType)
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

    if (state.flow === 'loan_begin') {
      if (actionIntent === BEGIN_LOAN_APPLICATION_INTENT) {
        sessionState.delete(sessionKey)
        return res.json(
          buildChatResponse({
            reply: 'Let’s start with your name.',
            intent: 'LOAN_APPLICATION',
            mockLoanFlow: {
              start: true,
              loanType: state.loanType ?? null,
              actionUrl: state.actionUrl ?? intentToActionUrl.APPLY_LOAN,
            },
          })
        )
      }

      return res.json(buildLoanBeginResponse(state.loanType))
    }

    if (PAYMENT_TYPE_INTENTS[actionIntent]) {
      return res.json(
        buildChatResponse({
          reply:
            'Great, click the link below to make your payment in our secure payment portal.',
          intent: 'PAYMENT',
          button: {
            label: 'Secure Payment Center',
            url: PAYMENT_TYPE_INTENTS[actionIntent].url,
            openInNewWindow: true,
          },
        })
      )
    }

    if (actionIntent === BEGIN_LOAN_APPLICATION_INTENT) {
      sessionState.delete(sessionKey)
      return res.json(
        buildChatResponse({
          reply: 'Let’s start with your name.',
          intent: 'LOAN_APPLICATION',
          mockLoanFlow: {
            start: true,
            loanType: null,
            actionUrl: intentToActionUrl.APPLY_LOAN,
          },
        })
      )
    }

    if (LOAN_TYPE_INTENTS[actionIntent]) {
      sessionState.set(sessionKey, {
        flow: 'loan_begin',
        loanType: LOAN_TYPE_INTENTS[actionIntent].loanType,
        actionUrl: intentToActionUrl.APPLY_LOAN,
      })
      return res.json(
        buildLoanBeginResponse(LOAN_TYPE_INTENTS[actionIntent].loanType)
      )
    }

    if (isPaymentIntent(message)) {
      sessionState.set(sessionKey, { flow: 'payment_type' })
      return res.json(
        buildChatResponse({
          reply: 'Which account would you like to make a payment on?',
          intent: 'PAYMENT',
          buttons: paymentTypeButtons,
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
          (entry) => entry.loanType.toLowerCase() === intentResult.loanType
        )
        if (match) {
          sessionState.set(sessionKey, {
            flow: 'loan_begin',
            loanType: match.loanType,
            actionUrl: intentToActionUrl.APPLY_LOAN,
          })
          return res.json(
            buildLoanBeginResponse(match.loanType)
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
